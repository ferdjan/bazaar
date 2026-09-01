'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const userModel = require('../models/user');
const orderModel = require('../models/order');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, registerLimiter, resetLimiter } = require('../middleware/rateLimit');
const { destroyUserSessions } = require('../services/sessionStore');
const validate = require('../services/validate');
const config = require('../config');
const { logger } = require('../services/logger');
const mail = require('../services/mail');
const google = require('../services/oauth/google');

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
  const dest = u.role === 'admin' ? '/admin' : (u.role === 'seller' ? '/scan' : (req.session.returnTo || '/compte'));

  // Régénère l'identifiant de session après authentification réussie.
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
    res.redirect(dest);
  });
});

// --- Connexion Google (OAuth 2.0) -------------------------------------------

// Redirige vers l'écran de consentement Google. Un jeton d'état aléatoire est
// stocké en session pour vérifier la réponse au retour (anti-CSRF).
router.get('/auth/google', (req, res) => {
  if (!google.isConfigured()) {
    req.session.flash = { type: 'error', key: 'auth.oauth_error' };
    return res.redirect('/connexion');
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(google.buildAuthUrl(state));
});

// Retour de Google : échange le code, lit le profil, connecte ou crée le compte.
router.get('/auth/google/callback', async (req, res, next) => {
  const fail = () => {
    req.session.flash = { type: 'error', key: 'auth.oauth_error' };
    return res.redirect('/connexion');
  };

  // Échec ou refus côté fournisseur.
  if (req.query.error) return fail();

  const state = String(req.query.state || '');
  const expected = req.session.oauthState;
  delete req.session.oauthState;
  if (!state || state !== expected) return fail();

  const code = String(req.query.code || '');
  if (!code) return fail();

  let profile;
  try {
    const tokens = await google.exchangeCode(code);
    profile = google.normalizeProfile(await google.fetchProfile(tokens.access_token));
  } catch (err) {
    logger.warn('connexion Google échouée', { err: String((err && err.message) || err) });
    return fail();
  }
  if (!profile) return fail();

  let u = userModel.findByOAuth('google', profile.sub);
  if (!u) {
    u = userModel.findByEmail(profile.email);
    if (u) {
      // E-mail vérifié par Google : on associe le compte existant.
      userModel.linkOAuth(u.id, 'google', profile.sub);
    } else {
      u = userModel.create({ email: profile.email, password_hash: '', name: profile.name, role: 'customer' });
      userModel.linkOAuth(u.id, 'google', profile.sub);
    }
  }

  const dest = u.role === 'admin' ? '/admin' : (u.role === 'seller' ? '/scan' : (req.session.returnTo || '/compte'));
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
    res.redirect(dest);
  });
});

// Mot de passe oublié : demande d'un lien de réinitialisation par e-mail.
router.get('/mot-de-passe-oublie', (req, res) => {
  res.render('pages/forgot-password', { title: 'forgot' });
});

router.post('/mot-de-passe-oublie', resetLimiter, async (req, res) => {
  const email = validate.textField(req.body.email, validate.MAX.email).toLowerCase();
  if (!validate.isEmail(email)) {
    return res.render('pages/forgot-password', { title: 'forgot', error: 'auth.invalid', email });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.resetTokenTtlHours * 3600 * 1000).toISOString();
  const found = userModel.setResetToken(email, token, expires);

  // Réponse générique : ne jamais révéler si l'e-mail existe en base.
  if (found) {
    const link = `${config.baseUrl}/reinitialiser/${token}`;
    const text =
      'Bonjour,\n\n' +
      'Pour réinitialiser votre mot de passe, ouvrez ce lien (valable ' +
      config.resetTokenTtlHours + ' h) :\n' + link + '\n\n' +
      "Si vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail.\n";
    try {
      await mail.sendMail({ to: email, subject: 'Réinitialisation de votre mot de passe', text });
    } catch (err) {
      // SMTP non configuré ou envoi en échec : on journalise le lien en dev
      // uniquement, pour permettre de tester localement.
      logger.warn('échec envoi e-mail réinitialisation', { err: String((err && err.message) || err) });
      if (process.env.NODE_ENV !== 'production') {
        logger.info('lien de réinitialisation (dev)', { link });
      }
    }
  }

  req.session.flash = { type: 'success', key: 'auth.reset_sent' };
  res.redirect('/connexion');
});

// Formulaire de nouveau mot de passe (jeton vérifié).
router.get('/reinitialiser/:token', (req, res) => {
  const token = validate.textField(req.params.token, 128);
  const u = userModel.findByResetToken(token);
  if (!u || !u.reset_expires || new Date(u.reset_expires).getTime() < Date.now()) {
    return res.render('pages/forgot-password', { title: 'forgot', error: 'auth.reset_invalid' });
  }
  res.render('pages/reset-password', { title: 'reset', token });
});

router.post('/reinitialiser/:token', (req, res) => {
  const token = validate.textField(req.params.token, 128);
  const password = req.body.password || '';
  const u = userModel.findByResetToken(token);
  if (!u || !u.reset_expires || new Date(u.reset_expires).getTime() < Date.now()) {
    return res.render('pages/forgot-password', { title: 'forgot', error: 'auth.reset_invalid' });
  }
  if (password.length < 6 || password.length > validate.MAX.password) {
    return res.render('pages/reset-password', { title: 'reset', error: 'auth.password_short', token });
  }
  userModel.resetPassword(u.id, bcrypt.hashSync(password, 10));
  // Déconnecte les autres appareils : toute session de cet utilisateur autre
  // que la session courante est détruite (vol d'ancien mot de passe ⇒ accès
  // persistant impossible).
  destroyUserSessions(u.id, req.sessionID);
  req.session.flash = { type: 'success', key: 'auth.reset_done' };
  res.redirect('/connexion');
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
