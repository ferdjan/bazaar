'use strict';
const { db } = require('../db/connection');

// Codes de réduction. Un coupon peut être un pourcentage (type 'percent')
// ou un montant fixe en dinars (type 'fixed').

function findByCode(code) {
  if (!code) return null;
  return db.prepare('SELECT * FROM coupons WHERE code = ?').get(code.toUpperCase()) || null;
}

// Retourne le montant de remise (DZD) pour un sous-total donné, ou null si
// le coupon est invalide/expiré/épuisé/non applicable. Vérifie côté serveur.
function discountFor(code, subtotal) {
  const c = findByCode(code);
  if (!c || !c.active) return null;
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return null;
  if (c.max_uses > 0 && c.used_count >= c.max_uses) return null;
  if (subtotal < c.min_amount) return null;

  if (c.type === 'percent') {
    return Math.min(subtotal, Math.floor((subtotal * c.value) / 100));
  }
  return Math.min(subtotal, c.value);
}

function listAll() {
  return db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
}

function create({ code, type, value, min_amount, max_uses, active, expires_at }) {
  const info = db.prepare(`
    INSERT INTO coupons (code, type, value, min_amount, max_uses, active, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    code.toUpperCase(), type, value, min_amount || 0, max_uses || 0, active ? 1 : 0, expires_at || null
  );
  return info.lastInsertRowid;
}

function remove(id) {
  db.prepare('DELETE FROM coupons WHERE id = ?').run(id);
}

module.exports = { findByCode, discountFor, listAll, create, remove };
