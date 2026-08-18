'use strict';

// Étapes de progression d'une commande, dans l'ordre, et la colonne de date
// associée. Le statut courant de la commande est la source de vérité pour
// déterminer l'étape « en cours ».
const STEPS = ['en_attente', 'payee', 'expediee', 'livree'];

const DATE_FIELD = {
  en_attente: 'created_at',
  payee: 'paid_at',
  expediee: 'shipped_at',
  livree: 'delivered_at',
};

// Statuts autorisés (partagés entre le modèle, la route admin et les vues).
const STATUSES = ['en_attente', 'payee', 'expediee', 'livree', 'annulee'];

// Construit la timeline d'une commande : { cancelled, cancelledAt, steps }
// avec steps = [{ key, date, state }], state ∈ done | current | upcoming.
function buildTimeline(order) {
  const cancelled = order.status === 'annulee';
  const currentIdx = STEPS.indexOf(order.status); // -1 si annulée/inconnue
  const lastIdx = STEPS.length - 1;

  const steps = STEPS.map((key, i) => {
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

  return { cancelled, cancelledAt: order.cancelled_at || '', steps };
}

module.exports = { STEPS, STATUSES, DATE_FIELD, buildTimeline };
