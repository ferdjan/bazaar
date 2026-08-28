'use strict';
const router = require('express').Router();
const orderModel = require('../models/order');
const payment = require('../services/payment');
const stripe = require('../services/payment/stripe');
const paypal = require('../services/payment/paypal');
const { paymentLimiter } = require('../middleware/rateLimit');
const { logger } = require('../services/logger');

const ONLINE = ['stripe', 'paypal'];

function canAccessPayment(req, order) {
  const user = req.session && req.session.user;
  if (user && (user.role === 'admin' || order.user_id === user.id)) return true;
  const refs = (req.session && req.session.paymentRefs) || [];
  return refs.includes(order.ref);
}

// GET : affichage uniquement, AUCUNE opération financière.
router.get('/paiement/:method/:ref', (req, res) => {
  const { method, ref } = req.params;
  const order = orderModel.findByRef(ref);
  if (!order) return res.status(404).render('pages/404', { title: '404' });
  if (!canAccessPayment(req, order)) return res.status(404).render('pages/404', { title: '404' });

  if (method === 'cod') {
    return res.render('pages/order-confirmation', { title: 'order', order });
  }

  // stripe / paypal : page avec bouton "Payer" (le POST crée la session/ordre).
  return res.render('pages/payment', { title: 'order', order });
});

// POST : crée la session Stripe ou l'ordre PayPal et redirige vers le
// fournisseur. Protégé par CSRF + rate limit. La confirmation (capture) est
// idempotente et vérifiée côté serveur.
router.post('/paiement/:method/:ref', paymentLimiter, async (req, res, next) => {
  const { method, ref } = req.params;
  const order = orderModel.findByRef(ref);
  if (!order) return res.status(404).render('pages/404', { title: '404' });
  if (!canAccessPayment(req, order)) return res.status(404).render('pages/404', { title: '404' });
  if (!ONLINE.includes(method) || order.payment_method !== method) {
    return res.redirect('/commande/' + ref);
  }
  if (order.payment_status === 'paid') {
    return res.redirect('/commande/' + ref);
  }

  try {
    const { redirectUrl, providerId } = await payment.initiate(method, order);
    if (providerId) orderModel.setProviderId(order.ref, providerId);
    if (redirectUrl) return res.redirect(redirectUrl);
    return res.redirect('/commande/' + ref);
  } catch (err) {
    // Erreur générique côté client ; détail journalisé côté serveur.
    return next(err);
  }
});

// --- Stripe : retour du fournisseur (GET, simple vérification idempotente) ---

router.get('/paiement/stripe/succes', async (req, res) => {
  const ref = req.query.ref;
  const order = orderModel.findByRef(ref);
  if (!order || order.payment_method !== 'stripe') {
    return res.render('pages/order-confirmation', { title: 'order', order: order || null, cancelled: true });
  }
  if (req.query.session_id) {
    try {
      await stripe.confirmBySession(req.query.session_id, ref);
    } catch (err) {
      logger.error('stripe confirmation échouée', { ref, err: err.message });
    }
  }
  res.render('pages/order-confirmation', { title: 'order', order: orderModel.findByRef(ref) });
});

router.get('/paiement/stripe/annulation', (req, res) => {
  const order = req.query.ref ? orderModel.findByRef(req.query.ref) : null;
  res.render('pages/order-confirmation', { title: 'order', order, cancelled: true });
});

// --- PayPal : retour du fournisseur ---

router.get('/paiement/paypal/succes', async (req, res) => {
  const ref = req.query.ref;
  const order = orderModel.findByRef(ref);
  if (!order || order.payment_method !== 'paypal') {
    return res.render('pages/order-confirmation', { title: 'order', order: order || null, cancelled: true });
  }

  // On ne fait jamais confiance au token de l'URL : la capture utilise l'ordre
  // PayPal stocké côté serveur (provider_id), et on vérifie montant/devise/réf.
  const token = req.query.token;
  if (!order.provider_id || (token && token !== order.provider_id)) {
    logger.warn('paypal retour incohérent', { ref });
    return res.render('pages/order-confirmation', { title: 'order', order, cancelled: true });
  }

  try {
    await paypal.captureAndVerify(order);
  } catch (err) {
    logger.error('paypal capture échouée', { ref, err: err.message });
  }
  res.render('pages/order-confirmation', { title: 'order', order: orderModel.findByRef(ref) });
});

router.get('/paiement/paypal/annulation', (req, res) => {
  const order = req.query.ref ? orderModel.findByRef(req.query.ref) : null;
  res.render('pages/order-confirmation', { title: 'order', order, cancelled: true });
});

module.exports = router;
