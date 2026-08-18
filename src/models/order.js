'use strict';
const { db } = require('../db/connection');
const crypto = require('crypto');

// 8 octets aléatoires (16 hex) : l'identifiant public n'est pas une preuve
// d'identité, mais il doit rester difficilement devinable.
function generateRef() {
  return 'CMD-' + crypto.randomBytes(8).toString('hex').toUpperCase();
}

function withItems(order) {
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  return order;
}

// Création atomique : commande + articles + décrément de stock vérifié.
// Le stock est décrémenté avec une condition `stock >= quantité` afin de ne
// JAMAIS masquer une insuffisance (l'ancien MAX(0, stock - ?) tronquait).
const createTx = db.transaction((data) => {
  const ref = generateRef();

  const decStock = db.prepare(
    'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ? AND active = 1'
  );
  for (const it of data.items) {
    if (it.productId == null) continue;
    const r = decStock.run(it.qty, it.productId, it.qty);
    if (r.changes !== 1) {
      const err = new Error('stock insuffisant ou produit indisponible');
      err.code = 'STOCK_INSUFFICIENT';
      throw err; // annule toute la transaction
    }
  }

  const insOrder = db.prepare(`
    INSERT INTO orders
      (ref, user_id, status, total_dzd, total_eur, delivery_dzd, payment_method, payment_status,
       provider_id, nom, email, telephone, adresse, ville)
    VALUES
      (@ref, @user_id, @status, @total_dzd, @total_eur, @delivery_dzd, @payment_method, @payment_status,
       @provider_id, @nom, @email, @telephone, @adresse, @ville)
  `);
  const info = insOrder.run({ ...data.order, ref, delivery_dzd: data.order.delivery_dzd || 0 });
  const orderId = info.lastInsertRowid;

  const insItem = db.prepare(
    'INSERT INTO order_items (order_id, product_id, name, price_dzd, qty, size) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const it of data.items) {
    insItem.run(orderId, it.productId, it.name, it.priceDzd, it.qty, it.size || '');
  }
  return ref;
});

function create(data) {
  const ref = createTx(data);
  return findByRef(ref);
}

function findByRef(ref) {
  return withItems(db.prepare('SELECT * FROM orders WHERE ref = ?').get(ref));
}

function findById(id) {
  return withItems(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}

// Lie la commande locale à l'identifiant du fournisseur (session Stripe ou
// ordre PayPal). Indispensable pour vérifier que le paiement appartient bien
// à cette commande avant tout changement d'état.
function setProviderId(ref, providerId) {
  db.prepare('UPDATE orders SET provider_id = ? WHERE ref = ?').run(providerId || '', ref);
}

function findByProviderId(providerId) {
  if (!providerId) return null;
  return withItems(db.prepare('SELECT * FROM orders WHERE provider_id = ?').get(providerId));
}

// Passage à "paid/payee" idempotent : ne fait rien si déjà payé. Un rejeu de
// webhook ou une double confirmation ne produit aucun effet supplémentaire.
function markPaid(ref) {
  const info = db.prepare(
    "UPDATE orders SET payment_status = 'paid', status = 'payee' WHERE ref = ? AND payment_status != 'paid'"
  ).run(ref);
  return info.changes > 0;
}

function listByUser(userId) {
  return db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function listAll() {
  return db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
}

function updateStatus(ref, status) {
  db.prepare('UPDATE orders SET status = ? WHERE ref = ?').run(status, ref);
}

function updatePaymentStatus(ref, paymentStatus) {
  db.prepare('UPDATE orders SET payment_status = ? WHERE ref = ?').run(paymentStatus, ref);
}

function stats() {
  const totalOrders = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const revenue = db.prepare(
    "SELECT COALESCE(SUM(total_dzd), 0) AS n FROM orders WHERE status != 'annulee'"
  ).get().n;
  return { totalOrders, revenue };
}

module.exports = {
  create, findByRef, findById, listByUser, listAll,
  setProviderId, findByProviderId, markPaid,
  updateStatus, updatePaymentStatus, stats,
};
