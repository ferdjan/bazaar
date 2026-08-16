'use strict';
const crypto = require('crypto');

// Protection CSRF légère : token stocké en session, à renvoyer dans chaque
// formulaire POST (champ caché `_csrf`). Les webhooks sont exclus (vérifiés par signature).
function csrfProtection(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  res.locals.csrf = req.session.csrf;

  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  if (req.path.startsWith('/webhooks/')) return next();

  const token = (req.body && req.body._csrf) || req.get('x-csrf-token') || req.query._csrf;
  if (token !== req.session.csrf) {
    return res.status(403).send('Jeton CSRF invalide.');
  }
  return next();
}

module.exports = { csrfProtection };
