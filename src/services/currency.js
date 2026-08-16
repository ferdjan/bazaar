'use strict';
const config = require('../config');

const SYMBOL = { fr: 'DA', ar: 'دج' };

// Formate un montant en dinars entiers : 3500 -> "3 500 DA"
function formatDzd(dzd, lang = 'fr') {
  const n = new Intl.NumberFormat('fr-FR').format(dzd || 0);
  return n + ' ' + (SYMBOL[lang] || SYMBOL.fr);
}

// Convertit des dinars entiers en centimes d'euro (unités mineures Stripe).
function dzdToEurCents(dzd) {
  return Math.round((dzd || 0) * config.dzdToEurRate * 100);
}

// Convertit des dinars entiers en chaîne décimale EUR (format PayPal).
function dzdToEurString(dzd) {
  return ((dzd || 0) * config.dzdToEurRate).toFixed(2);
}

module.exports = { formatDzd, dzdToEurCents, dzdToEurString };
