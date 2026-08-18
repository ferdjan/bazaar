'use strict';
const { makeT } = require('../services/i18n');
const { formatDzd } = require('../services/currency');
const { formatDate } = require('../services/date');
const { buildTimeline } = require('../services/orderStatus');
const category = require('../models/category');

function cartCount(req) {
  const cart = (req.session && req.session.cart) || {};
  return Object.values(cart).reduce((a, b) => a + (b || 0), 0);
}

// Expose à toutes les vues : langue, traduction, user, panier, formatage, flash.
function locals(req, res, next) {
  const lang = req.session && req.session.lang === 'ar' ? 'ar' : 'fr';
  res.locals.lang = lang;
  res.locals.dir = lang === 'ar' ? 'rtl' : 'ltr';
  res.locals.t = makeT(lang);
  res.locals.formatDzd = (d) => formatDzd(d, lang);
  res.locals.formatDate = (d) => formatDate(d, lang);
  res.locals.orderTimeline = (o) => buildTimeline(o);
  res.locals.L = (fr, ar) => (lang === 'ar' ? (ar || fr) : (fr || ar));
  res.locals.pname = (p) => res.locals.L(p.name_fr, p.name_ar);
  res.locals.pdesc = (p) => res.locals.L(p.description_fr, p.description_ar);
  res.locals.cname = (c) => res.locals.L(c.name_fr, c.name_ar);
  res.locals.user = (req.session && req.session.user) || null;
  res.locals.isAdmin = !!(req.session && req.session.user && req.session.user.role === 'admin');
  res.locals.cartCount = cartCount(req);
  res.locals.path = req.path;
  res.locals.categories = category.listAll();
  res.locals.flash = (req.session && req.session.flash) || null;
  if (req.session) req.session.flash = null;
  next();
}

module.exports = { locals, cartCount };
