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

// Associe un jeton de réinitialisation (et sa date d'expiration ISO UTC) à
// l'utilisateur. Retourne false si l'e-mail n'existe pas (l'appelant garde une
// réponse générique pour ne pas révéler l'existence d'un compte).
function setResetToken(email, token, expires) {
  const info = db.prepare(
    'UPDATE users SET reset_token = ?, reset_expires = ? WHERE email = ?'
  ).run(token, expires, email);
  return info.changes > 0;
}

// Retrouve un utilisateur par jeton (brut : usage interne uniquement, ne jamais
// exposer password_hash ni le jeton hors du modèle).
function findByResetToken(token) {
  if (!token) return null;
  return db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token) || null;
}

// Remplace le mot de passe et invalide le jeton (usage unique).
function resetPassword(id, password_hash) {
  db.prepare(
    "UPDATE users SET password_hash = ?, reset_token = '', reset_expires = NULL WHERE id = ?"
  ).run(password_hash, id);
}

module.exports = {
  findByEmail, findById, create, listCustomers, countCustomers,
  setResetToken, findByResetToken, resetPassword,
};
