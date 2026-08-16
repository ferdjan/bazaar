'use strict';
const paypal = require('@paypal/checkout-server-sdk');
const config = require('../../config');
const { dzdToEurString } = require('../currency');

function client() {
  const Environment =
    config.paypal.mode === 'live'
      ? paypal.core.LiveEnvironment
      : paypal.core.SandboxEnvironment;
  return new paypal.core.PayPalHttpClient(
    new Environment(config.paypal.clientId, config.paypal.clientSecret)
  );
}

async function createOrder(ref, totalEur) {
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer('return=representation');
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: ref,
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

module.exports = { initiate, capture };
