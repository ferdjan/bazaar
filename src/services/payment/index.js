'use strict';
const cod = require('./cod');
const stripe = require('./stripe');
const paypal = require('./paypal');

const providers = { cod, stripe, paypal };

async function initiate(method, order) {
  const provider = providers[method];
  if (!provider) throw new Error('Méthode de paiement inconnue : ' + method);
  return provider.initiate(order);
}

module.exports = { initiate, providers };
