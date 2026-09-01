'use strict';
const { db } = require('../db/connection');

// Données de référence géographiques (wilayas + communes d'Algérie), importées
// depuis src/data/locations.json par seed.js. Lecture seule côté application.

function listWilayas() {
  return db.prepare('SELECT code, name_fr, name_ar FROM wilayas ORDER BY code').all();
}

function listCommunes(wilayaCode) {
  if (wilayaCode) {
    return db.prepare('SELECT id, wilaya_code, name_fr, name_ar FROM communes WHERE wilaya_code = ? ORDER BY name_fr, id').all(wilayaCode);
  }
  return db.prepare('SELECT id, wilaya_code, name_fr, name_ar FROM communes ORDER BY wilaya_code, name_fr, id').all();
}

function getWilaya(code) {
  return db.prepare('SELECT code, name_fr, name_ar FROM wilayas WHERE code = ?').get(code) || null;
}

function getCommune(id) {
  return db.prepare('SELECT id, wilaya_code, name_fr, name_ar FROM communes WHERE id = ?').get(id) || null;
}

module.exports = { listWilayas, listCommunes, getWilaya, getCommune };
