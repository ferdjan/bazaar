'use strict';
const session = require('express-session');
const { db } = require('../db/connection');

// Store de session persistant adossé à better-sqlite3 (déjà présent comme
// dépendance) — évite d'ajouter le module natif `sqlite3`. Remplace le
// MemoryStore par défaut pour survivre aux redémarrages.

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    sess    TEXT NOT NULL,
    expires INTEGER NOT NULL
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)');

const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000;

function getExpiry(sess) {
  const maxAge = sess && sess.cookie && sess.cookie.maxAge;
  const age = maxAge && maxAge > 0 ? maxAge : DEFAULT_MAX_AGE;
  return Date.now() + age;
}

function clearExpiredSessions() {
  try {
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
  } catch (_) {
    /* best-effort */
  }
}

class SqliteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db
        .prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?')
        .get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) {
      cb(e);
    }
  }

  set(sid, sess, cb) {
    try {
      db.prepare(`
        INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
      `).run(sid, JSON.stringify(sess), getExpiry(sess));
      if (cb) cb(null);
    } catch (e) {
      if (cb) cb(e);
    }
  }

  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      if (cb) cb(null);
    } catch (e) {
      if (cb) cb(e);
    }
  }

  touch(sid, sess, cb) {
    try {
      db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(getExpiry(sess), sid);
      if (cb) cb(null);
    } catch (e) {
      if (cb) cb(e);
    }
  }
}

// Nettoyage périodique des sessions expirées (ne bloque pas l'arrêt du process).
function startCleanup(intervalMs = 15 * 60 * 1000) {
  const t = setInterval(clearExpiredSessions, intervalMs);
  if (t && t.unref) t.unref();
  return t;
}

module.exports = { SqliteStore, clearExpiredSessions, startCleanup };
