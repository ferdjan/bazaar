'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');

// Fichiers acceptés et leurs "magic bytes" (contenu réel, pas l'extension).
const MAGIC = [
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" (+ "WEBP" à l'octet 8)
];

function hasMagic(buffer, bytes, offset = 0) {
  if (!Buffer.isBuffer(buffer) || buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

// Détecte le type d'image depuis son contenu. Retourne 'jpg'|'png'|'webp'|null.
function detectType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (hasMagic(buffer, MAGIC[0].bytes)) return 'jpg';
  if (hasMagic(buffer, MAGIC[1].bytes)) return 'png';
  if (hasMagic(buffer, MAGIC[2].bytes) && hasMagic(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

// Enregistre une image vérifiée (magic bytes) avec un nom de fichier généré
// côté serveur. Lève une erreur si le contenu n'est pas une image autorisée.
// Retourne le chemin public relatif.
function saveImage(buffer) {
  const type = detectType(buffer);
  if (!type) {
    const err = new Error('format_image_invalide');
    err.code = 'INVALID_IMAGE';
    throw err;
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = crypto.randomBytes(16).toString('hex') + '.' + type;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return '/uploads/' + name;
}

// Supprime un fichier uploadé à partir de son chemin public (/uploads/xxx).
function removeImage(publicPath) {
  if (!publicPath || typeof publicPath !== 'string') return;
  const name = path.basename(publicPath);
  if (!name || name === '.' || name === '..' || !/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) return;
  const full = path.join(UPLOAD_DIR, name);
  try {
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch (_) {
    /* best-effort */
  }
}

module.exports = { detectType, saveImage, removeImage, UPLOAD_DIR };
