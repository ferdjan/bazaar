'use strict';

// Cash à la livraison : aucun paiement en ligne, la commande reste "pending".
async function initiate(order) {
  return { redirectUrl: null, providerId: null };
}

module.exports = { initiate };
