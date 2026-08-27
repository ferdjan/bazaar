-- Schéma Bazaar (SQLite). Les prix sont en dinars entiers (DZD).

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'seller', 'customer')),
  reset_token   TEXT NOT NULL DEFAULT '',
  reset_expires TEXT,
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

CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ref            TEXT NOT NULL UNIQUE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'en_attente'
                 CHECK (status IN ('en_attente','payee','expediee','livree','annulee')),
  total_dzd      INTEGER NOT NULL,
  total_eur      TEXT NOT NULL DEFAULT '',
  delivery_dzd   INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('stripe','paypal','cod')),
  payment_status TEXT NOT NULL DEFAULT 'pending'
                  CHECK (payment_status IN ('pending','paid','failed')),
  provider_id    TEXT NOT NULL DEFAULT '',
  paid_at        TEXT,
  shipped_at     TEXT,
  delivered_at   TEXT,
  cancelled_at   TEXT,
  carrier        TEXT NOT NULL DEFAULT '',
  tracking_number TEXT NOT NULL DEFAULT '',
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivery_issue TEXT NOT NULL DEFAULT '',
  stock_released INTEGER NOT NULL DEFAULT 0,
  refund_dzd     INTEGER NOT NULL DEFAULT 0,
  returned_at    TEXT,
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

CREATE TABLE IF NOT EXISTS order_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  action      TEXT NOT NULL DEFAULT 'status_update',
  carrier     TEXT NOT NULL DEFAULT '',
  tracking_number TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shipment_labels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  printed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  qty        INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS newsletter (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, position);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_status_history(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_order ON inventory_events(order_id, created_at DESC);
