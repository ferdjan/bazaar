'use strict';
const paypal = require('@paypal/checkout-server-sdk');
const config = require('../../config');
const { dzdToEurString } = require('../currency');
const orderModel = require('../../models/order');
const { logger } = require('../logger');

function client() {
  const Environment =
    config.paypal.mode === 'live'
      ? paypal.core.LiveEnvironment
      : paypal.core.SandboxEnvironment;
  return new paypal.core.PayPalHttpClient(
    new Environment(config.paypal.clientId, config.paypal.clientSecret)
  );
}

function apiBase() {
  return config.paypal.mode === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

// Crée un ordre PayPal dont le montant est fixé côté serveur. La référence
// locale est portée par `reference_id` (et custom_id/invoice_id) pour pouvoir
// lier le paiement à la commande au retour.
async function createOrder(ref, totalEur) {
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer('return=representation');
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: ref,
      custom_id: ref,
      invoice_id: ref,
      amount: { currency_code: 'EUR', value: totalEur },
    }],
    application_context: {
      brand_name: 'Bazaar',
      return_url: config.baseUrl + '/paiement/paypal/succes?ref=' + ref,
      cancel_url: config.baseUrl + '/paiement/paypal/annulation?ref=' + ref,
    },
  });
  const response = await client().execute(request);
  const approval = (response.result.links || []).find((l) => l.rel === 'approve');
  return { orderId: response.result.id, redirectUrl: approval ? approval.href : null };
}

async function initiate(order) {
  if (!config.paypal.clientId || !config.paypal.clientSecret) {
    throw new Error('PayPal non configuré (PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET manquants).');
  }
  const { orderId, redirectUrl } = await createOrder(order.ref, dzdToEurString(order.total_dzd));
  return { redirectUrl, providerId: orderId };
}

async function capture(paypalOrderId) {
  const request = new paypal.orders.OrdersCaptureRequest(paypalOrderId);
  request.prefer('return=representation');
  const response = await client().execute(request);
  return response.result;
}

function verifyAmount(amount, order) {
  if (!amount) return { ok: false, reason: 'no_amount' };
  if ((amount.currency_code || '').toUpperCase() !== 'EUR') {
    return { ok: false, reason: 'currency_mismatch' };
  }
  const expected = parseFloat(dzdToEurString(order.total_dzd));
  const actual = parseFloat(amount.value);
  if (!Number.isFinite(actual) || Math.abs(actual - expected) >= 0.01) {
    return { ok: false, reason: 'amount_mismatch' };
  }
  return { ok: true };
}

// Vérifie le résultat d'une capture (représentation d'ordre) : statut,
// référence locale, montant et devise doivent correspondre à la commande.
function verifyCapture(result, order) {
  if (!result || result.status !== 'COMPLETED') return { ok: false, reason: 'not_completed' };
  const pu = (result.purchase_units || [])[0];
  if (!pu) return { ok: false, reason: 'no_purchase_unit' };
  if (pu.reference_id !== order.ref) return { ok: false, reason: 'ref_mismatch' };
  return verifyAmount(pu.amount, order);
}

// Capture un paiement en utilisant l'identifiant PayPal stocké côté serveur
// (jamais un token venu de l'URL), puis vérifie montant/devise/référence et
// marque la commande payée de façon idempotente.
async function captureAndVerify(order) {
  if (!order || !order.provider_id) return { ok: false, reason: 'no_provider_id' };
  const result = await capture(order.provider_id);
  const check = verifyCapture(result, order);
  if (check.ok) orderModel.markPaid(order.ref);
  return check;
}

// --- Webhook PayPal ---

async function getAccessToken() {
  const cred = Buffer.from(config.paypal.clientId + ':' + config.paypal.clientSecret).toString('base64');
  const resp = await fetch(apiBase() + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + cred,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await resp.json();
  return data.access_token;
}

// Vérifie la signature d'un webhook PayPal via l'API dédiée.
async function verifyWebhookSignature(req) {
  if (!config.paypal.webhookId) return { ok: false, reason: 'webhook_not_configured' };
  const h = req.headers;
  const required = [
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-sig',
    'paypal-transmission-time',
  ];
  if (required.some((k) => !h[k])) return { ok: false, reason: 'missing_headers' };

  let eventObj;
  try {
    eventObj = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(req.body.toString());
  } catch (_) {
    return { ok: false, reason: 'bad_json' };
  }

  const accessToken = await getAccessToken();
  const resp = await fetch(apiBase() + '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + accessToken,
    },
    body: JSON.stringify({
      auth_algo: h['paypal-auth-algo'],
      cert_url: h['paypal-cert-url'],
      transmission_id: h['paypal-transmission-id'],
      transmission_sig: h['paypal-transmission-sig'],
      transmission_time: h['paypal-transmission-time'],
      webhook_id: config.paypal.webhookId,
      webhook_event: eventObj,
    }),
  });
  const data = await resp.json();
  return { ok: data && data.verification_status === 'SUCCESS', reason: data && data.verification_status };
}

// Vérifie la ressource de capture d'un webhook (statut + montant + devise).
function verifyWebhookCapture(resource, order) {
  if (!resource || resource.status !== 'COMPLETED') return { ok: false, reason: 'not_completed' };
  return verifyAmount(resource.amount, order);
}

async function handleWebhook(req, res) {
  const sig = await verifyWebhookSignature(req);
  if (!sig.ok) return res.status(400).json({ received: false, error: 'signature_invalide' });

  let event;
  try {
    event = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(req.body.toString());
  } catch (_) {
    return res.status(400).json({ received: false, error: 'bad_json' });
  }

  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const resource = event.resource || {};
    const related = (resource.supplementary_data && resource.supplementary_data.related_ids) || {};
    const paypalOrderId = related.order_id || '';
    const order = orderModel.findByProviderId(paypalOrderId);
    if (!order) {
      logger.warn('paypal webhook : commande introuvable', { paypalOrderId });
      return res.status(404).json({ received: false, error: 'order_not_found' });
    }
    const check = verifyWebhookCapture(resource, order);
    if (!check.ok) {
      logger.warn('paypal webhook rejeté', { ref: order.ref, reason: check.reason });
      return res.status(400).json({ received: false, error: check.reason });
    }
    orderModel.markPaid(order.ref);
  }
  res.json({ received: true });
}

module.exports = {
  initiate,
  capture,
  captureAndVerify,
  verifyCapture,
  verifyWebhookCapture,
  verifyWebhookSignature,
  handleWebhook,
};
