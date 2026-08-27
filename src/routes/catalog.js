'use strict';
const router = require('express').Router();
const product = require('../models/product');
const category = require('../models/category');
const { buildProductLink } = require('../services/whatsapp');

router.get('/catalogue', (req, res) => {
  const rawCat = (req.query.categorie || '').toString();
  const activeCat = /^[1-9][0-9]*$/.test(rawCat) ? parseInt(rawCat, 10) : null;
  const q = (req.query.q || '').toString().trim().slice(0, 200);
  const products = product.listActive({ category: activeCat || undefined, q: q || undefined });
  const categories = category.listAll();
  res.render('pages/catalogue', { title: 'catalogue', products, categories, activeCat, q });
});

router.get('/produit/:slug', (req, res) => {
  const p = product.findBySlug(req.params.slug);
  if (!p || !p.active) return res.status(404).render('pages/404', { title: '404' });
  const related = p.category_id ? product.listByCategory(p.category_id, p.id) : [];
  const cat = p.category_id ? category.findById(p.category_id) : null;
  const lang = (req.session && req.session.lang) || 'fr';
  res.render('pages/product', {
    title: 'product',
    product: p,
    related,
    cat,
    images: product.listImages(p.id),
    whatsappLink: buildProductLink(p, lang),
    pageTitle: p.name_fr,
    pageDescription: p.description_fr,
  });
});

module.exports = router;
