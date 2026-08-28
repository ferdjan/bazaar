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
const mail = require('../src/services/mail');
const { buildTimeline } = require('../src/services/orderStatus');
const shipmentLabel = require('../src/services/shipmentLabel');

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
  ok('dashboard affiche le compteur en attente', /En attente/.test(res.text) && />1<\/strong>/.test(res.text));

  res = await admin.get('/admin?status=en_attente');
  ok('dashboard filtre les commandes en attente', res.status === 200 && res.text.includes(ref));
  res = await admin.get('/admin?status=livree');
  ok('dashboard filtre les commandes livrées', res.status === 200 && !res.text.includes(ref));
  res = await admin.get('/admin?status=statut-invalide');
  ok('dashboard ignore un filtre de statut invalide', res.status === 200 && res.text.includes(ref));

  // Actions rapides admin : CSRF, transitions COD et historique d'audit.
  res = await admin.post('/admin/commandes/' + ref + '/action').type('form').send({ action: 'ship' });
  ok('action commande sans CSRF -> 403', res.status === 403);
  res = await admin.get('/admin/commandes/' + ref);
  csrf = extractCsrf(res.text);
  res = await admin.post('/admin/commandes/' + ref + '/action').type('form').send({
    _csrf: csrf, action: 'ship', carrier: 'Yalidine', tracking_number: 'TRK-001',
  });
  ok('action expédier COD -> 302', res.status === 302);
  let actionOrder = orderModel.findByRef(ref);
  ok('expédition COD ne marque pas payée', actionOrder.status === 'expediee' && actionOrder.payment_status === 'pending');
  ok('action expédier conserve le suivi', actionOrder.carrier === 'Yalidine' && actionOrder.tracking_number === 'TRK-001');
  ok('transition expédier répétée refusée', orderModel.actionFor(ref, 'ship') === false);

  res = await admin.get('/admin/commandes/' + ref);
  csrf = extractCsrf(res.text);
  await admin.post('/admin/commandes/' + ref + '/action').type('form').send({ _csrf: csrf, action: 'deliver' });
  actionOrder = orderModel.findByRef(ref);
  ok('action livrer conserve le suivi', actionOrder.status === 'livree' && actionOrder.carrier === 'Yalidine');
  ok('livraison COD reste impayée avant encaissement', actionOrder.payment_status === 'pending');

  res = await admin.get('/admin/commandes/' + ref);
  csrf = extractCsrf(res.text);
  await admin.post('/admin/commandes/' + ref + '/action').type('form').send({ _csrf: csrf, action: 'pay' });
  actionOrder = orderModel.findByRef(ref);
  ok('admin ne peut pas enregistrer un paiement COD', actionOrder.status === 'livree' && actionOrder.payment_status === 'pending');
  const actionHistory = orderModel.listHistory(ref);
  ok('historique conserve les deux actions admin', actionHistory.length === 2);
  ok('historique identifie l’administrateur', actionHistory.every((event) => event.actor_name === 'Administrateur'));

  // ---- Étiquette QR et scan vendeur ---------------------------------------
  const labelToken = shipmentLabel.issue(codOrderDb.id);
  ok('étiquette QR créée avec un jeton aléatoire', /^[a-f0-9]{64}$/.test(labelToken));
  ok('jeton QR non stocké en clair', !db.prepare('SELECT token_hash FROM shipment_labels WHERE order_id = ?').get(codOrderDb.id).token_hash.includes(labelToken));
  ok('jeton QR retrouve la commande', shipmentLabel.findByToken(labelToken).ref === codOrderDb.ref);
  const secondLabelToken = shipmentLabel.issue(codOrderDb.id);
  ok('réimpression révoque l’ancien QR', shipmentLabel.findByToken(labelToken) === null && !!shipmentLabel.findByToken(secondLabelToken));
  res = await request(app).get('/scan/' + secondLabelToken);
  ok('scan sans authentification refusé', res.status === 302);
  res = await admin.get('/scan/' + secondLabelToken);
  ok('admin ouvre le scan QR en lecture seule', res.status === 200 && res.text.includes(codOrderDb.ref) && /Consultation uniquement/.test(res.text));
  res = await admin.get('/admin/commandes/' + codOrderDb.ref);
  csrf = extractCsrf(res.text);
  res = await admin.post('/admin/commandes/' + codOrderDb.ref + '/etiquette').type('form').send({ _csrf: csrf });
  ok('admin génère une étiquette imprimable', res.status === 200 && /Imprimer/.test(res.text) && /data:image\/png/.test(res.text));
  const sellerLabelToken = shipmentLabel.issue(codOrderDb.id);

  // Compte vendeur : création par admin, accès scan uniquement.
  res = await admin.get('/admin/clients');
  csrf = extractCsrf(res.text);
  res = await admin.post('/admin/vendeurs/nouveau').type('form').send({
    _csrf: csrf, name: 'Vendeur Test', email: 'seller@test.com', password: 'seller123',
  });
  ok('admin crée un compte vendeur', res.status === 302);
  const seller = request.agent(app);
  res = await seller.get('/connexion');
  csrf = extractCsrf(res.text);
  res = await seller.post('/connexion').type('form').send({
    _csrf: csrf, email: 'seller@test.com', password: 'seller123',
  });
  ok('vendeur se connecte et arrive au scan', res.status === 302 && res.headers.location === '/scan');
  res = await seller.get('/scan');
  ok('vendeur ouvre la page scan sans commande', res.status === 200 && /Scan vendeur/.test(res.text));
  res = await seller.get('/scan/' + sellerLabelToken);
  ok('vendeur ouvre un QR', res.status === 200 && res.text.includes(codOrderDb.ref));
  csrf = extractCsrf(res.text);
  res = await seller.post('/scan/payer').type('form').send({ _csrf: csrf, token: sellerLabelToken });
  const scannedOrder = orderModel.findByRef(codOrderDb.ref);
  ok('vendeur confirme le paiement COD via QR', res.status === 302 && scannedOrder.status === 'payee' && scannedOrder.payment_status === 'paid');
  ok('double confirmation vendeur refusée', orderModel.confirmCodPayment(codOrderDb.ref, 2, 'seller') === false);
  res = await seller.get('/admin');
  ok('vendeur ne peut pas ouvrir admin', res.status === 403);

  // Retour revendable : le stock est réintégré une seule fois.
  const returnProduct = product.findById(10);
  db.prepare('UPDATE products SET stock = 3 WHERE id = 10').run();
  const returnRef = orderModel.create({
    order: { user_id: null, status: 'en_attente', total_dzd: 1200, total_eur: '5.40', delivery_dzd: 600,
      payment_method: 'cod', payment_status: 'pending', provider_id: '', nom: 'Retour', email: 'return@test.com',
      telephone: '0550123456', adresse: '1 Rue Z', ville: 'Alger' },
    items: [{ productId: 10, name: returnProduct.name_fr, priceDzd: 1200, qty: 1, size: 'Taille unique' }],
  }).ref;
  ok('stock réservé pour le retour', product.findById(10).stock === 2);
  orderModel.setStatus(returnRef, 'expediee', {});
  orderModel.setStatus(returnRef, 'livree', {});
  const sellerId = db.prepare("SELECT id FROM users WHERE role = 'seller'").get().id;
  ok('vendeur encaisse la commande avant retour', orderModel.confirmCodPayment(returnRef, sellerId, 'seller') === true);
  ok('incident retour enregistré', orderModel.recordDeliveryIssue(returnRef, 'returned', 1) === true);
  ok('retour revendable réintègre le stock', orderModel.returnReceived(returnRef, 'resellable', 1) === true && product.findById(10).stock === 3);
  ok('retour payé affiche un remboursement', orderModel.findByRef(returnRef).refund_dzd === 1200);
  ok('retour traité une seule fois', orderModel.returnReceived(returnRef, 'resellable', 1) === false && product.findById(10).stock === 3);

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
  // SMTP non configuré : on intercepte sendMail pour capturer le lien envoyé.
  let resetLinkText = '';
  mail.sendMail = async (opts) => { resetLinkText = opts.text; };

  const resetAgent = request.agent(app);
  res = await resetAgent.get('/mot-de-passe-oublie');
  ok('GET /mot-de-passe-oublie -> 200', res.status === 200);
  csrf = extractCsrf(res.text);
  res = await resetAgent.post('/mot-de-passe-oublie').type('form')
    .send({ _csrf: csrf, email: 'client@test.com' });
  ok('POST mot de passe oublié -> 302 (réponse générique)', res.status === 302);

  // Le jeton brut circule uniquement dans le lien ; la base ne contient que
  // son empreinte SHA-256.
  const resetToken = (resetLinkText.match(/\/reinitialiser\/([0-9a-f]+)/) || [])[1] || '';
  ok('lien de réinitialisation contient un jeton', /^[0-9a-f]{64}$/.test(resetToken));
  const storedReset = db.prepare("SELECT reset_token FROM users WHERE email = 'client@test.com'").get().reset_token;
  ok('jeton stocké haché (≠ jeton brut)', storedReset !== resetToken && /^[a-f0-9]{64}$/.test(storedReset));

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

  // ---- Déconnexion des autres sessions après réinitialisation -------------
  // Une seconde session ouverte pour le même compte.
  const sessB = request.agent(app);
  res = await sessB.get('/connexion');
  csrf = extractCsrf(res.text);
  res = await sessB.post('/connexion').type('form')
    .send({ _csrf: csrf, email: 'client@test.com', password: 'nouveau123' });
  ok('seconde connexion même compte -> 302', res.status === 302);

  // Deuxième cycle de réinitialisation : les sessions ouvertes avant le reset
  // (relog et sessB) doivent être détruites ; seule la session courante reste.
  mail.sendMail = async (opts) => { resetLinkText = opts.text; };
  res = await resetAgent.get('/mot-de-passe-oublie');
  csrf = extractCsrf(res.text);
  res = await resetAgent.post('/mot-de-passe-oublie').type('form')
    .send({ _csrf: csrf, email: 'client@test.com' });
  ok('second mot de passe oublié -> 302', res.status === 302);
  const t2 = (resetLinkText.match(/\/reinitialiser\/([0-9a-f]+)/) || [])[1] || '';
  ok('second lien de réinitialisation émis', /^[0-9a-f]{64}$/.test(t2));

  res = await resetAgent.get('/reinitialiser/' + t2);
  ok('GET second lien -> 200', res.status === 200);
  csrf = extractCsrf(res.text);
  res = await resetAgent.post('/reinitialiser/' + t2).type('form')
    .send({ _csrf: csrf, password: 'nouveau456' });
  ok('seconde réinitialisation -> 302', res.status === 302);

  res = await relog.get('/compte');
  ok('ancienne session A déconnectée après reset -> 302', res.status === 302);
  res = await sessB.get('/compte');
  ok('session B déconnectée après reset -> 302', res.status === 302);

  // Le second nouveau mot de passe fonctionne.
  const relog2 = request.agent(app);
  res = await relog2.get('/connexion');
  csrf = extractCsrf(res.text);
  res = await relog2.post('/connexion').type('form')
    .send({ _csrf: csrf, email: 'client@test.com', password: 'nouveau456' });
  ok('connexion avec le second nouveau mot de passe -> 302', res.status === 302);

  // ---- Suivi public de commande (clients invités) --------------------------
  res = await request(app).get('/suivi');
  ok('GET /suivi -> 200', res.status === 200);

  const guestOrder = orderModel.create({
    order: {
      user_id: null, status: 'en_attente', total_dzd: 1500, total_eur: '6.75',
      delivery_dzd: 600, payment_method: 'cod', payment_status: 'pending',
      provider_id: '', nom: 'Invite', email: 'invite@test.com',
      telephone: '0550123456', adresse: '1 Rue Y', ville: 'Oran',
    },
    items: [{ productId: 1, name: 'T-shirt coton', priceDzd: 900, qty: 1, size: 'M' }],
  });

  const tracker = request.agent(app);
  res = await tracker.get('/suivi');
  csrf = extractCsrf(res.text);
  res = await tracker.post('/suivi').type('form')
    .send({ _csrf: csrf, ref: guestOrder.ref, email: 'mauvais@test.com' });
  ok('suivi : e-mail ne correspondant pas -> refusé', res.status === 200 && /ne correspond/.test(res.text));

  res = await tracker.post('/suivi').type('form')
    .send({ _csrf: csrf, ref: guestOrder.ref.toLowerCase(), email: 'invite@test.com' });
  ok('suivi : réf insensible à la casse -> commande affichée', res.status === 200 && res.text.includes(guestOrder.ref));

  res = await tracker.post('/suivi').type('form')
    .send({ _csrf: csrf, ref: 'CMD-0123456789ABCDEF', email: 'invite@test.com' });
  ok('suivi : référence inconnue -> message générique', res.status === 200 && /ne correspond/.test(res.text));

  res = await request(app).post('/suivi').type('form')
    .send({ ref: guestOrder.ref, email: 'invite@test.com' });
  ok('suivi sans CSRF -> 403', res.status === 403);

  // ---- CA : seules les commandes réellement payées comptent ----------------
  const revBefore = orderModel.stats().revenue;
  const oPending = makeOrder('cod', 3000); // reste en_attente / non payée
  ok('CA inchangé tant que la commande est impayée', orderModel.stats().revenue === revBefore);
  orderModel.markPaid(oPending.ref);
  ok('CA augmente une fois la commande payée', orderModel.stats().revenue === revBefore + 3000);

  const oCancel = makeOrder('stripe', 2000);
  orderModel.markPaid(oCancel.ref);
  orderModel.setStatus(oCancel.ref, 'annulee', {});
  ok('CA exclut les commandes annulées', orderModel.stats().revenue === revBefore + 3000);

  // ---- Synchronisation payment_status lors des changements de statut -------
  const oCod = makeOrder('cod', 800);
  ok('COD en_attente non payée', oCod.payment_status === 'pending');
  orderModel.setStatus(oCod.ref, 'livree', {});
  ok('COD livrée reste pending avant action payer', orderModel.findByRef(oCod.ref).payment_status === 'pending');
   ok('admin ne peut pas payer une COD', orderModel.actionFor(oCod.ref, 'pay', { actorRole: 'admin' }) === false);

  const oSt = makeOrder('stripe', 900);
  orderModel.setStatus(oSt.ref, 'en_attente', {});
  ok('en_attente ne marque jamais payée', orderModel.findByRef(oSt.ref).payment_status === 'pending');

  // L'admin ne peut plus forcer "payée" manuellement, même pour Stripe/PayPal.
  const oManual = makeOrder('stripe', 1200);
  ok('setStatus payee bloqué (stripe)', orderModel.setStatus(oManual.ref, 'payee', { actorRole: 'admin' }) === false);
  ok('stripe reste pending après tentative manuelle', orderModel.findByRef(oManual.ref).payment_status === 'pending');
  const oManualCod = makeOrder('cod', 900);
  orderModel.setStatus(oManualCod.ref, 'livree', {});
  ok('setStatus payee bloqué (cod)', orderModel.setStatus(oManualCod.ref, 'payee', { actorRole: 'admin' }) === false);

  // Un avis exige une commande livrée/payée : une commande en attente ne suffit pas.
  const reviewEarly = require('../src/models/review');
  const oEarly = makeOrder('cod', 500);
  const earlyUser = db.prepare("SELECT id FROM users WHERE role='seller'").get();
  ok('commande en attente ne permet pas un avis', reviewEarly.hasOrdered(earlyUser.id, 1) === false);

  // Cohérence COD : une régression de payee -> livree doit repasser pending.
  const oReg = makeOrder('cod', 700);
  orderModel.setStatus(oReg.ref, 'livree', {});
  orderModel.confirmCodPayment(oReg.ref, db.prepare("SELECT id FROM users WHERE role='seller'").get().id, 'seller');
  ok('COD confirmée -> payee + paid', orderModel.findByRef(oReg.ref).status === 'payee' && orderModel.findByRef(oReg.ref).payment_status === 'paid');
  orderModel.setStatus(oReg.ref, 'livree', { actorRole: 'admin' });
  const oRegAfter = orderModel.findByRef(oReg.ref);
  ok('régression payee -> livree remet pending', oRegAfter.status === 'livree' && oRegAfter.payment_status === 'pending');

  // ---- Avis clients ---------------------------------------------------------
  const review = require('../src/models/review');

  // Nouveau client dédié (session propre) : inscription -> commande -> avis.
  const reviewer = request.agent(app);
  res = await reviewer.get('/inscription');
  csrf = extractCsrf(res.text);
  res = await reviewer.post('/inscription').type('form')
    .send({ _csrf: csrf, name: 'Avis Test', email: 'avis@test.com', password: 'secret789' });
  ok('avis : inscription -> 302', res.status === 302);

  res = await reviewer.get('/produit/t-shirt-coton');
  csrf = extractCsrf(res.text);
  res = await reviewer.post('/panier/ajouter').type('form')
    .send({ _csrf: csrf, productId: 1, qty: 1, size: 'M' });
  res = await reviewer.get('/commande');
  csrf = extractCsrf(res.text);
  res = await reviewer.post('/commande').type('form').send({
    _csrf: csrf, nom: 'Avis Test', email: 'avis@test.com',
    telephone: '0550123456', adresse: '12 Rue X', ville: 'Alger', payment_method: 'cod',
  });
  ok('avis : commande -> 302', res.status === 302);
  const reviewOrderRef = (res.headers.location || '').split('/').pop();
  // L'avis exige une commande livrée/payée : on simule le parcours logistique.
  orderModel.setStatus(reviewOrderRef, 'expediee', {});
  orderModel.setStatus(reviewOrderRef, 'livree', {});
  orderModel.confirmCodPayment(reviewOrderRef, db.prepare("SELECT id FROM users WHERE role='seller'").get().id, 'seller');

  // Dépôt d'avis valide.
  res = await reviewer.get('/produit/t-shirt-coton');
  csrf = extractCsrf(res.text);
  res = await reviewer.post('/produit/t-shirt-coton/avis').type('form')
    .send({ _csrf: csrf, rating: 5, comment: 'Très bon produit' });
  ok('dépôt avis -> 302', res.status === 302);
  ok('avis enregistré', review.statsForProduct(1).count === 1);
  ok('note moyenne = 5', review.statsForProduct(1).avg === 5);

  // Note invalide (99) refusée : la note reste 5.
  res = await reviewer.get('/produit/t-shirt-coton');
  csrf = extractCsrf(res.text);
  res = await reviewer.post('/produit/t-shirt-coton/avis').type('form')
    .send({ _csrf: csrf, rating: 99, comment: '' });
  ok('note invalide (99) refusée', res.status === 302 && review.statsForProduct(1).avg === 5);

  // Un client sans connexion ne peut pas déposer d'avis (CSRF global le bloque).
  res = await request(app).post('/produit/t-shirt-coton/avis').type('form')
    .send({ rating: 5, comment: '' });
  ok('avis sans auth -> bloqué (403 CSRF)', res.status === 403);

  // Un client qui n'a PAS commandé le produit ne peut pas déposer d'avis.
  const reviewer2 = request.agent(app);
  res = await reviewer2.get('/inscription');
  csrf = extractCsrf(res.text);
  res = await reviewer2.post('/inscription').type('form')
    .send({ _csrf: csrf, name: 'Avis Sans Achat', email: 'avis2@test.com', password: 'secret000' });
  res = await reviewer2.get('/produit/t-shirt-coton');
  csrf = extractCsrf(res.text);
  res = await reviewer2.post('/produit/t-shirt-coton/avis').type('form')
    .send({ _csrf: csrf, rating: 5, comment: 'Je n\'ai pas acheté' });
  ok('avis sans commande -> refusé', res.status === 302 && review.statsForProduct(1).count === 1);

  // La fiche produit affiche l'avis.
  res = await request(app).get('/produit/t-shirt-coton');
  ok('fiche produit affiche la section avis', /reviews-section/.test(res.text));
  ok('fiche produit affiche le lien vers les avis', /href="#reviews"/.test(res.text));
  ok('fiche produit affiche le commentaire', /Très bon produit/.test(res.text));

  // ---- Codes promo ----------------------------------------------------------
  const coupon = require('../src/models/coupon');

  // Coupon pourcentage valide.
  coupon.create({ code: 'PROMO10', type: 'percent', value: 10, min_amount: 0, max_uses: 0, active: true, expires_at: null });
  ok('coupon pourcentage -> 10% de remise', coupon.discountFor('PROMO10', 1000) === 100);
  ok('coupon insensible à la casse', coupon.discountFor('promo10', 1000) === 100);

  // Coupon montant fixe, plafonné au sous-total.
  coupon.create({ code: 'FIXE500', type: 'fixed', value: 500, min_amount: 0, max_uses: 0, active: true, expires_at: null });
  ok('coupon fixe -> 500 DA de remise', coupon.discountFor('FIXE500', 2000) === 500);
  ok('coupon fixe plafonné au sous-total', coupon.discountFor('FIXE500', 300) === 300);

  // Coupon avec montant minimum non atteint.
  coupon.create({ code: 'MIN1000', type: 'fixed', value: 100, min_amount: 1000, max_uses: 0, active: true, expires_at: null });
  ok('coupon min non atteint -> refusé', coupon.discountFor('MIN1000', 500) === null);

  // Coupon expiré.
  coupon.create({ code: 'EXPIRE', type: 'percent', value: 50, min_amount: 0, max_uses: 0, active: true, expires_at: '2020-01-01T00:00:00.000Z' });
  ok('coupon expiré -> refusé', coupon.discountFor('EXPIRE', 1000) === null);

  // Coupon à usage limité : la réservation se fait dans la transaction de commande.
  coupon.create({ code: 'ONCE', type: 'percent', value: 20, min_amount: 0, max_uses: 1, active: true, expires_at: null });
  ok('coupon usage limité -> 1re fois OK', coupon.discountFor('ONCE', 1000) === 200);
  orderModel.create({
    order: { user_id: null, status: 'en_attente', total_dzd: 1400, total_eur: '6.30', delivery_dzd: 600,
      payment_method: 'cod', payment_status: 'pending', provider_id: '', nom: 'Coupon', email: 'c@test.com',
      telephone: '0550123456', adresse: '1 Rue C', ville: 'Alger', coupon_code: 'ONCE', discount_dzd: 200 },
    items: [{ productId: 2, name: 'Chemise oxford', priceDzd: 1400, qty: 1, size: 'M' }],
  });
  ok('coupon épuisé après commande -> refusé', coupon.discountFor('ONCE', 1000) === null);
  let couponError = null;
  try {
    orderModel.create({
      order: { user_id: null, status: 'en_attente', total_dzd: 700, total_eur: '3.15', delivery_dzd: 600,
        payment_method: 'cod', payment_status: 'pending', provider_id: '', nom: 'Coupon2', email: 'c2@test.com',
        telephone: '0550123456', adresse: '1 Rue C', ville: 'Alger', coupon_code: 'ONCE', discount_dzd: 0 },
      items: [{ productId: 3, name: 'Jean classique', priceDzd: 100, qty: 1, size: 'M' }],
    });
  } catch (e) {
    couponError = e.code;
  }
  ok('commande avec coupon épuisé -> rejet atomique', couponError === 'COUPON_INVALID');

  // Code inconnu.
  ok('code inconnu -> refusé', coupon.discountFor('INCONNU', 1000) === null);

  // Parcours HTTP : appliquer un coupon au panier.
  res = await reviewer.get('/produit/t-shirt-coton');
  csrf = extractCsrf(res.text);
  await reviewer.post('/panier/ajouter').type('form').send({ _csrf: csrf, productId: 1, qty: 1, size: 'M' });
  res = await reviewer.get('/panier');
  csrf = extractCsrf(res.text);
  res = await reviewer.post('/panier/coupon').type('form').send({ _csrf: csrf, coupon: 'PROMO10' });
  ok('appliquer un coupon -> 302', res.status === 302);
  res = await reviewer.get('/panier');
  ok('panier affiche le coupon appliqué', /PROMO10/.test(res.text));

  console.log('\nTests : ' + passed + ' assertions OK.');
  process.exit(0);
})().catch((err) => {
  console.error('\n✗ ' + err.message);
  process.exit(1);
});
