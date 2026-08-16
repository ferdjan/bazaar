'use strict';
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const product = require('../models/product');
const category = require('../models/category');
const orderModel = require('../models/order');
const userModel = require('../models/user');
const { requireAdmin } = require('../middleware/auth');
const { slugify } = require('../services/slugify');

router.use(requireAdmin);

// Upload d'image produit
const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpe?g|png|webp)$/i.test(file.originalname);
    cb(ok ? null : new Error('Format image invalide (jpg/png/webp)'), ok);
  },
});

// Tableau de bord
router.get('/', (req, res) => {
  const { totalOrders, revenue } = orderModel.stats();
  res.render('admin/dashboard', {
    title: 'admin',
    totalOrders,
    revenue,
    productsCount: product.count(),
    lowStock: product.countLowStock(),
    customers: userModel.countCustomers(),
    recentOrders: orderModel.listAll().slice(0, 10),
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
router.post('/produits/nouveau', upload.single('image'), (req, res) => {
  const data = productDataFromBody(req.body, req.file);
  if (!data.name_fr) return res.redirect('/admin/produits/nouveau');
  product.create(data);
  res.redirect('/admin/produits');
});

// Produits — édition
router.get('/produits/:id', (req, res) => {
  const p = product.findById(req.params.id);
  if (!p) return res.redirect('/admin/produits');
  res.render('admin/product-form', { title: 'admin', product: p, categories: category.listAll() });
});
router.post('/produits/:id', upload.single('image'), (req, res) => {
  const p = product.findById(req.params.id);
  if (!p) return res.redirect('/admin/produits');
  const data = productDataFromBody(req.body, req.file, p.image);
  product.update(p.id, data);
  res.redirect('/admin/produits');
});
router.post('/produits/:id/supprimer', (req, res) => {
  product.remove(req.params.id);
  res.redirect('/admin/produits');
});

// Catégories
router.get('/categories', (req, res) => {
  res.render('admin/categories', { title: 'admin', categories: category.listAll() });
});
router.post('/categories/nouveau', (req, res) => {
  const name_fr = (req.body.name_fr || '').trim();
  const name_ar = (req.body.name_ar || '').trim();
  if (name_fr) category.create({ slug: slugify(name_fr), name_fr, name_ar });
  res.redirect('/admin/categories');
});
router.post('/categories/:id', (req, res) => {
  const c = category.findById(req.params.id);
  if (!c) return res.redirect('/admin/categories');
  category.update(c.id, {
    slug: slugify(req.body.name_fr || c.name_fr),
    name_fr: (req.body.name_fr || '').trim() || c.name_fr,
    name_ar: (req.body.name_ar || '').trim() || c.name_ar,
  });
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
  res.render('admin/order', { title: 'admin', order });
});
router.post('/commandes/:ref/statut', (req, res) => {
  const valid = ['en_attente', 'payee', 'expediee', 'livree', 'annulee'];
  if (valid.includes(req.body.status)) orderModel.updateStatus(req.params.ref, req.body.status);
  res.redirect('/admin/commandes/' + req.params.ref);
});

// Clients
router.get('/clients', (req, res) => {
  res.render('admin/users', { title: 'admin', users: userModel.listCustomers() });
});

module.exports = router;

function productDataFromBody(body, file, existingImage = '') {
  const name_fr = (body.name_fr || '').trim();
  return {
    slug: slugify(body.slug || name_fr),
    name_fr,
    name_ar: (body.name_ar || '').trim(),
    description_fr: (body.description_fr || '').trim(),
    description_ar: (body.description_ar || '').trim(),
    price_dzd: parseInt(body.price_dzd, 10) || 0,
    stock: parseInt(body.stock, 10) || 0,
    sizes: (body.sizes || '').trim(),
    category_id: body.category_id ? parseInt(body.category_id, 10) : null,
    active: body.active === '1' || body.active === 'on' ? 1 : 0,
    image: file ? '/uploads/' + file.filename : existingImage,
  };
}
