'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrations légères et idempotentes pour les bases déjà existantes.
// Le schéma neuf (schema.sql) crée directement les colonnes ; on ne touche ici
// qu'aux colonnes ajoutées après coup sur des bases historiques.
function migrate() {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!cols.includes('provider_id')) {
    db.exec("ALTER TABLE orders ADD COLUMN provider_id TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes('delivery_dzd')) {
    db.exec('ALTER TABLE orders ADD COLUMN delivery_dzd INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('paid_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN paid_at TEXT');
  }
  if (!cols.includes('shipped_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN shipped_at TEXT');
  }
  if (!cols.includes('delivered_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN delivered_at TEXT');
  }
  if (!cols.includes('cancelled_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN cancelled_at TEXT');
  }
  if (!cols.includes('carrier')) {
    db.exec("ALTER TABLE orders ADD COLUMN carrier TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes('tracking_number')) {
    db.exec("ALTER TABLE orders ADD COLUMN tracking_number TEXT NOT NULL DEFAULT ''");
  }
}

module.exports = { db, dbPath, migrate };
