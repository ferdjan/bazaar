'use strict';
const { db } = require('../db/connection');
const crypto = require('crypto');

function generateRef() {
  return 'CMD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function withItems(order) {
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  return order;
}

// Création atomique : commande + articles + décrément du stock.
const createTx = db.transaction((data) => {
  const ref = generateRef();
  const insOrder = db.prepare(`
    INSERT INTO orders
      (ref, user_id, status, total_dzd, total_eur, payment_method, payment_status,
       nom, email, telephone, adresse, ville)
    VALUES
      (@ref, @user_id, @status, @total_dzd, @total_eur, @payment_method, @payment_status,
       @nom, @email, @telephone, @adresse, @ville)
  `);
  const info = insOrder.run({ ...data.order, ref });
  const orderId = info.lastInsertRowid;

  const insItem = db.prepare(
    'INSERT INTO order_items (order_id, product_id, name, price_dzd, qty, size) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const decStock = db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?');
  for (const it of data.items) {
    insItem.run(orderId, it.productId, it.name, it.priceDzd, it.qty, it.size || '');
    if (it.productId) decStock.run(it.qty, it.productId);
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
  updateStatus, updatePaymentStatus, stats,
};
