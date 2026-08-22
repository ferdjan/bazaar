'use strict';
const router = require('express').Router();
const config = require('../config');
const orderModel = require('../models/order');
const shipmentLabel = require('../services/shipmentLabel');
const { requireSeller } = require('../middleware/auth');

function renderScan(req, res, token, error = null) {
  const label = shipmentLabel.findByToken(token);
  const order = label ? orderModel.findById(label.order_id) : null;
  return res.render('pages/scan', { title: 'scan.title', token, label, order, error });
}

// Le QR ouvre directement cette page. La validation métier reste côté serveur.
router.get('/scan', requireSeller, (req, res) => {
  return res.render('pages/scan', {
    title: 'scan.title',
    token: '',
    label: null,
    order: null,
    error: null,
  });
});

router.get('/scan/:token([a-fA-F0-9]{64})', requireSeller, (req, res) => {
  return renderScan(req, res, req.params.token.toLowerCase());
});

router.post('/scan', requireSeller, (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token.toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(token) || !shipmentLabel.findByToken(token)) {
    return renderScan(req, res, token, 'scan.invalid');
  }
  return res.redirect('/scan/' + token);
});

router.post('/scan/payer', requireSeller, (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token.toLowerCase() : '';
  const label = shipmentLabel.findByToken(token);
  if (!label) return renderScan(req, res, token, 'scan.invalid');
  const ok = orderModel.confirmCodPayment(label.ref, req.session.user.id, req.session.user.role);
  if (!ok) return renderScan(req, res, token, 'scan.not_payable');
  req.session.flash = { type: 'success', key: 'scan.payment_done' };
  return res.redirect('/scan/' + token);
});

module.exports = router;
