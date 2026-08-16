'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const config = require('./config');
const { locals } = require('./middleware/locals');
const { csrfProtection } = require('./middleware/csrf');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.urlencoded({ extended: true }));

  // Webhook Stripe AVANT tout parseur JSON : nécessite le corps brut (Buffer).
  app.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    require('./services/payment/stripe').handleWebhook
  );

  app.use(express.json());

  app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 },
  }));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(locals);
  app.use(csrfProtection);

  // Routes
  app.use('/', require('./routes/index'));
  app.use('/', require('./routes/catalog'));
  app.use('/', require('./routes/cart'));
  app.use('/', require('./routes/auth'));
  app.use('/', require('./routes/checkout'));
  app.use('/', require('./routes/payments'));
  app.use('/admin', require('./routes/admin'));

  // 404
  app.use((req, res) => res.status(404).render('pages/404', { title: '404' }));

  // Gestion d'erreurs
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).render('pages/500', { title: '500' });
  });

  return app;
}

module.exports = { createApp };
