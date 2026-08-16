'use strict';
const router = require('express').Router();
const orderModel = require('../models/order');
const { getCart, clearCart } = require('../services/cart');
const { dzdToEurString } = require('../services/currency');

const METHODS = ['cod', 'stripe', 'paypal'];

router.get('/commande', (req, res) => {
  if (req.session.user && req.session.user.role === 'admin') {
    req.session.flash = { type: 'error', key: 'admin.cant_order' };
    return res.redirect('/admin');
  }
  const cart = getCart(req);
  if (!cart.items.length) return res.redirect('/panier');
  res.render('pages/checkout', {
    title: 'checkout',
    items: cart.items,
    total: cart.total,
    user: req.session.user || null,
    form: null,
  });
});

router.post('/commande', (req, res) => {
  if (req.session.user && req.session.user.role === 'admin') {
    req.session.flash = { type: 'error', key: 'admin.cant_order' };
    return res.redirect('/admin');
  }
  const cart = getCart(req);
  if (!cart.items.length) return res.redirect('/panier');

  const method = req.body.payment_method;
  if (!METHODS.includes(method)) return res.redirect('/commande');

  const form = {
    nom: (req.body.nom || '').trim(),
    email: (req.body.email || '').trim(),
    telephone: (req.body.telephone || '').trim(),
    adresse: (req.body.adresse || '').trim(),
    ville: (req.body.ville || '').trim(),
    payment_method: method,
  };
  if (!form.nom || !form.email || !form.telephone || !form.adresse || !form.ville) {
    return res.render('pages/checkout', {
      title: 'checkout',
      items: cart.items,
      total: cart.total,
      user: req.session.user || null,
      error: 'auth.required',
      form,
    });
  }

  const order = orderModel.create({
    order: {
      user_id: (req.session.user && req.session.user.role === 'customer') ? req.session.user.id : null,
      status: 'en_attente',
      total_dzd: cart.total,
      total_eur: dzdToEurString(cart.total),
      payment_method: method,
      payment_status: 'pending',
      nom: form.nom,
      email: form.email,
      telephone: form.telephone,
      adresse: form.adresse,
      ville: form.ville,
    },
    items: cart.items.map((it) => ({
      productId: it.product.id,
      name: it.product.name_fr,
      priceDzd: it.product.price_dzd,
      qty: it.qty,
      size: it.size,
    })),
  });

  clearCart(req);
  res.redirect('/paiement/' + method + '/' + order.ref);
});

module.exports = router;
