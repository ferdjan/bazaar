'use strict';

// Étapes de progression d'une commande. L'ordre dépend du mode de paiement :
// en ligne (Stripe/PayPal), le paiement précède l'expédition ; en paiement à
// la livraison (COD), le client paie au moment de la livraison, donc « payée »
// est la dernière étape.
const STEPS_ONLINE = ['en_attente', 'payee', 'expediee', 'livree'];
const STEPS_COD = ['en_attente', 'expediee', 'livree', 'payee'];

// Colonne de date associée à chaque étape (en_attente → created_at, la date de
// commande, qui n'est jamais écrasée).
const DATE_FIELD = {
  en_attente: 'created_at',
  payee: 'paid_at',
  expediee: 'shipped_at',
  livree: 'delivered_at',
};

// Statuts autorisés (partagés entre le modèle, la route admin et les vues).
const STATUSES = ['en_attente', 'payee', 'expediee', 'livree', 'annulee'];

function stepsFor(paymentMethod) {
  return paymentMethod === 'cod' ? STEPS_COD : STEPS_ONLINE;
}

// Construit la timeline d'une commande : { cancelled, cancelledAt, steps }
// avec steps = [{ key, date, state }], state ∈ done | current | upcoming.
function buildTimeline(order) {
  const steps = stepsFor(order.payment_method);
  const cancelled = order.status === 'annulee';
  const currentIdx = steps.indexOf(order.status); // -1 si annulée/inconnue
  const lastIdx = steps.length - 1;

  const list = steps.map((key, i) => {
    const date = order[DATE_FIELD[key]] || '';
    let state;
    if (cancelled) {
      // Annulée : on montre jusqu'où la commande était allée (dates présentes).
      state = key === 'en_attente' || date ? 'done' : 'upcoming';
    } else if (i < currentIdx) {
      state = 'done';
    } else if (i === currentIdx) {
      state = i === lastIdx ? 'done' : 'current';
    } else {
      state = 'upcoming';
    }
    return { key, date, state };
  });

  return { cancelled, cancelledAt: order.cancelled_at || '', steps: list };
}

module.exports = { STATUSES, DATE_FIELD, STEPS_ONLINE, STEPS_COD, stepsFor, buildTimeline };
