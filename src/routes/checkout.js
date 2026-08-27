'use strict';
const router = require('express').Router();
const config = require('../config');
const orderModel = require('../models/order');
const { getCart, validateCart, clearCart } = require('../services/cart');
const { dzdToEurString } = require('../services/currency');
const validate = require('../services/validate');
const { paymentLimiter } = require('../middleware/rateLimit');
const mail = require('../services/mail');
const logger = require('../services/logger');

// Sous-total + frais de livraison forfaitaires (DELIVERY_FEE_DZD).
function totals(subtotal) {
  const delivery = config.deliveryFeeDzd;
  return { subtotal, delivery, total: subtotal + delivery };
}

function renderCheckout(res, { items, user, error, form, subtotal }) {
  res.render('pages/checkout', {
    title: 'checkout',
    items,
    ...totals(subtotal),
    user,
    error,
    form,
  });
}

router.get('/commande', (req, res) => {
  if (req.session.user && req.session.user.role === 'admin') {
    req.session.flash = { type: 'error', key: 'admin.cant_order' };
    return res.redirect('/admin');
  }
  const cart = getCart(req);
  if (!cart.items.length) return res.redirect('/panier');
  renderCheckout(res, {
    items: cart.items,
    user: req.session.user || null,
    error: undefined,
    form: null,
    subtotal: cart.total,
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

  // 2. Recalcul et validation du panier depuis la base (prix, stock, taille…).
  const checked = validateCart(req);
  if (!checked.ok) {
    return renderCheckout(res, {
      items: cart.items, user: req.session.user || null,
      error: checked.errorKey, form: v.form, subtotal: cart.total,
    });
  }

  // 3. Création atomique commande + décrément de stock (vérifié côté SQL).
  const t = totals(checked.total);
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
        ville: v.form.ville,
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
      });
    }
    return next(err);
  }

  clearCart(req);

  // Notification admin (fire-and-forget) : n'échoue jamais la commande.
  if (mail.isConfigured()) {
    const itemsText = order.items.map((it) => `- ${it.name} x${it.qty} = ${it.price_dzd * it.qty} DA`).join('\n');
    mail.sendMail({
      to: config.adminEmail,
      subject: `Nouvelle commande ${order.ref} (${order.payment_method})`,
      text: [
        `Nouvelle commande : ${order.ref}`,
        `Client : ${order.nom} — ${order.telephone}`,
        `Ville : ${order.ville}`,
        `Montant : ${order.total_dzd} DA (${order.payment_method})`,
        '',
        itemsText,
      ].join('\n'),
    }).catch((err) => logger.warn('échec notification admin', { ref: order.ref, err: err.message }));
  }

  res.redirect('/paiement/' + v.form.payment_method + '/' + order.ref);
});

module.exports = router;
