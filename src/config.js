'use strict';
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  // À activer (TRUST_PROXY=1) uniquement derrière un reverse proxy maîtrisé
  // (Render, Nginx, Caddy…). Sinon, un client pourrait forger X-Forwarded-For.
  trustProxy: process.env.TRUST_PROXY === '1',
  // 1 DZD = X EUR (taux de conversion pour les paiements en ligne)
  dzdToEurRate: parseFloat(process.env.DZD_TO_EUR_RATE || '0.0045'),
  // Frais de livraison forfaitaires (DZD) ajoutés à chaque commande.
  deliveryFeeDzd: parseInt(process.env.DELIVERY_FEE_DZD || '600', 10),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publicKey: process.env.STRIPE_PUBLIC_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
    mode: process.env.PAYPAL_MODE || 'sandbox',
  },
  // Seuils de rate limiting (surchargeables en test via les variables d'env).
  rateLimit: {
    loginMax: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '10', 10),
    registerMax: parseInt(process.env.RATE_LIMIT_REGISTER_MAX || '10', 10),
    paymentMax: parseInt(process.env.RATE_LIMIT_PAYMENT_MAX || '30', 10),
    globalMax: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || '600', 10),
  },
};
