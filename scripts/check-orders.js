'use strict';
/* Repro du parcours signalé : commande client connecté -> affichage admin,
   affichage compte client, et évolution du stock. Aucune écriture disque :
   base :memory:. Usage : node scripts/check-orders.js */

process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'check-secret';
process.env.ADMIN_PASSWORD = 'admin123';
process.env.NODE_ENV = '';

const request = require('supertest');
const { createApp } = require('../src/app');
const { seed } = require('../src/db/seed');
const { db } = require('../src/db/connection');

(async () => {
  seed();
  const app = createApp();
  const csrfOf = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';

  const stockAvant = db.prepare('SELECT stock FROM products WHERE id = 1').get().stock;
  console.log('Stock produit #1 AVANT commande :', stockAvant);

  // Client s'inscrit puis commande
  const cli = request.agent(app);
  let res = await cli.get('/inscription');
  res = await cli.post('/inscription').type('form')
    .send({ _csrf: csrfOf(res.text), name: 'Client Verif', email: 'verif@test.com', password: 'secret123' });
  console.log('Inscription :', res.status);

  res = await cli.get('/produit/t-shirt-coton');
  res = await cli.post('/panier/ajouter').type('form')
    .send({ _csrf: csrfOf(res.text), productId: 1, qty: 2, size: 'M' });

  res = await cli.get('/commande');
  res = await cli.post('/commande').type('form').send({
    _csrf: csrfOf(res.text),
    nom: 'Client Verif', email: 'verif@test.com', telephone: '0550123456',
    adresse: '12 Rue X', ville: 'Alger', payment_method: 'cod',
  });
  console.log('Commande COD :', res.status, '->', res.headers.location);
  const ref = (res.headers.location || '').split('/').pop();

  // Admin se connecte et consulte
  const adm = request.agent(app);
  res = await adm.get('/connexion');
  res = await adm.post('/connexion').type('form')
    .send({ _csrf: csrfOf(res.text), email: 'admin@example.com', password: 'admin123' });
  console.log('Login admin :', res.status);

  res = await adm.get('/admin/commandes');
  console.log('GET /admin/commandes :', res.status, '| référence visible :', res.text.includes(ref));

  res = await adm.get('/admin');
  console.log('Dashboard contient la commande :', res.text.includes(ref));

  res = await cli.get('/compte');
  console.log('Compte client liste la commande :', res.status === 200 && res.text.includes(ref));

  const stockApres = db.prepare('SELECT stock FROM products WHERE id = 1').get().stock;
  console.log('Stock produit #1 APRÈS commande :', stockApres, '(attendu :', stockAvant - 2, ')');

  const o = db.prepare("SELECT ref, user_id, status, payment_status, total_dzd FROM orders WHERE ref = ?").get(ref);
  console.log('Commande en base :', JSON.stringify(o));
  process.exit(0);
})().catch((e) => { console.error('ERREUR :', e.message); process.exit(1); });
