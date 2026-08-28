'use strict';
const crypto = require('crypto');

// Logs structurés (JSON). Ne jamais journaliser : mots de passe, secrets,
// cookies, tokens CSRF, clés Stripe/PayPal ni données de paiement sensibles.
// Ici on ne logge que la route, le statut et la durée — jamais le corps.

function emit(level, message, fields) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(fields || {}),
  });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

const logger = {
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
};

// Middleware Express : identifiant de requête + log d'accès structuré.
function requestLogger(req, res, next) {
  req.id = crypto.randomBytes(8).toString('hex');
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('http', {
      reqId: req.id,
      method: req.method,
      // Ne jamais écrire les query params : ils peuvent contenir des tokens
      // Stripe/PayPal ou des références de réinitialisation.
      path: req.path,
      status: res.statusCode,
      durMs: Math.round(durMs * 10) / 10,
    });
  });
  next();
}

module.exports = { logger, requestLogger };
