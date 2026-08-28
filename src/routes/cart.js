'use strict';
const router = require('express').Router();
const config = require('../config');
const product = require('../models/product');
const validate = require('../services/validate');
const { getCart } = require('../services/cart');
const { buildCartLink } = require('../services/whatsapp');
const coupon = require('../models/coupon');

router.get('/panier', (req, res) => {
  const cart = getCart(req);
  const delivery = config.deliveryFeeDzd;
  const lang = (req.session && req.session.lang) || 'fr';
  const discount = coupon.discountFor(req.session.coupon, cart.total);
  const total = Math.max(0, cart.total + delivery - (discount || 0));
  const whatsappLink = buildCartLink(
    cart.items,
    { subtotal: cart.total, delivery, total },
    lang
  );
  res.render('pages/cart', {
    title: 'cart',
    items: cart.items,
    subtotal: cart.total,
    delivery,
    total,
    discount: discount || 0,
    couponCode: (req.session && req.session.coupon) || '',
    whatsappLink,
  });
});

router.post('/panier/coupon', (req, res) => {
  const code = validate.couponCode(req.body);
  if (code) {
    const cart = getCart(req);
    if (coupon.discountFor(code, cart.total) !== null) {
      req.session.coupon = code;
      req.session.flash = { type: 'success', key: 'coupon.applied' };
    } else {
      req.session.flash = { type: 'error', key: 'coupon.invalid' };
    }
  } else {
    req.session.flash = { type: 'error', key: 'coupon.invalid' };
  }
  res.redirect('/panier');
});

router.post('/panier/coupon/retirer', (req, res) => {
  delete req.session.coupon;
  req.session.flash = { type: 'success', key: 'coupon.removed' };
  res.redirect('/panier');
});

router.post('/panier/ajouter', (req, res) => {
  const id = parseInt(req.body.productId, 10);
  const size = (req.body.size || '').trim();
  const key = id + ':' + size;
  const qty = Math.max(1, parseInt(req.body.qty, 10) || 1);
  const p = product.findById(id);
  if (p && p.active) {
    req.session.cart = req.session.cart || {};
    req.session.cart[key] = Math.min(p.stock, (req.session.cart[key] || 0) + qty);
    req.session.flash = { type: 'success', key: 'cart.added' };
  }
  res.redirect(req.get('referer') || '/panier');
});

router.post('/panier/modifier', (req, res) => {
  const id = parseInt(req.body.productId, 10);
  const size = (req.body.size || '').trim();
  const key = id + ':' + size;
  const qty = parseInt(req.body.qty, 10);
  if (req.session.cart && req.session.cart[key] !== undefined) {
    if (qty <= 0) {
      delete req.session.cart[key];
    } else {
      // Borne haute alignée sur validate.MAX.qty (99) et le stock réel.
      const p = product.findById(id);
      req.session.cart[key] = p ? Math.min(p.stock, qty, validate.MAX.qty) : qty;
    }
  }
  res.redirect('/panier');
});

router.post('/panier/supprimer', (req, res) => {
  const id = parseInt(req.body.productId, 10);
  const size = (req.body.size || '').trim();
  const key = id + ':' + size;
  if (req.session.cart) delete req.session.cart[key];
  res.redirect('/panier');
});

module.exports = router;
