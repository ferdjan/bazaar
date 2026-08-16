-- Schéma Bazaar (SQLite). Les prix sont en dinars entiers (DZD).

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  slug    TEXT NOT NULL UNIQUE,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  name_fr        TEXT NOT NULL,
  name_ar        TEXT NOT NULL,
  description_fr TEXT NOT NULL DEFAULT '',
  description_ar TEXT NOT NULL DEFAULT '',
  price_dzd      INTEGER NOT NULL CHECK (price_dzd >= 0),
  image          TEXT NOT NULL DEFAULT '',
  stock          INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sizes          TEXT NOT NULL DEFAULT '',
  category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ref            TEXT NOT NULL UNIQUE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'en_attente'
                 CHECK (status IN ('en_attente','payee','expediee','livree','annulee')),
  total_dzd      INTEGER NOT NULL,
  total_eur      TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('stripe','paypal','cod')),
  payment_status TEXT NOT NULL DEFAULT 'pending'
                 CHECK (payment_status IN ('pending','paid','failed')),
  nom            TEXT NOT NULL,
  email          TEXT NOT NULL,
  telephone      TEXT NOT NULL,
  adresse        TEXT NOT NULL,
  ville          TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  price_dzd  INTEGER NOT NULL,
  qty        INTEGER NOT NULL,
  size       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS newsletter (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
