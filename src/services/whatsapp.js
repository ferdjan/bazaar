'use strict';
const config = require('../config');

// Construit le lien "Commander via WhatsApp" (wa.me) à partir du panier.
// Retourne '' si aucun numéro WhatsApp n'est configuré.
function buildCartLink(items, { subtotal, delivery, total }, lang = 'fr') {
  if (!config.whatsappNumber) return '';

  const lines = items.map((it) => {
    const name = lang === 'ar' ? it.product.name_ar : it.product.name_fr;
    const size = it.size ? ` (${it.size})` : '';
    return `• ${name}${size} x${it.qty} — ${it.lineTotal} DA`;
  });

  const body = [
    lang === 'ar' ? 'مرحباً، أريد طلب المنتجات التالية:' : 'Bonjour, je souhaite commander :',
    ...lines,
    lang === 'ar' ? `المجموع: ${subtotal} دج · التوصيل: ${delivery} دج · الإجمالي: ${total} دج` : `Sous-total: ${subtotal} DA · Livraison: ${delivery} DA · Total: ${total} DA`,
  ].join('\n');

  return `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(body)}`;
}

// Lien "Commander ce produit via WhatsApp" pour la fiche produit.
function buildProductLink(product, lang = 'fr') {
  if (!config.whatsappNumber) return '';

  const name = lang === 'ar' ? product.name_ar : product.name_fr;
  const body = [
    lang === 'ar' ? 'مرحباً، أنا مهتم بهذا المنتج:' : 'Bonjour, je suis intéressé par ce produit :',
    `${name} — ${product.price_dzd} DA`,
  ].join('\n');

  return `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(body)}`;
}

module.exports = { buildCartLink, buildProductLink };
