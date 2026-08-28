'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { locals } = require('./middleware/locals');
const { csrfProtection } = require('./middleware/csrf');
const { SqliteStore } = require('./services/sessionStore');
const { logger, requestLogger } = require('./services/logger');

function createApp() {
  const app = express();

  // trust proxy uniquement si l'infrastructure le justifie (reverse proxy maîtrisé).
  if (config.trustProxy) app.set('trust proxy', 1);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(requestLogger);
  // Compression gzip/brotli des réponses texte (HTML, CSS, JSON).
  app.use(compression());

  // Nonce CSP (disponible pour d'éventuels scripts inline futurs).
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  // CSP nonce-based : pas d'unsafe-eval, pas d'unsafe-inline pour les scripts.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }));

  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // Webhooks AVANT tout parseur JSON : ils exigent le corps brut (Buffer)
  // pour la vérification de signature. Voir services/payment/*.handleWebhook.
  app.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    require('./services/payment/stripe').handleWebhook
  );
  app.post(
    '/webhooks/paypal',
    express.raw({ type: 'application/json' }),
    require('./services/payment/paypal').handleWebhook
  );

  app.use(express.json({ limit: '100kb' }));

  app.use(session({
    store: new SqliteStore(),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      // Une session admin ne doit pas rester active pendant plusieurs semaines.
      maxAge: 1000 * 60 * 60 * 24,
    },
  }));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Limiteur global très large contre les abus (le strict est par-route).
  app.use(rateLimit({
    windowMs: 5 * 60 * 1000,
    max: config.rateLimit.globalMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).send('Trop de requêtes. Réessayez plus tard.'),
  }));

  app.use(locals);
  app.use(csrfProtection);

  // Routes
  app.use('/', require('./routes/index'));
  app.use('/', require('./routes/catalog'));
  app.use('/', require('./routes/cart'));
  app.use('/', require('./routes/auth'));
  app.use('/', require('./routes/checkout'));
  app.use('/', require('./routes/payments'));
  app.use('/', require('./routes/scan'));
  app.use('/', require('./routes/seo'));
  app.use('/admin', require('./routes/admin'));

  // 404
  app.use((req, res) => res.status(404).render('pages/404', { title: '404' }));

  // Gestion d'erreurs : message générique côté client, détail côté serveur.
  // Ne jamais renvoyer err.message à l'utilisateur.
  app.use((err, req, res, next) => {
    logger.error('erreur serveur', {
      reqId: req.id,
      method: req.method,
      path: req.path,
      err: err && err.message ? err.message : String(err),
      stack: err && err.stack,
    });
    if (res.headersSent) return next(err);
    res.status(500).render('pages/500', { title: '500' });
  });

  return app;
}

module.exports = { createApp };
