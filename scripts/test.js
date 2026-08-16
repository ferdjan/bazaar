'use strict';
/* Tests d'intégration HTTP (supertest) sur une base :memory:.
   Usage : npm test */

process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_PASSWORD = 'admin123';
process.env.STRIPE_SECRET_KEY = '';
process.env.PAYPAL_CLIENT_ID = '';

const request = require('supertest');
const { createApp } = require('../src/app');
const { seed } = require('../src/db/seed');
const { db } = require('../src/db/connection');

seed();
const app = createApp();

function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
}

(async () => {
  let passed = 0;
  const ok = (name, cond) => {
    if (!cond) throw new Error('Échec : ' + name);
    passed++;
    console.log('  ✓ ' + name);
  };

  // Vitrine
  let res = await request(app).get('/');
  ok('GET / -> 200', res.status === 200);
  ok('accueil contient un produit', /T-shirt coton/.test(res.text));
  ok('accueil contient "Nouveautés"', /Nouveautés/.test(res.text));
  ok('accueil contient la réassurance', /Paiements sécurisés/.test(res.text));

  res = await request(app).get('/catalogue');
  ok('GET /catalogue -> 200', res.status === 200);

  res = await request(app).get('/produit/t-shirt-coton');
  ok('GET /produit/:slug -> 200', res.status === 200);

  res = await request(app).get('/inexistant');
  ok('GET /inexistant -> 404', res.status === 404);

  // Accès admin refusé sans session
  res = await request(app).get('/admin');
  ok('GET /admin sans auth -> 302', res.status === 302);

  // CSRF rejeté
  res = await request(app).post('/panier/ajouter').type('form').send({ productId: 1, qty: 1 });
  ok('POST sans CSRF -> 403', res.status === 403);

  // Parcours client : inscription -> panier -> commande COD
  const client = request.agent(app);
  res = await client.get('/inscription');
  let csrf = extractCsrf(res.text);
  res = await client.post('/inscription').type('form')
    .send({ _csrf: csrf, name: 'Client Test', email: 'client@test.com', password: 'secret123' });
  ok('inscription -> 302', res.status === 302);

  res = await client.get('/produit/t-shirt-coton');
  csrf = extractCsrf(res.text);
  res = await client.post('/panier/ajouter').type('form')
    .send({ _csrf: csrf, productId: 1, qty: 2 });
  ok('ajout au panier -> 302', res.status === 302);

  res = await client.get('/commande');
  ok('GET /commande -> 200', res.status === 200);
  csrf = extractCsrf(res.text);
  res = await client.post('/commande').type('form').send({
    _csrf: csrf,
    nom: 'Client Test',
    email: 'client@test.com',
    telephone: '0550123456',
    adresse: '12 Rue X',
    ville: 'Alger',
    payment_method: 'cod',
  });
  ok('commande COD -> 302', res.status === 302);
  const ref = (res.headers.location || '').split('/').pop();
  ok('référence de commande générée', /^CMD-/.test(ref));

  res = await client.get('/paiement/cod/' + ref);
  ok('confirmation COD -> 200', res.status === 200);
  ok('confirmation contient la référence', res.text.includes(ref));

  // Compte client : la commande apparaît
  res = await client.get('/compte');
  ok('GET /compte -> 200', res.status === 200);
  ok('commande listée dans le compte', res.text.includes(ref));

  // Login admin + accès back-office
  const admin = request.agent(app);
  res = await admin.get('/connexion');
  csrf = extractCsrf(res.text);
  res = await admin.post('/connexion').type('form')
    .send({ _csrf: csrf, email: 'admin@example.com', password: 'admin123' });
  ok('login admin -> 302', res.status === 302);

  res = await admin.get('/admin');
  ok('GET /admin (admin) -> 200', res.status === 200);
  ok('tableau de bord contient la commande', res.text.includes(ref));

  res = await admin.get('/admin/produits');
  ok('GET /admin/produits -> 200', res.status === 200);

  // L'admin ne doit PAS apparaître dans la liste des clients
  res = await admin.get('/admin/clients');
  ok('GET /admin/clients -> 200', res.status === 200);
  ok('admin absent de la liste des clients', !res.text.includes('admin@example.com'));
  ok('client présent dans la liste des clients', res.text.includes('client@test.com'));

  // Suppression d'une catégorie non vide bloquée (intégrité)
  const catId = db.prepare("SELECT id FROM categories WHERE slug = 'chaussures'").get().id;
  res = await admin.get('/admin/categories');
  csrf = extractCsrf(res.text);
  res = await admin.post('/admin/categories/' + catId + '/supprimer').type('form')
    .send({ _csrf: csrf });
  ok('suppression catégorie non vide bloquée -> 302', res.status === 302);
  res = await admin.get('/admin/categories');
  ok('catégorie non vide toujours présente', res.text.includes('Chaussures'));
  ok('message d\'erreur affiché', res.text.includes('Suppression impossible'));

  // Newsletter
  res = await client.get('/');
  csrf = extractCsrf(res.text);
  res = await client.post('/newsletter').type('form')
    .send({ _csrf: csrf, email: 'abo@test.com' });
  ok('POST /newsletter -> 302', res.status === 302);

  console.log('\nTests d\'intégration : ' + passed + ' assertions OK.');
  process.exit(0);
})().catch((err) => {
  console.error('\n✗ ' + err.message);
  process.exit(1);
});
