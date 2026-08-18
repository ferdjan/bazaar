'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const userModel = require('../models/user');
const orderModel = require('../models/order');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimit');
const validate = require('../services/validate');

router.get('/inscription', (req, res) => {
  res.render('pages/register', { title: 'register' });
});

router.post('/inscription', registerLimiter, (req, res, next) => {
  const name = validate.textField(req.body.name, validate.MAX.name);
  const email = validate.textField(req.body.email, validate.MAX.email).toLowerCase();
  const password = req.body.password || '';

  if (!name || !email || !password) {
    return res.render('pages/register', { title: 'register', error: 'auth.required', name, email });
  }
  if (!validate.isEmail(email)) {
    return res.render('pages/register', { title: 'register', error: 'auth.invalid', name, email });
  }
  if (password.length < 6 || password.length > validate.MAX.password) {
    return res.render('pages/register', { title: 'register', error: 'auth.password_short', name, email });
  }
  if (userModel.findByEmail(email)) {
    return res.render('pages/register', { title: 'register', error: 'auth.email_exists', name, email });
  }

  const u = userModel.create({ email, password_hash: bcrypt.hashSync(password, 10), name, role: 'customer' });
  const dest = req.session.returnTo || '/compte';

  // Régénère l'identifiant de session pour éviter la fixation de session.
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
    req.session.flash = { type: 'success', key: 'auth.register_success' };
    res.redirect(dest);
  });
});

router.get('/connexion', (req, res) => {
  res.render('pages/login', { title: 'login' });
});

router.post('/connexion', loginLimiter, (req, res, next) => {
  const email = validate.textField(req.body.email, validate.MAX.email).toLowerCase();
  const password = req.body.password || '';
  const u = email ? userModel.findByEmail(email) : null;
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    return res.render('pages/login', { title: 'login', error: 'auth.invalid', email });
  }
  const dest = u.role === 'admin' ? '/admin' : (req.session.returnTo || '/compte');

  // Régénère l'identifiant de session après authentification réussie.
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
    res.redirect(dest);
  });
});

router.post('/deconnexion', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

router.get('/compte', requireAuth, (req, res) => {
  const orders = orderModel.listByUser(req.session.user.id);
  res.render('pages/account', { title: 'account', orders });
});

router.get('/commande/:ref', requireAuth, (req, res) => {
  const order = orderModel.findByRef(req.params.ref);
  if (!order) return res.status(404).render('pages/404', { title: '404' });
  const isOwner = order.user_id === req.session.user.id || req.session.user.role === 'admin';
  if (!isOwner) return res.status(404).render('pages/404', { title: '404' });
  res.render('pages/order', { title: 'order', order });
});

module.exports = router;
