'use strict';
const crypto = require('crypto');
const QRCode = require('qrcode');
const { db } = require('../db/connection');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function findByOrderId(orderId) {
  return db.prepare('SELECT * FROM shipment_labels WHERE order_id = ?').get(orderId) || null;
}

function findByToken(token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
  return db.prepare(`
    SELECT l.*, o.ref, o.status, o.payment_method, o.payment_status
    FROM shipment_labels l JOIN orders o ON o.id = l.order_id
    WHERE l.token_hash = ? AND l.revoked_at IS NULL
  `).get(hashToken(token)) || null;
}

function findByOrderIdWithToken(orderId) {
  return findByOrderId(orderId);
}

function issue(orderId) {
  const token = createToken();
  const old = findByOrderId(orderId);
  const tx = db.transaction(() => {
    if (old) {
      // Une commande ne possède qu'un QR actif : remplacer son hash révoque
      // immédiatement l'ancien jeton sans exposer de jeton historique.
      db.prepare(`
        UPDATE shipment_labels
        SET token_hash = ?, printed_at = datetime('now'), revoked_at = NULL
        WHERE id = ?
      `).run(hashToken(token), old.id);
    } else {
      db.prepare(`
        INSERT INTO shipment_labels (order_id, token_hash, printed_at)
        VALUES (?, ?, datetime('now'))
      `).run(orderId, hashToken(token));
    }
  });
  tx();
  return token;
}

async function toDataUrl(token, baseUrl) {
  return QRCode.toDataURL(`${baseUrl.replace(/\/$/, '')}/scan/${token}`, {
    errorCorrectionLevel: 'M', margin: 2, width: 260,
  });
}

module.exports = { findByOrderId, findByOrderIdWithToken, findByToken, issue, toDataUrl };
