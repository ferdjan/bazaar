'use strict';
const config = require('../../config');
const { dzdToEurCents } = require('../currency');
const orderModel = require('../../models/order');

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

// Vérifie le statut de la session après redirection (utile sans webhook local).
async function confirmBySession(sessionId, ref) {
  const s = getStripe();
  const session = await s.checkout.sessions.retrieve(sessionId);
  if (session.payment_status === 'paid') {
    orderModel.updatePaymentStatus(ref, 'paid');
    orderModel.updateStatus(ref, 'payee');
    return true;
  }
  return false;
}

// Webhook : le corps brut (Buffer) est requis pour la vérification de signature.
async function handleWebhook(req, res) {
  const s = getStripe();
  let event;
  try {
    event = s.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret);
  } catch (err) {
    return res.status(400).send('Webhook Error: ' + err.message);
  }
  if (event.type === 'checkout.session.completed') {
    const ref = event.data.object.client_reference_id;
    if (ref) {
      orderModel.updatePaymentStatus(ref, 'paid');
      orderModel.updateStatus(ref, 'payee');
    }
  }
  res.json({ received: true });
}

module.exports = { initiate, confirmBySession, handleWebhook };
