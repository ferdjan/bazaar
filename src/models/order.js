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

  // Réserve le coupon AVANT le décrément de stock, dans la même transaction :
  // un usage unique ne peut pas être consommé deux fois, et un échec annule
  // toute la commande (idempotent, atomique).
  if (data.order.coupon_code) {
    const r = db.prepare(
      'UPDATE coupons SET used_count = used_count + 1 WHERE code = ? AND active = 1 AND (max_uses = 0 OR used_count < max_uses)'
    ).run(data.order.coupon_code);
    if (r.changes !== 1) {
      const err = new Error('coupon invalide ou épuisé');
      err.code = 'COUPON_INVALID';
      throw err;
    }
  }

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
       provider_id, nom, email, telephone, adresse, ville, coupon_code, discount_dzd)
    VALUES
      (@ref, @user_id, @status, @total_dzd, @total_eur, @delivery_dzd, @payment_method, @payment_status,
       @provider_id, @nom, @email, @telephone, @adresse, @ville, @coupon_code, @discount_dzd)
  `);
  const info = insOrder.run({
    ...data.order,
    ref,
    delivery_dzd: data.order.delivery_dzd || 0,
    coupon_code: data.order.coupon_code || '',
    discount_dzd: data.order.discount_dzd || 0,
  });
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

const releaseStockTx = db.transaction((orderId, actorId, reason) => {
  const order = db.prepare('SELECT id, stock_released FROM orders WHERE id = ?').get(orderId);
  if (!order || order.stock_released) return false;
  const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ? AND product_id IS NOT NULL').all(orderId);
  const add = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  const event = db.prepare(`
    INSERT INTO inventory_events (order_id, product_id, qty, event_type, reason, actor_id)
    VALUES (?, ?, ?, 'release', ?, ?)
  `);
  for (const item of items) {
    add.run(item.qty, item.product_id);
    event.run(orderId, item.product_id, item.qty, reason, actorId || null);
  }
  db.prepare('UPDATE orders SET stock_released = 1 WHERE id = ?').run(orderId);
  return true;
});

function releaseStock(ref, actorId, reason = 'order_cancelled') {
  const order = db.prepare('SELECT id FROM orders WHERE ref = ?').get(ref);
  return order ? releaseStockTx(order.id, actorId, reason) : false;
}

function recordDeliveryIssue(ref, issue, actorId) {
  const allowed = ['failed', 'damaged', 'returning', 'returned'];
  if (!allowed.includes(issue)) return false;
  const order = db.prepare('SELECT id, status, delivery_status FROM orders WHERE ref = ?').get(ref);
  if (!order || order.status === 'annulee' || order.delivery_status === 'returned') return false;
  if (issue === 'returned') {
    db.prepare("UPDATE orders SET delivery_status = 'returned', delivery_issue = ?, returned_at = datetime('now') WHERE id = ?")
      .run(issue, order.id);
    recordHistory(order.id, order.status, order.status, { actorId, action: 'return_received' });
    return true;
  }
  db.prepare('UPDATE orders SET delivery_status = ?, delivery_issue = ? WHERE id = ?').run(issue, issue, order.id);
  recordHistory(order.id, order.status, order.status, { actorId, action: 'delivery_issue' });
  return true;
}

function returnReceived(ref, condition, actorId) {
  if (!['resellable', 'damaged'].includes(condition)) return false;
  const order = db.prepare('SELECT id, status, payment_status, delivery_status FROM orders WHERE ref = ?').get(ref);
  if (!order || order.delivery_status !== 'returned') return false;
  const released = condition === 'resellable' ? releaseStockTx(order.id, actorId, 'return_resellable') : false;
  const refund = order.payment_status === 'paid' ? db.prepare(
    "UPDATE orders SET refund_dzd = total_dzd WHERE id = ? AND refund_dzd = 0"
  ).run(order.id).changes > 0 : false;
  recordHistory(order.id, order.status, order.status, { actorId, action: condition === 'resellable' ? 'return_resellable' : 'return_damaged' });
  return released || refund || condition === 'damaged';
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

// Encaissement COD unique : seul un vendeur authentifié peut exécuter cette
// transition, et la condition SQL empêche les doubles confirmations.
function confirmCodPayment(ref, actorId, actorRole) {
  if (actorRole !== 'seller') return false;
  const tx = db.transaction(() => {
    const order = db.prepare(
      "SELECT id, status, payment_method, payment_status FROM orders WHERE ref = ?"
    ).get(ref);
    if (!order || order.payment_method !== 'cod' || order.status !== 'livree' || !['pending', 'paid'].includes(order.payment_status)) {
      return false;
    }
    const changed = db.prepare(`
      UPDATE orders
      SET status = 'payee', payment_status = 'paid', paid_at = COALESCE(paid_at, datetime('now'))
      WHERE id = ? AND status = 'livree' AND payment_method = 'cod' AND payment_status IN ('pending', 'paid')
    `).run(order.id);
    if (changed.changes !== 1) return false;
    recordHistory(order.id, 'livree', 'payee', { actorId, action: 'pay' });
    return true;
  });
  return tx();
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
  // Le statut payé est réservé aux confirmations vérifiées : webhook Stripe/
  // PayPal ou encaissement COD via confirmCodPayment. Jamais au formulaire admin.
  if (status === 'payee') return false;
  const idx = steps.indexOf(status);
  const payeeIdx = steps.indexOf('payee');
  const parts = [`status = '${status}'`]; // valeur déjà validée par la whitelist
  // Le paiement suit l'étape « payée ». Atteindre/dépasser payée → encaissé ;
  // régresser en-deçà de payée (ex. payee → livree) → redevient en attente,
  // sinon le chiffre d'affaires et le statut affiché divergent.
  if (idx >= payeeIdx) {
    parts.push("payment_status = 'paid'");
  } else if (order.status === 'payee') {
    parts.push("payment_status = 'pending'");
  }
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
    pay: null,
    ship: order.status === 'payee' || (order.status === 'en_attente' && order.payment_method === 'cod') ? 'expediee' : null,
    deliver: order.status === 'expediee' ? 'livree' : null,
     cancel: order.status === 'annulee' ? null : 'annulee',
  }[action];
  if (!next) return false;
  const tracking = action === 'ship'
    ? opts
    : { ...opts, carrier: order.carrier, trackingNumber: order.tracking_number };
  const changed = setStatus(ref, next, { ...tracking, actorRole: opts.actorRole, action });
  if (changed && action === 'cancel' && order.status === 'en_attente') {
    releaseStock(ref, opts.actorId, 'order_cancelled');
  }
  return changed;
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
    "SELECT COALESCE(SUM(total_dzd - refund_dzd), 0) AS n FROM orders WHERE payment_status = 'paid' AND status != 'annulee'"
  ).get().n;
  return { totalOrders, revenue };
}

module.exports = {
  create, findByRef, findById, listHistory, listByUser, listAll, listRecent, listRecentByStatus, statusCounts,
  setProviderId, findByProviderId, markPaid,
  setStatus, actionFor, confirmCodPayment, updatePaymentStatus, stats,
  releaseStock, recordDeliveryIssue, returnReceived,
};
