'use strict';

// Convertit un texte en slug d'URL : "T-shirt Homme" -> "t-shirt-homme".
function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

module.exports = { slugify };
