'use strict';
const { db } = require('../db/connection');

// Ne jamais exposer password_hash hors du modèle.
function sanitize(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

function findByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
}

function findById(id) {
  return sanitize(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function create({ email, password_hash, name, role }) {
  const info = db.prepare(
    'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)'
  ).run(email, password_hash, name, role || 'customer');
  return findById(info.lastInsertRowid);
}

// Clients uniquement (les comptes admin ne sont pas des clients).
function listCustomers() {
  return db.prepare(
    "SELECT id, email, name, role, created_at FROM users WHERE role = 'customer' ORDER BY created_at DESC"
  ).all();
}

function countCustomers() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n;
}

module.exports = { findByEmail, findById, create, listCustomers, countCustomers };
