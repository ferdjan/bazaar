'use strict';
const config = require('../../config');

// Connexion « Google » via OAuth 2.0 (flux code d'autorisation, sans
// dépendance externe). Le jeton d'accès n'est JAMAIS stocké : il ne sert qu'à
// lire le profil (sub, e-mail vérifié, nom) puis est abandonné.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function isConfigured() {
  return !!(config.google.clientId && config.google.clientSecret);
}

function redirectUri() {
  return config.google.redirectUri || (config.baseUrl.replace(/\/$/, '') + '/auth/google/callback');
}

// URL d'autorisation. `state` (jeton aléatoire stocké en session) protège
// contre la falsification de requête intersite (CSRF OAuth).
function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// Échange le code contre un jeton d'accès (requête serveur-à-serveur avec le
// secret, jamais exposé au navigateur).
async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Google token exchange échoué : ' + res.status + ' ' + text);
  }
  return res.json();
}

// Récupère le profil (identité) de l'utilisateur via le jeton d'accès.
async function fetchProfile(accessToken) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) {
    throw new Error('Google userinfo échoué : ' + res.status);
  }
  return res.json();
}

// Résout un profil Google brut en identité utilisable, avec les contrôles de
// sécurité requis (e-mail présent et vérifié, sub non vide).
function normalizeProfile(profile) {
  const email = String(profile.email || '').trim().toLowerCase();
  const sub = String(profile.sub || '').trim();
  const name = String(profile.name || '').trim().slice(0, 100);
  if (!sub || !email) return null;
  if (profile.email_verified !== true) return null;
  return { sub, email, name: name || email.split('@')[0] };
}

module.exports = { isConfigured, buildAuthUrl, exchangeCode, fetchProfile, normalizeProfile, redirectUri };
