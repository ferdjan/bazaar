'use strict';

// Sauvegarde SQLite cohérente pour le développement local. Cette commande ne
// rend pas le stockage Render Free persistant : copiez ensuite le fichier vers
// un emplacement durable et privé.
const fs = require('fs');
const path = require('path');
const { db, dbPath } = require('../src/db/connection');

if (dbPath === ':memory:') throw new Error('Une base :memory: ne peut pas être sauvegardée.');

const backupDir = path.join(path.dirname(dbPath), 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(backupDir, `data-${stamp}.db`);

db.backup(destination).then(() => {
  console.log(`Sauvegarde créée : ${destination}`);
  db.close();
}).catch((err) => {
  console.error('Échec de la sauvegarde SQLite :', err.message);
  process.exitCode = 1;
});
