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
  // Les anciennes bases avaient un CHECK limité à admin/customer. SQLite ne
  // sait pas modifier ce CHECK avec ALTER TABLE : on reconstruit uniquement
  // cette table en conservant les identifiants et les mots de passe.
  const userSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (userSql && !String(userSql.sql).includes("'seller'")) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'seller', 'customer')),
        reset_token TEXT NOT NULL DEFAULT '',
        reset_expires TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, email, password_hash, name, role, reset_token, reset_expires, created_at)
        SELECT id, email, password_hash, name, role, reset_token, reset_expires, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    db.pragma('foreign_keys = ON');
  }
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
  if (!cols.includes('delivery_status')) db.exec("ALTER TABLE orders ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending'");
  if (!cols.includes('delivery_issue')) db.exec("ALTER TABLE orders ADD COLUMN delivery_issue TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('stock_released')) db.exec('ALTER TABLE orders ADD COLUMN stock_released INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('refund_dzd')) db.exec('ALTER TABLE orders ADD COLUMN refund_dzd INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('returned_at')) db.exec('ALTER TABLE orders ADD COLUMN returned_at TEXT');
  if (!cols.includes('coupon_code')) db.exec("ALTER TABLE orders ADD COLUMN coupon_code TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('discount_dzd')) db.exec('ALTER TABLE orders ADD COLUMN discount_dzd INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('wilaya_code')) db.exec("ALTER TABLE orders ADD COLUMN wilaya_code TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('commune_id')) db.exec('ALTER TABLE orders ADD COLUMN commune_id INTEGER');

  // Répare les anciennes commandes COD marquées payées mais restées livrées.
  // Cette combinaison est incohérente : le paiement validé est l'étape finale.
  db.exec("UPDATE orders SET status = 'payee', paid_at = COALESCE(paid_at, datetime('now')) WHERE payment_method = 'cod' AND status = 'livree' AND payment_status = 'paid'");

  const ucols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!ucols.includes('reset_token')) {
    db.exec("ALTER TABLE users ADD COLUMN reset_token TEXT NOT NULL DEFAULT ''");
  }
  if (!ucols.includes('reset_expires')) {
    db.exec('ALTER TABLE users ADD COLUMN reset_expires TEXT');
  }
  if (!ucols.includes('oauth_provider')) {
    db.exec("ALTER TABLE users ADD COLUMN oauth_provider TEXT NOT NULL DEFAULT ''");
  }
  if (!ucols.includes('oauth_id')) {
    db.exec("ALTER TABLE users ADD COLUMN oauth_id TEXT NOT NULL DEFAULT ''");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id) WHERE oauth_provider != '' AND oauth_id != ''");

  db.exec(`
    CREATE TABLE IF NOT EXISTS wilayas (
      code    TEXT PRIMARY KEY,
      name_fr TEXT NOT NULL,
      name_ar TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS communes (
      id          INTEGER PRIMARY KEY,
      wilaya_code TEXT NOT NULL REFERENCES wilayas(code),
      name_fr     TEXT NOT NULL,
      name_ar     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_communes_wilaya ON communes(wilaya_code);
    CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'status_update',
      carrier TEXT NOT NULL DEFAULT '',
      tracking_number TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_status_history(order_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS shipment_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      printed_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS inventory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      qty INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_order ON inventory_events(order_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, position);
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (product_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
      value INTEGER NOT NULL CHECK (value >= 0),
      min_amount INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER NOT NULL DEFAULT 0,
      used_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

module.exports = { db, dbPath, migrate };
