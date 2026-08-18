'use strict';

// Validation serveur centralisée. Toute donnée venant du navigateur ou de
// l'URL doit être validée ici : la validation frontend n'est jamais une
// mesure de sécurité.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Téléphone : 8 à 20 caractères, chiffres/espaces/tirets/points/plus/().
const PHONE_RE = /^[+0-9][0-9\s().-]{6,19}$/;

const MAX = {
  name: 100,
  email: 254,
  telephone: 20,
  adresse: 500,
  ville: 100,
  password: 128,
  search: 200,
  slug: 200,
  productName: 200,
  description: 5000,
  sizes: 200,
  size: 50,
  qty: 99,
};

function isEmail(value) {
  return typeof value === 'string' && value.length <= MAX.email && EMAIL_RE.test(value);
}

function isPhone(value) {
  return typeof value === 'string' && value.length <= MAX.telephone && PHONE_RE.test(value);
}

// Identifiant numérique entier strictement positif.
function isId(value) {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'number') return Number.isInteger(value) && value > 0;
  return /^[1-9][0-9]*$/.test(String(value));
}

function isInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= min && value <= max;
  }
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (!/^-?\d+$/.test(value.trim())) return false;
  const n = parseInt(value, 10);
  return n >= min && n <= max;
}

function isStr(value, { min = 1, max: len = 1000 } = {}) {
  return typeof value === 'string' && value.length >= min && value.length <= len;
}

function trimMax(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// Nettoie les champs d'un formulaire : string trim + tronquée, jamais null.
function textField(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// Validation du checkout : retourne { ok, form, errors, errorKey }.
function checkout(body) {
  const form = {
    nom: textField(body.nom, MAX.name),
    email: textField(body.email, MAX.email).toLowerCase(),
    telephone: textField(body.telephone, MAX.telephone),
    adresse: textField(body.adresse, MAX.adresse),
    ville: textField(body.ville, MAX.ville),
    payment_method: textField(body.payment_method, 20),
  };

  const errors = {};
  if (!isStr(form.nom, { min: 1, max: MAX.name })) errors.nom = 'auth.required';
  if (!isEmail(form.email)) errors.email = 'auth.invalid';
  if (!isPhone(form.telephone)) errors.telephone = 'auth.required';
  if (!isStr(form.adresse, { min: 1, max: MAX.adresse })) errors.adresse = 'auth.required';
  if (!isStr(form.ville, { min: 1, max: MAX.ville })) errors.ville = 'auth.required';
  if (!['cod', 'stripe', 'paypal'].includes(form.payment_method)) errors.payment_method = 'auth.required';

  return {
    ok: Object.keys(errors).length === 0,
    form,
    errors,
    errorKey: Object.keys(errors).length ? errors[Object.keys(errors)[0]] : null,
  };
}

// Validation du formulaire produit (back-office) : retourne { ok, data, error }.
function product(body) {
  const data = {
    name_fr: textField(body.name_fr, MAX.productName),
    name_ar: textField(body.name_ar, MAX.productName),
    description_fr: textField(body.description_fr, MAX.description),
    description_ar: textField(body.description_ar, MAX.description),
    price_dzd: body.price_dzd,
    stock: body.stock,
    sizes: textField(body.sizes, MAX.sizes),
    slug: textField(body.slug, MAX.slug),
    category_id: body.category_id,
    active: body.active === '1' || body.active === 'on' ? 1 : 0,
  };

  if (!isStr(data.name_fr, { min: 1, max: MAX.productName })) {
    return { ok: false, data, error: 'name_required' };
  }
  if (!isInt(data.price_dzd, { min: 0, max: 100000000 })) {
    return { ok: false, data, error: 'price_invalid' };
  }
  if (!isInt(data.stock, { min: 0, max: 100000000 })) {
    return { ok: false, data, error: 'stock_invalid' };
  }
  data.price_dzd = parseInt(data.price_dzd, 10);
  data.stock = parseInt(data.stock, 10);
  data.category_id = isId(data.category_id) ? parseInt(data.category_id, 10) : null;
  return { ok: true, data, error: null };
}

// Validation de catégorie.
function category(body) {
  const name_fr = textField(body.name_fr, MAX.productName);
  const name_ar = textField(body.name_ar, MAX.productName);
  if (!isStr(name_fr, { min: 1, max: MAX.productName })) {
    return { ok: false, name_fr, name_ar };
  }
  return { ok: true, name_fr, name_ar };
}

module.exports = {
  isEmail,
  isPhone,
  isId,
  isInt,
  isStr,
  textField,
  checkout,
  product,
  category,
  MAX,
};
