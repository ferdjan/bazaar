'use strict';
const crypto = require('crypto');

// Comparaison en temps constant (évite une attaque par mesure du temps).
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Vérifie le token CSRF (champ POST `_csrf` ou header `x-csrf-token`).
// Ne lit JAMAIS le token depuis la query string.
function assertCsrf(req) {
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  return !!(token && safeEqual(token, req.session.csrf));
}

// Protection CSRF globale. Les webhooks sont exclus (signature cryptographique
// propre). Les formulaires multipart sont vérifiés APRÈS multer (dans la
// route), car leur corps n'est pas encore parsé au niveau de ce middleware.
function csrfProtection(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  res.locals.csrf = req.session.csrf;

  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  if (req.path.startsWith('/webhooks/')) return next();
  if (req.is('multipart/form-data')) return next();

  if (!assertCsrf(req)) {
    return res.status(403).send('Jeton CSRF invalide.');
  }
  return next();
}

module.exports = { csrfProtection, assertCsrf, safeEqual };
