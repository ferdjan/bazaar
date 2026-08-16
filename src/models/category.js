'use strict';
const { db } = require('../db/connection');

function listAll() {
  return db.prepare('SELECT * FROM categories ORDER BY name_fr ASC').all();
}

function findById(id) {
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function findBySlug(slug) {
  return db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug);
}

function create(data) {
  const info = db.prepare(
    'INSERT INTO categories (slug, name_fr, name_ar) VALUES (@slug, @name_fr, @name_ar)'
  ).run(data);
  return findById(info.lastInsertRowid);
}

function update(id, data) {
  db.prepare(
    'UPDATE categories SET slug = @slug, name_fr = @name_fr, name_ar = @name_ar WHERE id = @id'
  ).run({ ...data, id });
  return findById(id);
}

function remove(id) {
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

function countProducts(id) {
  return db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').get(id).n;
}

module.exports = { listAll, findById, findBySlug, create, update, remove, countProducts };
