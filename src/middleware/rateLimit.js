'use strict';
const rateLimit = require('express-rate-limit');
const config = require('../config');

function denied(res) {
  return res.status(429).send('Trop de tentatives. Réessayez plus tard.');
}

// Limiteur de connexion : clé par IP + email afin de contrer le brute-force
// d'un compte sans verrouiller tous les utilisateurs derrière une même IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body && req.body.email ? String(req.body.email) : '').trim().toLowerCase();
    return (req.ip || '') + '|' + email;
  },
  handler: (req, res) => denied(res),
});

// Limiteur d'inscription (par IP).
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: config.rateLimit.registerMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => denied(res),
});

// Limiteur des endpoints de paiement (par IP).
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.rateLimit.paymentMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => denied(res),
});

// Limiteur de demande de réinitialisation de mot de passe (par IP + email),
// contre l'énumération de comptes et le spam.
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: config.rateLimit.resetMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body && req.body.email ? String(req.body.email) : '').trim().toLowerCase();
    return (req.ip || '') + '|' + email;
  },
  handler: (req, res) => denied(res),
});

module.exports = { loginLimiter, registerLimiter, paymentLimiter, resetLimiter };
