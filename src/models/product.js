'use strict';
const { db } = require('../db/connection');

const rowToProduct = (r) => (r ? { ...r, active: !!r.active } : null);

function findById(id) {
  return rowToProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}

function findBySlug(slug) {
  return rowToProduct(db.prepare('SELECT * FROM products WHERE slug = ?').get(slug));
}

function listAll() {
  return db.prepare('SELECT * FROM products ORDER BY created_at DESC').all().map(rowToProduct);
}

// Liste des produits actifs, avec filtre catégorie (id) et recherche texte (FR/AR).
function listActive({ category, q } = {}) {
  let sql = 'SELECT * FROM products WHERE active = 1';
  const params = [];
  if (category) {
    sql += ' AND category_id = ?';
    params.push(category);
  }
  if (q) {
    const like = '%' + q + '%';
    sql += ' AND (name_fr LIKE ? OR name_ar LIKE ? OR description_fr LIKE ? OR description_ar LIKE ?)';
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params).map(rowToProduct);
}

function listByCategory(categoryId, excludeId) {
  let sql = 'SELECT * FROM products WHERE active = 1 AND category_id = ?';
  const params = [categoryId];
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  sql += ' ORDER BY created_at DESC LIMIT 4';
  return db.prepare(sql).all(...params).map(rowToProduct);
}

function create(data) {
  const info = db.prepare(`
    INSERT INTO products
      (slug, name_fr, name_ar, description_fr, description_ar, price_dzd, image, stock, sizes, category_id, active)
    VALUES
      (@slug, @name_fr, @name_ar, @description_fr, @description_ar, @price_dzd, @image, @stock, @sizes, @category_id, @active)
  `).run(data);
  return findById(info.lastInsertRowid);
}

function update(id, data) {
  db.prepare(`
    UPDATE products SET
      slug = @slug, name_fr = @name_fr, name_ar = @name_ar,
      description_fr = @description_fr, description_ar = @description_ar,
      price_dzd = @price_dzd, image = @image, stock = @stock,
      sizes = @sizes, category_id = @category_id, active = @active
    WHERE id = @id
  `).run({ ...data, id });
  return findById(id);
}

function remove(id) {
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
}

// --- Images multiples (en plus de l'image principale `products.image`) ---

function listImages(productId) {
  return db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY position ASC, id ASC').all(productId);
}

function addImages(productId, paths) {
  const insert = db.prepare('INSERT INTO product_images (product_id, path, position) VALUES (?, ?, ?)');
  const count = listImages(productId).length;
  (paths || []).forEach((p, i) => insert.run(productId, p, count + i));
}

function deleteImage(imageId) {
  db.prepare('DELETE FROM product_images WHERE id = ?').run(imageId);
}

function countLowStock(threshold = 5) {
  return db.prepare('SELECT COUNT(*) AS n FROM products WHERE stock <= ?').get(threshold).n;
}

function count() {
  return db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
}

module.exports = {
  findById, findBySlug, listAll, listActive, listByCategory,
  create, update, remove, countLowStock, count,
  listImages, addImages, deleteImage,
};
