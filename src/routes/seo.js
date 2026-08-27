'use strict';
const router = require('express').Router();
const config = require('../config');
const product = require('../models/product');
const category = require('../models/category');

// Sitemap dynamique : accueil, catalogue, catégories et fiches produits actives.
router.get('/sitemap.xml', (req, res) => {
  const base = config.baseUrl.replace(/\/$/, '');
  const urls = [{ loc: base + '/', prio: '1.0' }, { loc: base + '/catalogue', prio: '0.8' }];

  for (const c of category.listAll()) {
    urls.push({ loc: `${base}/catalogue?categorie=${c.id}`, prio: '0.6' });
  }
  for (const p of product.listActive()) {
    urls.push({ loc: `${base}/produit/${p.slug}`, prio: '0.7' });
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${escapeXml(u.loc)}</loc><priority>${u.prio}</priority></url>`),
    '</urlset>',
  ].join('\n');

  res.type('application/xml').send(xml);
});

// robots.txt : autorise l'indexation et pointe vers le sitemap.
router.get('/robots.txt', (req, res) => {
  const base = config.baseUrl.replace(/\/$/, '');
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
});

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
  ));
}

module.exports = router;
