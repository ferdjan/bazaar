'use strict';
const productModel = require('../models/product');

// Le panier est stocké en session : { [`${productId}:${size}`]: qty }.
function getCart(req) {
  const map = req.session.cart || {};
  const items = [];
  let total = 0;
  for (const [key, qty] of Object.entries(map)) {
    const q = qty || 0;
    if (q <= 0) continue;
    const [idStr, size = ''] = String(key).split(':');
    const id = parseInt(idStr, 10);
    const product = productModel.findById(id);
    if (!product || !product.active) continue;
    const lineTotal = product.price_dzd * q;
    items.push({ product, size, qty: q, lineTotal });
    total += lineTotal;
  }
  return { items, total };
}

function validSizes(product) {
  return (product.sizes || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Validation stricte du panier au moment du checkout. Recalcule prix, total,
// disponibilité, stock, taille et quantité DEPUIS LA BASE (jamais depuis les
// données du navigateur). Retourne { ok, items, total, errorKey }.
function validateCart(req) {
  const map = req.session.cart || {};
  const items = [];
  let total = 0;

  for (const [key, qty] of Object.entries(map)) {
    const [idStr, size = ''] = String(key).split(':');
    const id = parseInt(idStr, 10);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, errorKey: 'cart.invalid' };

    const q = parseInt(qty, 10);
    if (!Number.isInteger(q) || q <= 0 || q > 99) return { ok: false, errorKey: 'cart.invalid' };

    const product = productModel.findById(id);
    if (!product || !product.active) return { ok: false, errorKey: 'cart.unavailable' };

    const sizes = validSizes(product);
    if (sizes.length) {
      if (!sizes.includes(size)) return { ok: false, errorKey: 'cart.invalid_size' };
    } else if (size !== '') {
      return { ok: false, errorKey: 'cart.invalid_size' };
    }

    if (product.stock < q) return { ok: false, errorKey: 'cart.insufficient_stock' };

    const lineTotal = product.price_dzd * q;
    items.push({ product, size, qty: q, lineTotal });
    total += lineTotal;
  }

  if (!items.length) return { ok: false, errorKey: 'checkout.empty' };
  return { ok: true, items, total };
}

function clearCart(req) {
  req.session.cart = {};
}

module.exports = { getCart, validateCart, clearCart, validSizes };
