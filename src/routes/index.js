'use strict';
const router = require('express').Router();
const product = require('../models/product');
const category = require('../models/category');
const orderModel = require('../models/order');
const newsletter = require('../models/newsletter');
const validate = require('../services/validate');

// Référence publique générée par orderModel : CMD- + 16 hex.
const REF_RE = /^CMD-[0-9A-F]{16}$/;

router.get('/', (req, res) => {
  const products = product.listActive();
  const lowStock = products.filter((p) => p.stock > 0 && p.stock <= 5);
  const categories = category.listAll();
  res.render('pages/home', { title: 'home', products: products.slice(0, 8), categories, lowStock });
});

router.post('/newsletter', (req, res) => {
  const email = validate.textField(req.body.email, validate.MAX.email).toLowerCase();
  if (!validate.isEmail(email)) {
    req.session.flash = { type: 'error', key: 'home.news_invalid' };
    return res.redirect('/');
  }
  newsletter.subscribe(email);
  req.session.flash = { type: 'success', key: 'home.news_success' };
  res.redirect('/');
});

router.get('/lang/:lang', (req, res) => {
  req.session.lang = req.params.lang === 'ar' ? 'ar' : 'fr';
  res.redirect(req.get('referer') || '/');
});

// --- Suivi de commande public (clients invités inclus) ---

router.get('/suivi', (req, res) => {
  res.render('pages/suivi', { title: 'tracking.form_title', error: null, ref: '' });
});

router.post('/suivi', (req, res) => {
  const ref = validate.textField(req.body.ref, 32).toUpperCase();
  const email = validate.textField(req.body.email, validate.MAX.email).toLowerCase();

  // La commande n'est révélée que si la référence ET l'e-mail de la commande
  // correspondent : la référence seule ne suffit pas.
  const order = REF_RE.test(ref) ? orderModel.findByRef(ref) : null;
  if (!order || !validate.isEmail(email) || order.email.toLowerCase() !== email) {
    return res.render('pages/suivi', { title: 'tracking.form_title', error: 'tracking.not_found', ref });
  }
  res.render('pages/order', { title: 'order', order });
});

module.exports = router;
