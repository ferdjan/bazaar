'use strict';
const router = require('express').Router();
const product = require('../models/product');
const category = require('../models/category');
const review = require('../models/review');
const validate = require('../services/validate');
const { requireAuth } = require('../middleware/auth');
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
  const user = (req.session && req.session.user) || null;
  const canReview = user && review.hasOrdered(user.id, p.id);
  res.render('pages/product', {
    title: 'product',
    product: p,
    related,
    cat,
    images: product.listImages(p.id),
    whatsappLink: buildProductLink(p, lang),
    pageTitle: p.name_fr,
    pageDescription: p.description_fr,
    reviews: review.listByProduct(p.id),
    reviewStats: review.statsForProduct(p.id),
    myReview: user ? review.findForUser(p.id, user.id) : null,
    canReview: !!canReview,
  });
});

// Dépôt d'un avis (client connecté ayant commandé le produit).
router.post('/produit/:slug/avis', requireAuth, (req, res) => {
  const p = product.findBySlug(req.params.slug);
  if (!p || !p.active) return res.status(404).render('pages/404', { title: '404' });
  const user = req.session.user;
  if (!review.hasOrdered(user.id, p.id)) {
    req.session.flash = { type: 'error', key: 'review.not_allowed' };
    return res.redirect('/produit/' + p.slug);
  }
  const v = validate.review(req.body);
  if (!v.ok) {
    req.session.flash = { type: 'error', key: 'review.invalid' };
    return res.redirect('/produit/' + p.slug);
  }
  review.upsert(p.id, user.id, v.rating, v.comment);
  req.session.flash = { type: 'success', key: 'review.saved' };
  res.redirect('/produit/' + p.slug);
});

module.exports = router;
