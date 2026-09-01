'use strict';
require('dotenv').config();

function validateProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;

  const required = [
    ['SESSION_SECRET', process.env.SESSION_SECRET, (value) => value && value.length >= 32],
    ['BASE_URL', process.env.BASE_URL, (value) => /^https:\/\//i.test(value || '')],
    ['ADMIN_PASSWORD', process.env.ADMIN_PASSWORD, (value) => value && value !== 'admin123' && value.length >= 12],
  ];
  const invalid = required.filter(([, value, isValid]) => !isValid(value)).map(([name]) => name);
  if (invalid.length) {
    throw new Error(`Configuration production invalide ou absente : ${invalid.join(', ')}`);
  }
}

validateProductionConfig();

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
  // Numéro WhatsApp au format international sans "+" (ex. 213555123456).
  // Utilisé pour le bouton "Commander via WhatsApp". Vide = bouton masqué.
  whatsappNumber: (process.env.WHATSAPP_NUMBER || '').replace(/[^0-9]/g, ''),
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
  // SMTP pour l'envoi d'e-mails (réinitialisation de mot de passe…). Laissé
  // vide, l'envoi est désactivé : en dev le lien de réinitialisation est
  // journalisé dans la console pour permettre de tester localement.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === '1',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
  // Connexion Google (OAuth 2.0). Laisser vides pour masquer le bouton.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  },
  // Durée de validité (en heures) du lien de réinitialisation.
  resetTokenTtlHours: parseInt(process.env.RESET_TOKEN_TTL_HOURS || '1', 10),
  // Seuils de rate limiting (surchargeables en test via les variables d'env).
  rateLimit: {
    loginMax: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '10', 10),
    registerMax: parseInt(process.env.RATE_LIMIT_REGISTER_MAX || '10', 10),
    paymentMax: parseInt(process.env.RATE_LIMIT_PAYMENT_MAX || '30', 10),
    resetMax: parseInt(process.env.RATE_LIMIT_RESET_MAX || '5', 10),
    globalMax: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || '600', 10),
  },
};
