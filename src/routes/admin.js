'use strict';
const router = require('express').Router();
const multer = require('multer');
const product = require('../models/product');
const category = require('../models/category');
const orderModel = require('../models/order');
const userModel = require('../models/user');
const { requireAdmin } = require('../middleware/auth');
const { assertCsrf } = require('../middleware/csrf');
const { slugify } = require('../services/slugify');
const validate = require('../services/validate');
const image = require('../services/image');
const { STATUSES } = require('../services/orderStatus');
const shipmentLabel = require('../services/shipmentLabel');
const config = require('../config');
const bcrypt = require('bcryptjs');

router.use(requireAdmin);

// Upload en mémoire : le contenu réel est vérifié (magic bytes) avant
// écriture. L'extension du nom de fichier n'est JAMAIS une preuve.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 30,
    parts: 32,
    fieldNameSize: 100,
    headerPairs: 100,
  },
});

function uploadSingle(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) {
        req.session.flash = { type: 'error', key: 'admin.upload_error' };
        return res.redirect(req.get('referer') || '/admin/produits');
      }
      // CSRF vérifié après multer (corps multipart désormais parsé).
      if (!assertCsrf(req)) {
        return res.status(403).send('Jeton CSRF invalide.');
      }
      next();
    });
  };
}

function buildProductData(v, imagePath) {
  return {
    ...v.data,
    slug: slugify(v.data.slug || v.data.name_fr),
    image: imagePath,
  };
}

// Tableau de bord
router.get('/', (req, res) => {
  const { totalOrders, revenue } = orderModel.stats();
  const requestedStatus = typeof req.query.status === 'string' ? req.query.status : 'all';
  const status = requestedStatus === 'all' || STATUSES.includes(requestedStatus) ? requestedStatus : 'all';
  res.render('admin/dashboard', {
    title: 'admin',
    totalOrders,
    revenue,
    productsCount: product.count(),
    lowStock: product.countLowStock(),
    customers: userModel.countCustomers(),
    recentOrders: status === 'all' ? orderModel.listRecent(10) : orderModel.listRecentByStatus(status, 10),
    status,
    statusCounts: orderModel.statusCounts(),
    statuses: STATUSES,
  });
});

// Produits — liste
router.get('/produits', (req, res) => {
  res.render('admin/products', {
    title: 'admin',
    products: product.listAll(),
    categories: category.listAll(),
  });
});

// Produits — création
router.get('/produits/nouveau', (req, res) => {
  res.render('admin/product-form', { title: 'admin', product: null, categories: category.listAll() });
});
router.post('/produits/nouveau', uploadSingle('image'), (req, res) => {
  const v = validate.product(req.body);
  if (!v.ok) {
    req.session.flash = { type: 'error', key: 'admin.invalid_data' };
    return res.redirect('/admin/produits/nouveau');
  }
  let imagePath = '';
  if (req.file) {
    try {
      imagePath = image.saveImage(req.file.buffer);
    } catch (_) {
      req.session.flash = { type: 'error', key: 'admin.upload_invalid' };
      return res.redirect('/admin/produits/nouveau');
    }
  }
  product.create(buildProductData(v, imagePath));
  res.redirect('/admin/produits');
});

// Produits — édition
router.get('/produits/:id', (req, res) => {
  const p = product.findById(req.params.id);
  if (!p) return res.redirect('/admin/produits');
  res.render('admin/product-form', { title: 'admin', product: p, categories: category.listAll() });
});
router.post('/produits/:id', uploadSingle('image'), (req, res) => {
  const p = product.findById(req.params.id);
  if (!p) return res.redirect('/admin/produits');
  const v = validate.product(req.body);
  if (!v.ok) {
    req.session.flash = { type: 'error', key: 'admin.invalid_data' };
    return res.redirect('/admin/produits/' + p.id);
  }
  let imagePath = p.image;
  if (req.file) {
    try {
      imagePath = image.saveImage(req.file.buffer);
      image.removeImage(p.image); // remplace l'ancienne image
    } catch (_) {
      req.session.flash = { type: 'error', key: 'admin.upload_invalid' };
      return res.redirect('/admin/produits/' + p.id);
    }
  }
  product.update(p.id, buildProductData(v, imagePath));
  res.redirect('/admin/produits');
});
router.post('/produits/:id/supprimer', (req, res) => {
  const p = product.findById(req.params.id);
  if (p) image.removeImage(p.image);
  product.remove(req.params.id);
  res.redirect('/admin/produits');
});

// Catégories
router.get('/categories', (req, res) => {
  res.render('admin/categories', { title: 'admin', categories: category.listAll() });
});
router.post('/categories/nouveau', (req, res) => {
  const c = validate.category(req.body);
  if (!c.ok) {
    req.session.flash = { type: 'error', key: 'admin.invalid_data' };
    return res.redirect('/admin/categories');
  }
  category.create({ slug: slugify(c.name_fr), name_fr: c.name_fr, name_ar: c.name_ar });
  res.redirect('/admin/categories');
});
router.post('/categories/:id', (req, res) => {
  const cat = category.findById(req.params.id);
  if (!cat) return res.redirect('/admin/categories');
  const c = validate.category(req.body);
  const name_fr = c.ok ? c.name_fr : cat.name_fr;
  const name_ar = c.ok ? c.name_ar : cat.name_ar;
  category.update(cat.id, { slug: slugify(name_fr), name_fr, name_ar });
  res.redirect('/admin/categories');
});
router.post('/categories/:id/supprimer', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (category.countProducts(id) > 0) {
    req.session.flash = { type: 'error', key: 'admin.cat_has_products' };
    return res.redirect('/admin/categories');
  }
  category.remove(id);
  res.redirect('/admin/categories');
});

// Commandes
router.get('/commandes', (req, res) => {
  res.render('admin/orders', { title: 'admin', orders: orderModel.listAll() });
});
router.get('/commandes/:ref', (req, res) => {
  const order = orderModel.findByRef(req.params.ref);
  if (!order) return res.redirect('/admin/commandes');
  res.render('admin/order', { title: 'admin', order, history: orderModel.listHistory(order.ref) });
});

// Génération/réimpression : seul l'administrateur connaît le token brut.
router.post('/commandes/:ref/etiquette', async (req, res, next) => {
  const order = orderModel.findByRef(req.params.ref);
  if (!order) return res.redirect('/admin/commandes');
  try {
    const token = shipmentLabel.issue(order.id);
    const qrDataUrl = await shipmentLabel.toDataUrl(token, config.baseUrl);
    return res.render('admin/label', { title: 'label', order, qrDataUrl });
  } catch (err) {
    return next(err);
  }
});
router.post('/commandes/:ref/action', (req, res) => {
  const action = validate.textField(req.body.action, 20);
  const carrier = validate.textField(req.body.carrier, 100);
  const trackingNumber = validate.textField(req.body.tracking_number, 100);
  const ok = orderModel.actionFor(req.params.ref, action, {
    actorId: req.session.user.id,
    actorRole: req.session.user.role,
    carrier,
    trackingNumber,
  });
  req.session.flash = ok
    ? { type: 'success', key: 'admin.action_done' }
    : { type: 'error', key: 'admin.action_invalid' };
  res.redirect('/admin/commandes/' + req.params.ref);
});
router.post('/commandes/:ref/statut', (req, res) => {
  const status = req.body.status;
  const carrier = validate.textField(req.body.carrier, 100);
  const trackingNumber = validate.textField(req.body.tracking_number, 100);
  const ok = orderModel.setStatus(req.params.ref, status, {
    actorId: req.session.user.id,
    actorRole: req.session.user.role,
    carrier,
    trackingNumber,
    action: 'manual_status_update',
  });
  req.session.flash = ok
    ? { type: 'success', key: 'admin.updated_status' }
    : { type: 'error', key: 'admin.action_invalid' };
  res.redirect('/admin/commandes/' + req.params.ref);
});

router.post('/commandes/:ref/incident', (req, res) => {
  const issue = validate.textField(req.body.issue, 20);
  const ok = orderModel.recordDeliveryIssue(req.params.ref, issue, req.session.user.id);
  req.session.flash = ok
    ? { type: 'success', key: 'admin.incident_done' }
    : { type: 'error', key: 'admin.action_invalid' };
  res.redirect('/admin/commandes/' + req.params.ref);
});

router.post('/commandes/:ref/retour', (req, res) => {
  const condition = validate.textField(req.body.condition, 20);
  const ok = orderModel.returnReceived(req.params.ref, condition, req.session.user.id);
  req.session.flash = ok
    ? { type: 'success', key: 'admin.return_done' }
    : { type: 'error', key: 'admin.action_invalid' };
  res.redirect('/admin/commandes/' + req.params.ref);
});

// Clients
router.get('/clients', (req, res) => {
  res.render('admin/users', { title: 'admin', users: userModel.listCustomers(), sellers: userModel.listSellers() });
});

router.post('/vendeurs/nouveau', (req, res) => {
  const name = validate.textField(req.body.name, validate.MAX.name);
  const email = validate.textField(req.body.email, validate.MAX.email).toLowerCase();
  const password = req.body.password || '';
  if (!name || !validate.isEmail(email) || password.length < 6 || password.length > validate.MAX.password || userModel.findByEmail(email)) {
    req.session.flash = { type: 'error', key: 'admin.seller_invalid' };
    return res.redirect('/admin/clients');
  }
  userModel.create({ name, email, role: 'seller', password_hash: bcrypt.hashSync(password, 10) });
  req.session.flash = { type: 'success', key: 'admin.seller_created' };
  return res.redirect('/admin/clients');
});

module.exports = router;
