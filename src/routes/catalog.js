'use strict';
const router = require('express').Router();
const product = require('../models/product');
const category = require('../models/category');

router.get('/catalogue', (req, res) => {
  const activeCat = req.query.categorie ? parseInt(req.query.categorie, 10) : null;
  const q = (req.query.q || '').trim();
  const products = product.listActive({ category: activeCat || undefined, q: q || undefined });
  const categories = category.listAll();
  res.render('pages/catalogue', { title: 'catalogue', products, categories, activeCat, q });
});

router.get('/produit/:slug', (req, res) => {
  const p = product.findBySlug(req.params.slug);
  if (!p || !p.active) return res.status(404).render('pages/404', { title: '404' });
  const related = p.category_id ? product.listByCategory(p.category_id, p.id) : [];
  const cat = p.category_id ? category.findById(p.category_id) : null;
  res.render('pages/product', { title: 'product', product: p, related, cat });
});

module.exports = router;
