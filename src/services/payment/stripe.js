'use strict';
const config = require('../../config');
const { dzdToEurCents } = require('../currency');
const orderModel = require('../../models/order');
const { logger } = require('../logger');

let stripe;
function getStripe() {
  if (!config.stripe.secretKey) throw new Error('Stripe non configuré (STRIPE_SECRET_KEY manquant).');
  if (!stripe) stripe = require('stripe')(config.stripe.secretKey);
  return stripe;
}

// Crée une session de paiement Stripe Checkout facturée en EUR.
async function initiate(order) {
  const s = getStripe();
  const session = await s.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: { name: 'Commande ' + order.ref },
        unit_amount: dzdToEurCents(order.total_dzd),
      },
      quantity: 1,
    }],
    client_reference_id: order.ref,
    success_url: config.baseUrl + '/paiement/stripe/succes?ref=' + order.ref + '&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: config.baseUrl + '/paiement/stripe/annulation?ref=' + order.ref,
  });
  return { redirectUrl: session.url, providerId: session.id };
}

// Vérification serveur complète d'une session Stripe avant tout changement
// d'état. Ne jamais marquer "paid" sur simple `payment_status === 'paid'` :
// la session doit appartenir à LA commande, à la bonne méthode, au bon
// montant et à la bonne devise.
function verifyStripeSession(session, ref) {
  if (!session) return { ok: false, reason: 'no_session' };
  if (session.payment_status !== 'paid') return { ok: false, reason: 'not_paid' };
  if (session.client_reference_id !== ref) return { ok: false, reason: 'ref_mismatch' };

  const order = orderModel.findByRef(ref);
  if (!order) return { ok: false, reason: 'order_not_found' };
  if (order.payment_method !== 'stripe') return { ok: false, reason: 'method_mismatch' };

  // La session doit être celle créée pour cette commande (si enregistrée).
  if (order.provider_id && session.id && order.provider_id !== session.id) {
    return { ok: false, reason: 'provider_mismatch' };
  }

  const expected = dzdToEurCents(order.total_dzd);
  if (typeof session.amount_total !== 'number' || session.amount_total !== expected) {
    return { ok: false, reason: 'amount_mismatch' };
  }
  if ((session.currency || '').toLowerCase() !== 'eur') {
    return { ok: false, reason: 'currency_mismatch' };
  }
  return { ok: true };
}

// Vérifie le statut de la session après redirection (sans webhook local).
// Idempotent : marque "paid" une seule fois, uniquement après vérification.
async function confirmBySession(sessionId, ref) {
  const s = getStripe();
  const session = await s.checkout.sessions.retrieve(sessionId);
  const check = verifyStripeSession(session, ref);
  if (!check.ok) return check;
  orderModel.markPaid(ref);
  return { ok: true };
}

// Webhook : corps brut (Buffer) requis pour la vérification de signature.
async function handleWebhook(req, res) {
  const s = getStripe();
  let event;
  try {
    event = s.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret);
  } catch (err) {
    return res.status(400).send('Webhook Error: signature invalide.');
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const ref = session && session.client_reference_id;
    if (!ref) return res.status(400).json({ received: false, error: 'ref_missing' });
    const check = verifyStripeSession(session, ref);
    if (!check.ok) {
      logger.warn('stripe webhook rejeté', { ref, reason: check.reason });
      return res.status(400).json({ received: false, error: check.reason });
    }
    orderModel.markPaid(ref);
  }
  res.json({ received: true });
}

module.exports = { initiate, confirmBySession, verifyStripeSession, handleWebhook };
