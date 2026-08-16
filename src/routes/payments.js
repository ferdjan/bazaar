'use strict';
const router = require('express').Router();
const orderModel = require('../models/order');
const payment = require('../services/payment');
const stripe = require('../services/payment/stripe');
const paypal = require('../services/payment/paypal');

router.get('/paiement/:method/:ref', async (req, res) => {
  const { method, ref } = req.params;
  const order = orderModel.findByRef(ref);
  if (!order) return res.status(404).render('pages/404', { title: '404' });

  if (method === 'cod') {
    return res.render('pages/order-confirmation', { title: 'order', order });
  }

  try {
    const { redirectUrl } = await payment.initiate(method, order);
    if (redirectUrl) return res.redirect(redirectUrl);
    return res.redirect('/commande/' + ref);
  } catch (err) {
    console.error(err);
    return res.status(500).render('pages/500', { title: '500', message: err.message });
  }
});

router.get('/paiement/stripe/succes', async (req, res) => {
  const ref = req.query.ref;
  try {
    if (req.query.session_id) await stripe.confirmBySession(req.query.session_id, ref);
  } catch (err) {
    console.error(err);
  }
  const order = orderModel.findByRef(ref);
  res.render('pages/order-confirmation', { title: 'order', order });
});

router.get('/paiement/stripe/annulation', (req, res) => {
  const order = req.query.ref ? orderModel.findByRef(req.query.ref) : null;
  res.render('pages/order-confirmation', { title: 'order', order, cancelled: true });
});

router.get('/paiement/paypal/succes', async (req, res) => {
  const ref = req.query.ref;
  try {
    const result = await paypal.capture(req.query.token);
    if (result && result.status === 'COMPLETED') {
      orderModel.updatePaymentStatus(ref, 'paid');
      orderModel.updateStatus(ref, 'payee');
    }
  } catch (err) {
    console.error(err);
  }
  const order = orderModel.findByRef(ref);
  res.render('pages/order-confirmation', { title: 'order', order });
});

router.get('/paiement/paypal/annulation', (req, res) => {
  const order = req.query.ref ? orderModel.findByRef(req.query.ref) : null;
  res.render('pages/order-confirmation', { title: 'order', order, cancelled: true });
});

module.exports = router;
