'use strict';
const router = require('express').Router();
const product = require('../models/product');
const category = require('../models/category');
const newsletter = require('../models/newsletter');
const validate = require('../services/validate');

router.get('/', (req, res) => {
  const products = product.listActive().slice(0, 8);
  const lowStock = product.listActive().filter((p) => p.stock > 0 && p.stock <= 5);
  const categories = category.listAll();
  res.render('pages/home', { title: 'home', products, categories, lowStock });
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

module.exports = router;
