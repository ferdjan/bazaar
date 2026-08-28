'use strict';
const { db } = require('../db/connection');

// Avis clients : un client ne peut laisser qu'un seul avis par produit
// (contrainte UNIQUE product_id + user_id).

function listByProduct(productId) {
  return db.prepare(`
    SELECT r.*, u.name AS author_name
    FROM reviews r
    JOIN users u ON u.id = r.user_id
    WHERE r.product_id = ?
    ORDER BY r.created_at DESC, r.id DESC
  `).all(productId);
}

// Note moyenne (1 décimal) et nombre d'avis d'un produit.
function statsForProduct(productId) {
  const row = db.prepare(
    'SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS avg FROM reviews WHERE product_id = ?'
  ).get(productId);
  return { count: row.count, avg: Math.round(row.avg * 10) / 10 };
}

function findForUser(productId, userId) {
  return db.prepare('SELECT * FROM reviews WHERE product_id = ? AND user_id = ?').get(productId, userId) || null;
}

// Vérifie qu'un utilisateur a reçu le produit : une commande seulement créée
// ou expédiée ne suffit pas pour publier un avis.
function hasOrdered(userId, productId) {
  return !!db.prepare(`
    SELECT 1
    FROM orders o
    JOIN order_items i ON i.order_id = o.id
    WHERE o.user_id = ? AND i.product_id = ? AND o.status IN ('livree', 'payee')
    LIMIT 1
  `).get(userId, productId);
}

// Insère ou met à jour l'avis (upsert). Retourne true si enregistré.
function upsert(productId, userId, rating, comment) {
  db.prepare(`
    INSERT INTO reviews (product_id, user_id, rating, comment)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(product_id, user_id)
    DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = datetime('now')
  `).run(productId, userId, rating, comment);
  return true;
}

module.exports = { listByProduct, statsForProduct, findForUser, hasOrdered, upsert };
