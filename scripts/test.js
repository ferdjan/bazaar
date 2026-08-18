'use strict';
/* Tests d'intégration HTTP (supertest) + tests unitaires de sécurité, sur une
   base :memory:. Usage : npm test */

process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_PASSWORD = 'admin123';
process.env.STRIPE_SECRET_KEY = '';
process.env.PAYPAL_CLIENT_ID = '';
process.env.RATE_LIMIT_LOGIN_MAX = '5';

const request = require('supertest');
const { createApp } = require('../src/app');
const { seed } = require('../src/db/seed');
const { db } = require('../src/db/connection');
const orderModel = require('../src/models/order');
const product = require('../src/models/product');
const stripe = require('../src/services/payment/stripe');
const paypal = require('../src/services/payment/paypal');
const validate = require('../src/services/validate');
const { buildTimeline } = require('../src/services/orderStatus');

seed();
const app = createApp();

function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
}

// Crée une commande directement en base (pour les tests unitaires).
function makeOrder(method, totalDzd) {
  return orderModel.create({
    order: {
      user_id: null, status: 'en_attente', total_dzd: totalDzd,
      total_eur: (totalDzd * 0.0045).toFixed(2), payment_method: method,
      payment_status: 'pending', provider_id: '',
      nom: 'Test', email: 'test@test.com', telephone: '0550123456',
      adresse: '12 Rue X', ville: 'Alger',
    },
    items: [{ productId: 1, name: 'T-shirt coton', priceDzd: totalDzd, qty: 1, size: 'M' }],
  });
}

(async () => {
  let passed = 0;
  const ok = (name, cond) => {
    if (!cond) throw new Error('Échec : ' + name);
    passed++;
    console.log('  ✓ ' + name);
  };

  // ---- Vitrine ------------------------------------------------------------
  let res = await request(app).get('/');
  ok('GET / -> 200', res.status === 200);
  ok('accueil contient un produit', /T-shirt coton/.test(res.text));
  ok('accueil contient "Nouveautés"', /Nouveautés/.test(res.text));
  ok('accueil contient la réassurance', /Paiements sécurisés/.test(res.text));

  // CSP active et cookie de session durci.
  const csp = res.headers['content-security-policy'] || '';
  ok('CSP présente', csp.length > 0);
  ok('CSP object-src none', csp.includes("object-src 'none'"));
  ok('CSP sans unsafe-eval', !csp.includes('unsafe-eval'));
  const setCookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0] : '';
  ok('cookie HttpOnly', /HttpOnly/i.test(setCookie));
  ok('cookie SameSite=Lax', /SameSite=Lax/i.test(setCookie));

  res = await request(app).get('/catalogue');
  ok('GET /catalogue -> 200', res.status === 200);

  res = await request(app).get('/produit/t-shirt-coton');
  ok('GET /produit/:slug -> 200', res.status === 200);

  res = await request(app).get('/inexistant');
  ok('GET /inexistant -> 404', res.status === 404);

  // ---- Accès admin refusé sans session ------------------------------------
  res = await request(app).get('/admin');
  ok('GET /admin sans auth -> 302', res.status === 302);

  // ---- CSRF ----------------------------------------------------------------
  res = await request(app).post('/panier/ajouter').type('form').send({ productId: 1, qty: 1 });
  ok('POST sans CSRF -> 403', res.status === 403);

  // Mauvais token
  res = await request(app).post('/panier/ajouter').type('form').send({ _csrf: 'mauvais', productId: 1, qty: 1 });
  ok('POST mauvais CSRF -> 403', res.status === 403);

  // Token correct fourni UNIQUEMENT via query string -> refusé
  const csrfAgent = request.agent(app);
  res = await csrfAgent.get('/');
  const qCsrf = extractCsrf(res.text);
  res = await csrfAgent.post('/panier/ajouter?_csrf=' + qCsrf).type('form').send({ productId: 1, qty: 1 });
  ok('CSRF via query string refusé (token correct)', res.status === 403);

  // ---- Parcours client : inscription -> panier -> commande COD -------------
  const client = request.agent(app);
  res = await client.get('/inscription');
  let csrf = extractCsrf(res.text);
  res = await client.post('/inscription').type('form')
    .send({ _csrf: csrf, name: 'Client Test', email: 'client@test.com', password: 'secret123' });
  ok('inscription -> 302', res.status === 302);

  res = await client.get('/produit/t-shirt-coton');
  csrf = extractCsrf(res.text);
  res = await client.post('/panier/ajouter').type('form')
    .send({ _csrf: csrf, productId: 1, qty: 2, size: 'M' });
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
  ok('référence de commande générée (16 hex)', /^CMD-[0-9A-F]{16}$/.test(ref));

  // Frais de livraison forfaitaires ajoutés au total de la commande.
  const codOrderDb = orderModel.findByRef(ref);
  const itemsSubtotal = codOrderDb.items.reduce((s, it) => s + it.price_dzd * it.qty, 0);
  ok('frais de livraison 600 DA', codOrderDb.delivery_dzd === 600);
  ok('total = sous-total + livraison', codOrderDb.total_dzd === itemsSubtotal + 600);

  res = await client.get('/paiement/cod/' + ref);
  ok('confirmation COD -> 200', res.status === 200);
  ok('confirmation contient la référence', res.text.includes(ref));

  // Compte client : la commande apparaît
  res = await client.get('/compte');
  ok('GET /compte -> 200', res.status === 200);
  ok('commande listée dans le compte', res.text.includes(ref));

  // Le propriétaire peut consulter sa commande
  res = await client.get('/commande/' + ref);
  ok('propriétaire voit sa commande -> 200', res.status === 200);

  // ---- IDOR ----------------------------------------------------------------
  res = await request(app).get('/commande/' + ref);
  ok('commande sans auth -> 302 (redirect connexion)', res.status === 302);

  const clientB = request.agent(app);
  res = await clientB.get('/inscription');
  csrf = extractCsrf(res.text);
  res = await clientB.post('/inscription').type('form')
    .send({ _csrf: csrf, name: 'Client B', email: 'clientb@test.com', password: 'secret456' });
  ok('inscription client B -> 302', res.status === 302);
  res = await clientB.get('/commande/' + ref);
  ok('client B ne voit pas la commande de A -> 404', res.status === 404);

  // ---- Validation checkout (email/téléphone invalides) ---------------------
  res = await client.get('/produit/t-shirt-coton');
  csrf = extractCsrf(res.text);
  res = await client.post('/panier/ajouter').type('form')
    .send({ _csrf: csrf, productId: 1, qty: 1, size: 'M' });
  res = await client.get('/commande');
  csrf = extractCsrf(res.text);
  res = await client.post('/commande').type('form').send({
    _csrf: csrf,
    nom: 'Client Test',
    email: 'email-invalide',
    telephone: '0550123456',
    adresse: '12 Rue X',
    ville: 'Alger',
    payment_method: 'cod',
  });
  ok('checkout email invalide refusé (200, erreur)', res.status === 200 && /E-mail ou mot de passe incorrect/.test(res.text));

  // ---- Rate limiting connexion --------------------------------------------
  const brute = request.agent(app);
  res = await brute.get('/connexion');
  csrf = extractCsrf(res.text);
  let blocked = false;
  for (let i = 0; i < 6; i++) {
    res = await brute.post('/connexion').type('form')
      .send({ _csrf: csrf, email: 'brute@test.com', password: 'wrongpass' });
    if (res.status === 429) { blocked = true; break; }
  }
  ok('rate limit connexion -> 429', blocked);

  // ---- Login admin + accès back-office -------------------------------------
  const admin = request.agent(app);
  res = await admin.get('/connexion');
  csrf = extractCsrf(res.text);
  res = await admin.post('/connexion').type('form')
    .send({ _csrf: csrf, email: 'admin@example.com', password: 'admin123' });
  ok('login admin -> 302', res.status === 302);

  res = await admin.get('/admin');
  ok('GET /admin (admin) -> 200', res.status === 200);
  ok('tableau de bord contient la commande', res.text.includes(ref));

  // L'admin peut consulter la commande d'un client
  res = await admin.get('/commande/' + ref);
  ok('admin voit la commande -> 200', res.status === 200);

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
  res = await admin.post('/admin/categories/' + catId + '/supprimer').type('form').send({ _csrf: csrf });
  ok('suppression catégorie non vide bloquée -> 302', res.status === 302);
  res = await admin.get('/admin/categories');
  ok('catégorie non vide toujours présente', res.text.includes('Chaussures'));
  ok('message d\'erreur affiché', res.text.includes('Suppression impossible'));

  // ---- Upload : contenu invalide malgré extension valide -------------------
  res = await admin.get('/admin/produits/nouveau');
  csrf = extractCsrf(res.text);
  res = await admin.post('/admin/produits/nouveau')
    .field('_csrf', csrf)
    .field('name_fr', 'Fake Image')
    .field('price_dzd', '1000')
    .field('stock', '5')
    .attach('image', Buffer.from('pas-une-image'), { filename: 'fake.jpg', contentType: 'image/jpeg' });
  ok('upload contenu invalide refusé -> 302', res.status === 302);
  res = await admin.get('/admin/produits');
  ok('produit invalide non créé', !res.text.includes('Fake Image'));

  // ---- Upload : contenu valide (magic bytes PNG) ---------------------------
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  res = await admin.get('/admin/produits/nouveau');
  csrf = extractCsrf(res.text);
  res = await admin.post('/admin/produits/nouveau')
    .field('_csrf', csrf)
    .field('name_fr', 'Produit PNG Test')
    .field('price_dzd', '999')
    .field('stock', '3')
    .attach('image', pngMagic, { filename: 'img.png', contentType: 'image/png' });
  ok('upload contenu valide accepté -> 302', res.status === 302);
  res = await admin.get('/admin/produits');
  ok('produit valide créé', res.text.includes('Produit PNG Test'));

  // ---- Newsletter ----------------------------------------------------------
  res = await client.get('/');
  csrf = extractCsrf(res.text);
  res = await client.post('/newsletter').type('form').send({ _csrf: csrf, email: 'abo@test.com' });
  ok('POST /newsletter -> 302', res.status === 302);

  // ---- Tests unitaires : validation ----------------------------------------
  ok('isEmail valide', validate.isEmail('a@b.co') === true);
  ok('isEmail invalide', validate.isEmail('nope') === false);
  ok('isEmail trop long', validate.isEmail('a'.repeat(300) + '@b.co') === false);
  ok('isPhone valide', validate.isPhone('0550123456') === true);
  ok('isPhone invalide', validate.isPhone('abc') === false);
  ok('isId valide', validate.isId('42') === true);
  ok('isId invalide (non numérique)', validate.isId('42x') === false);
  ok('isInt invalide (chaîne)', validate.isInt('abc', { min: 0 }) === false);

  // ---- Tests unitaires : stock atomique ------------------------------------
  db.prepare('UPDATE products SET stock = 2, active = 1 WHERE id = 10').run();
  const codOrder = { user_id: null, status: 'en_attente', total_dzd: 1200, total_eur: '5.40', payment_method: 'cod', payment_status: 'pending', provider_id: '', nom: 'T', email: 't@t.com', telephone: '0550123456', adresse: 'a', ville: 'v' };
  orderModel.create({ order: codOrder, items: [{ productId: 10, name: 'Casquette', priceDzd: 1200, qty: 1, size: 'Taille unique' }] });
  ok('stock décrémenté après commande', product.findById(10).stock === 1);
  let stockErr = false;
  try {
    orderModel.create({ order: codOrder, items: [{ productId: 10, name: 'Casquette', priceDzd: 1200, qty: 2, size: 'Taille unique' }] });
  } catch (e) { stockErr = e.code === 'STOCK_INSUFFICIENT'; }
  ok('stock insuffisant -> STOCK_INSUFFICIENT', stockErr);
  db.prepare('UPDATE products SET stock = 50 WHERE id = 10').run();

  // ---- Tests unitaires : référence + provider_id + markPaid ----------------
  const o2 = makeOrder('paypal', 1500);
  ok('provider_id vide par défaut', o2.provider_id === '');
  orderModel.setProviderId(o2.ref, 'paypal_order_123');
  ok('findByProviderId retrouve la commande', orderModel.findByProviderId('paypal_order_123').ref === o2.ref);
  ok('markPaid -> true (transition)', orderModel.markPaid(o2.ref) === true);
  ok('markPaid -> false (déjà payé, idempotent)', orderModel.markPaid(o2.ref) === false);
  const o2b = orderModel.findByRef(o2.ref);
  ok('statut payé', o2b.payment_status === 'paid' && o2b.status === 'payee');
  ok('markPaid renseigne paid_at', !!o2b.paid_at);

  // ---- Tests unitaires : suivi de commande (statuts datés + transporteur) ---
  const o3 = makeOrder('cod', 2000);
  ok('setStatus statut valide -> true', orderModel.setStatus(o3.ref, 'en_attente') === true);
  orderModel.setStatus(o3.ref, 'expediee', { carrier: 'Yalidine', trackingNumber: 'ABC123' });
  let o3b = orderModel.findByRef(o3.ref);
  ok('expédiée tamponne shipped_at', !!o3b.shipped_at);
  ok('transporteur + n° de suivi stockés', o3b.carrier === 'Yalidine' && o3b.tracking_number === 'ABC123');

  orderModel.setStatus(o3.ref, 'livree', {});
  o3b = orderModel.findByRef(o3.ref);
  ok('livrée tamponne delivered_at', !!o3b.delivered_at);

  // Régression livree -> expediee : delivered_at doit être effacé.
  orderModel.setStatus(o3.ref, 'expediee', {});
  o3b = orderModel.findByRef(o3.ref);
  ok('régression efface delivered_at', o3b.delivered_at === null);

  ok('setStatus statut invalide -> false', orderModel.setStatus(o3.ref, 'inconnu') === false);

  orderModel.setStatus(o3.ref, 'annulee', {});
  o3b = orderModel.findByRef(o3.ref);
  ok('annulée tamponne cancelled_at', !!o3b.cancelled_at);

  // Timeline : construction des états done/current/upcoming.
  const tl = buildTimeline(o3b);
  ok('timeline annulée -> cancelled + date', tl.cancelled === true && !!tl.cancelledAt);

  const o4 = makeOrder('cod', 1000);
  const tl4 = buildTimeline(o4);
  ok('timeline -> 4 étapes', tl4.steps.length === 4);
  ok('étape 0 current, étape 1 upcoming', tl4.steps[0].state === 'current' && tl4.steps[1].state === 'upcoming');
  ok('date étape 0 = created_at', tl4.steps[0].date === o4.created_at);

  const tlPaid = buildTimeline(o2b);
  ok('timeline payée -> en_attente done, payee current', tlPaid.steps[0].state === 'done' && tlPaid.steps[1].state === 'current');

  // Ordre des étapes selon le mode de paiement.
  ok('COD : en_attente→expediee→livree→payee',
    tl4.steps.map((s) => s.key).join(',') === 'en_attente,expediee,livree,payee');
  ok('en ligne : en_attente→payee→expediee→livree',
    tlPaid.steps.map((s) => s.key).join(',') === 'en_attente,payee,expediee,livree');

  // ---- Tests unitaires : vérification Stripe --------------------------------
  const so = makeOrder('stripe', 1500); // 1500 DZD -> 675 centimes EUR
  const goodSession = { id: 'cs_test_1', payment_status: 'paid', client_reference_id: so.ref, amount_total: 675, currency: 'eur' };
  ok('stripe session valide -> ok', stripe.verifyStripeSession(goodSession, so.ref).ok === true);
  ok('stripe ref mismatch', stripe.verifyStripeSession({ ...goodSession, client_reference_id: 'CMD-OTHER' }, so.ref).reason === 'ref_mismatch');
  ok('stripe amount mismatch', stripe.verifyStripeSession({ ...goodSession, amount_total: 1000 }, so.ref).reason === 'amount_mismatch');
  ok('stripe currency mismatch', stripe.verifyStripeSession({ ...goodSession, currency: 'usd' }, so.ref).reason === 'currency_mismatch');
  ok('stripe not paid', stripe.verifyStripeSession({ ...goodSession, payment_status: 'unpaid' }, so.ref).reason === 'not_paid');

  // Une session Stripe valide ne doit pas payer une commande PayPal.
  const po = makeOrder('paypal', 1500);
  ok('stripe sur commande paypal -> method_mismatch',
    stripe.verifyStripeSession({ ...goodSession, client_reference_id: po.ref }, po.ref).reason === 'method_mismatch');

  // ---- Tests unitaires : vérification PayPal --------------------------------
  const goodCapture = {
    status: 'COMPLETED',
    purchase_units: [{ reference_id: po.ref, amount: { currency_code: 'EUR', value: '6.75' } }],
  };
  ok('paypal capture valide -> ok', paypal.verifyCapture(goodCapture, po).ok === true);
  ok('paypal ref mismatch', paypal.verifyCapture({ ...goodCapture, purchase_units: [{ ...goodCapture.purchase_units[0], reference_id: 'X' }] }, po).reason === 'ref_mismatch');
  ok('paypal amount mismatch', paypal.verifyCapture({ ...goodCapture, purchase_units: [{ ...goodCapture.purchase_units[0], amount: { currency_code: 'EUR', value: '9.99' } }] }, po).reason === 'amount_mismatch');
  ok('paypal currency mismatch', paypal.verifyCapture({ ...goodCapture, purchase_units: [{ ...goodCapture.purchase_units[0], amount: { currency_code: 'USD', value: '6.75' } }] }, po).reason === 'currency_mismatch');
  ok('paypal not completed', paypal.verifyCapture({ ...goodCapture, status: 'APPROVED' }, po).reason === 'not_completed');

  // ---- Mot de passe oublié ----------------------------------------------
  const resetAgent = request.agent(app);
  res = await resetAgent.get('/mot-de-passe-oublie');
  ok('GET /mot-de-passe-oublie -> 200', res.status === 200);
  csrf = extractCsrf(res.text);
  res = await resetAgent.post('/mot-de-passe-oublie').type('form')
    .send({ _csrf: csrf, email: 'client@test.com' });
  ok('POST mot de passe oublié -> 302 (réponse générique)', res.status === 302);

  const resetToken = db.prepare("SELECT reset_token FROM users WHERE email = 'client@test.com'").get().reset_token;
  ok('jeton de réinitialisation stocké', !!resetToken);

  res = await resetAgent.get('/reinitialiser/' + resetToken);
  ok('GET /reinitialiser/:token -> 200', res.status === 200);
  csrf = extractCsrf(res.text);
  res = await resetAgent.post('/reinitialiser/' + resetToken).type('form')
    .send({ _csrf: csrf, password: 'nouveau123' });
  ok('POST réinitialisation -> 302', res.status === 302);
  ok('jeton consommé (usage unique)',
    db.prepare("SELECT reset_token FROM users WHERE email = 'client@test.com'").get().reset_token === '');

  // Le nouveau mot de passe fonctionne.
  const relog = request.agent(app);
  res = await relog.get('/connexion');
  csrf = extractCsrf(res.text);
  res = await relog.post('/connexion').type('form')
    .send({ _csrf: csrf, email: 'client@test.com', password: 'nouveau123' });
  ok('connexion avec le nouveau mot de passe -> 302', res.status === 302);

  // Jeton invalide refusé.
  res = await resetAgent.get('/reinitialiser/mauvais-jeton');
  ok('jeton invalide -> erreur affichée', res.status === 200 && /invalide/.test(res.text));

  console.log('\nTests : ' + passed + ' assertions OK.');
  process.exit(0);
})().catch((err) => {
  console.error('\n✗ ' + err.message);
  process.exit(1);
});
