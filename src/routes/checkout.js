'use strict';
const router = require('express').Router();
const config = require('../config');
const orderModel = require('../models/order');
const coupon = require('../models/coupon');
const location = require('../models/location');
const { getCart, validateCart, clearCart } = require('../services/cart');
const { dzdToEurString } = require('../services/currency');
const validate = require('../services/validate');
const { paymentLimiter } = require('../middleware/rateLimit');
const mail = require('../services/mail');
const logger = require('../services/logger');

// Sous-total + frais de livraison forfaitaires (DELIVERY_FEE_DZD), moins la
// remise coupon éventuelle.
function totals(subtotal, discount = 0) {
  const delivery = config.deliveryFeeDzd;
  return { subtotal, delivery, discount, total: Math.max(0, subtotal + delivery - discount) };
}

function renderCheckout(res, { items, user, error, form, subtotal, discount, couponCode }) {
  res.render('pages/checkout', {
    title: 'checkout',
    items,
    ...totals(subtotal, discount || 0),
    user,
    error,
    form,
    couponCode: couponCode || '',
    wilayas: location.listWilayas(),
    communes: location.listCommunes(),
  });
}

// Résout la wilaya/commune (optionnelles) depuis le formulaire. Retourne
// { ok, errorKey, wilaya_code, commune_id }. Vérifie l'existence en base et la
// cohérence commune ↔ wilaya.
function resolveLocation(wilayaCode, communeId) {
  if (!wilayaCode && !communeId) return { ok: true, wilaya_code: '', commune_id: null };

  if (communeId) {
    const commune = location.getCommune(parseInt(communeId, 10));
    if (!commune) return { ok: false, errorKey: 'checkout.invalid_location' };
    if (wilayaCode && commune.wilaya_code !== wilayaCode) return { ok: false, errorKey: 'checkout.invalid_location' };
    return { ok: true, wilaya_code: commune.wilaya_code, commune_id: commune.id };
  }

  const wilaya = location.getWilaya(wilayaCode);
  if (!wilaya) return { ok: false, errorKey: 'checkout.invalid_location' };
  return { ok: true, wilaya_code: wilaya.code, commune_id: null };
}

// Calcule la remise coupon valide pour la session, sinon 0.
function sessionDiscount(req, subtotal) {
  const code = (req.session && req.session.coupon) || '';
  if (!code) return { discount: 0, code: '' };
  const d = coupon.discountFor(code, subtotal);
  return d === null ? { discount: 0, code: '' } : { discount: d, code };
}

router.get('/commande', (req, res) => {
  if (req.session.user && req.session.user.role === 'admin') {
    req.session.flash = { type: 'error', key: 'admin.cant_order' };
    return res.redirect('/admin');
  }
  const cart = getCart(req);
  if (!cart.items.length) return res.redirect('/panier');
  const sc = sessionDiscount(req, cart.total);
  renderCheckout(res, {
    items: cart.items,
    user: req.session.user || null,
    error: undefined,
    form: null,
    subtotal: cart.total,
    discount: sc.discount,
    couponCode: sc.code,
  });
});

router.post('/commande', paymentLimiter, (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') {
    req.session.flash = { type: 'error', key: 'admin.cant_order' };
    return res.redirect('/admin');
  }

  // 1. Validation serveur des champs du formulaire.
  const v = validate.checkout(req.body);
  const cart = getCart(req);
  if (!v.ok) {
    return renderCheckout(res, {
      items: cart.items, user: req.session.user || null,
      error: v.errorKey, form: v.form, subtotal: cart.total,
    });
  }

  // Résolution wilaya/commune (existence + cohérence vérifiées en base).
  const loc = resolveLocation(v.form.wilaya_code, v.form.commune_id);
  if (!loc.ok) {
    return renderCheckout(res, {
      items: cart.items, user: req.session.user || null,
      error: loc.errorKey, form: v.form, subtotal: cart.total,
    });
  }

  // 2. Recalcul et validation du panier depuis la base (prix, stock, taille…).
  const checked = validateCart(req);
  if (!checked.ok) {
    return renderCheckout(res, {
      items: cart.items, user: req.session.user || null,
      error: checked.errorKey, form: v.form, subtotal: cart.total,
    });
  }

  // 3. Remise coupon (recalculée côté serveur, jamais depuis le navigateur).
  const sc = sessionDiscount(req, checked.total);

  // 4. Création atomique commande + décrément de stock (vérifié côté SQL).
  const t = totals(checked.total, sc.discount);
  let order;
  try {
    order = orderModel.create({
      order: {
        user_id: (req.session.user && req.session.user.role === 'customer') ? req.session.user.id : null,
        status: 'en_attente',
        total_dzd: t.total,
        total_eur: dzdToEurString(t.total),
        delivery_dzd: t.delivery,
        payment_method: v.form.payment_method,
        payment_status: 'pending',
        provider_id: '',
        nom: v.form.nom,
        email: v.form.email,
        telephone: v.form.telephone,
        adresse: v.form.adresse,
        wilaya_code: loc.wilaya_code,
        commune_id: loc.commune_id,
        coupon_code: sc.code,
        discount_dzd: sc.discount,
      },
      items: checked.items.map((it) => ({
        productId: it.product.id,
        name: it.product.name_fr,
        priceDzd: it.product.price_dzd,
        qty: it.qty,
        size: it.size,
      })),
    });
  } catch (err) {
    if (err && err.code === 'STOCK_INSUFFICIENT') {
      return renderCheckout(res, {
        items: cart.items, user: req.session.user || null,
        error: 'cart.insufficient_stock', form: v.form, subtotal: checked.total,
        discount: sc.discount, couponCode: sc.code,
      });
    }
    if (err && err.code === 'COUPON_INVALID') {
      delete req.session.coupon;
      return renderCheckout(res, {
        items: cart.items, user: req.session.user || null,
        error: 'coupon.invalid', form: v.form, subtotal: checked.total,
        discount: 0, couponCode: '',
      });
    }
    return next(err);
  }

  clearCart(req);
  req.session.paymentRefs = (req.session.paymentRefs || []).filter((r) => r !== order.ref).concat(order.ref).slice(-20);
  delete req.session.coupon;

  // Notification admin (fire-and-forget) : n'échoue jamais la commande.
  if (mail.isConfigured()) {
    const itemsText = order.items.map((it) => `- ${it.name} x${it.qty} = ${it.price_dzd * it.qty} DA`).join('\n');
    const lieu = [order.commune_name_fr, order.wilaya_name_fr].filter(Boolean).join(', ');
    mail.sendMail({
      to: config.adminEmail,
      subject: `Nouvelle commande ${order.ref} (${order.payment_method})`,
      text: [
        `Nouvelle commande : ${order.ref}`,
        `Client : ${order.nom} — ${order.telephone}`,
        `E-mail : ${order.email || '—'}`,
        `Adresse : ${order.adresse}${lieu ? ' — ' + lieu : ''}`,
        `Montant : ${order.total_dzd} DA (${order.payment_method})`,
        '',
        itemsText,
      ].join('\n'),
    }).catch((err) => logger.warn('échec notification admin', { ref: order.ref, err: err.message }));
  }

  res.redirect('/paiement/' + v.form.payment_method + '/' + order.ref);
});

module.exports = router;
