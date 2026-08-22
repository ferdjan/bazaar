'use strict';
const { db } = require('../db/connection');
const crypto = require('crypto');
const { STATUSES, stepsFor } = require('../services/orderStatus');

// Colonne *_at tamponnée lors du passage à chaque étape de progression.
// `en_attente` n'y figure pas : sa date est `created_at` (date de commande).
const AT_FIELD = {
  payee: 'paid_at',
  expediee: 'shipped_at',
  livree: 'delivered_at',
};

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

function listHistory(ref) {
  return db.prepare(`
    SELECT h.*, u.name AS actor_name
    FROM order_status_history h
    JOIN orders o ON o.id = h.order_id
    LEFT JOIN users u ON u.id = h.actor_id
    WHERE o.ref = ?
    ORDER BY h.created_at DESC, h.id DESC
  `).all(ref);
}

function recordHistory(orderId, fromStatus, toStatus, opts = {}) {
  db.prepare(`
    INSERT INTO order_status_history
      (order_id, actor_id, from_status, to_status, action, carrier, tracking_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    orderId,
    opts.actorId || null,
    fromStatus || null,
    toStatus,
    opts.action || 'status_update',
    opts.carrier || '',
    opts.trackingNumber || ''
  );
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
    "UPDATE orders SET payment_status = 'paid', status = 'payee', paid_at = COALESCE(paid_at, datetime('now')) WHERE ref = ? AND payment_status != 'paid'"
  ).run(ref);
  return info.changes > 0;
}

function listByUser(userId) {
  return db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function listAll() {
  return db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
}

// Dernières commandes (tableau de bord) : LIMIT côté SQL, pas de slice JS.
function listRecent(limit = 10) {
  return db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit);
}

function listRecentByStatus(status, limit = 10) {
  return db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit);
}

function statusCounts() {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const row of db.prepare('SELECT status, COUNT(*) AS count FROM orders GROUP BY status').all()) {
    counts[row.status] = row.count;
  }
  return counts;
}

// Met à jour le statut en tamponnant la date de l'étape franchie (idempotent
// via COALESCE) et en effaçant les dates des étapes AVAL lors d'une régression
// (ex. livree → expediee efface delivered_at). Enregistre aussi transporteur et
// n° de suivi (déjà nettoyés/tronqués par la route).
function setStatus(ref, status, opts = {}) {
  if (!STATUSES.includes(status)) return false;
  const carrier = opts.carrier || '';
  const trackingNumber = opts.trackingNumber || '';

  if (status === 'annulee') {
    const order = db.prepare('SELECT id, status FROM orders WHERE ref = ?').get(ref);
    if (!order || order.status === 'annulee') return false;
    db.prepare(
      "UPDATE orders SET status = 'annulee', cancelled_at = COALESCE(cancelled_at, datetime('now')), carrier = ?, tracking_number = ? WHERE ref = ?"
    ).run(carrier, trackingNumber, ref);
    recordHistory(order.id, order.status, status, { ...opts, carrier, trackingNumber });
    return true;
  }

  const order = db.prepare('SELECT id, status, payment_method FROM orders WHERE ref = ?').get(ref);
  if (!order) return false;

  const steps = stepsFor(order.payment_method);
  const idx = steps.indexOf(status);
  const parts = [`status = '${status}'`]; // valeur déjà validée par la whitelist
  // Seul le statut métier « payée » confirme un encaissement. Une expédition
  // ou une livraison COD ne doit pas gonfler le chiffre d'affaires.
  if (status === 'payee') parts.push("payment_status = 'paid'");
  if (AT_FIELD[status]) {
    parts.push(`${AT_FIELD[status]} = COALESCE(${AT_FIELD[status]}, datetime('now'))`);
  }
  for (let i = idx + 1; i < steps.length; i++) {
    const f = AT_FIELD[steps[i]];
    if (f) parts.push(`${f} = NULL`);
  }
  parts.push('cancelled_at = NULL');
  parts.push('carrier = ?', 'tracking_number = ?');

  db.prepare(`UPDATE orders SET ${parts.join(', ')} WHERE ref = ?`).run(carrier, trackingNumber, ref);
  if (order.status !== status || carrier || trackingNumber) {
    recordHistory(order.id, order.status, status, { ...opts, carrier, trackingNumber });
  }
  return true;
}

function actionFor(ref, action, opts = {}) {
  const order = db.prepare(
    'SELECT status, payment_method, carrier, tracking_number FROM orders WHERE ref = ?'
  ).get(ref);
  if (!order) return false;
  const next = {
    // Les paiements Stripe/PayPal doivent être confirmés par leur fournisseur,
    // jamais par une action admin locale.
    pay: order.status === 'livree' && order.payment_method === 'cod' ? 'payee' : null,
    ship: order.status === 'payee' || (order.status === 'en_attente' && order.payment_method === 'cod') ? 'expediee' : null,
    deliver: order.status === 'expediee' ? 'livree' : null,
    cancel: order.status === 'annulee' ? null : 'annulee',
  }[action];
  if (!next) return false;
  const tracking = action === 'ship'
    ? opts
    : { ...opts, carrier: order.carrier, trackingNumber: order.tracking_number };
  return setStatus(ref, next, { ...tracking, action });
}

function updatePaymentStatus(ref, paymentStatus) {
  db.prepare('UPDATE orders SET payment_status = ? WHERE ref = ?').run(paymentStatus, ref);
}

// Le chiffre d'affaires ne compte que l'argent réellement encaissé :
// commandes payées et non annulées. Les commandes « en_attente » (paiement
// pas encore reçu) sont exclues.
function stats() {
  const totalOrders = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const revenue = db.prepare(
    "SELECT COALESCE(SUM(total_dzd), 0) AS n FROM orders WHERE payment_status = 'paid' AND status != 'annulee'"
  ).get().n;
  return { totalOrders, revenue };
}

module.exports = {
  create, findByRef, findById, listHistory, listByUser, listAll, listRecent, listRecentByStatus, statusCounts,
  setProviderId, findByProviderId, markPaid,
  setStatus, actionFor, updatePaymentStatus, stats,
};
