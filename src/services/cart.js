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

function clearCart(req) {
  req.session.cart = {};
}

module.exports = { getCart, clearCart };
