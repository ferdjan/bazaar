# Audit de sécurité — Bazaar

## 🔴 Critique (actions immédiates)

1. **Identifiants Google OAuth réels dans `.env`** — Révoquer depuis https://console.cloud.google.com/apis/credentials
2. **Fichier `client_secret_*.json` sur le disque** — Supprimer

## 🟡 Faiblesses

| Problème | Sévérité |
|---|---|
| Mot de passe admin par défaut `admin123` | Moyen |
| Session admin 24h (trop longue) | Bas |
| Pas de 2FA | Moyen |
| Pas d'audit de dépendances (`npm audit`) | Bas |

## ✅ Bonnes pratiques en place

- CSP (nonces, pas d'`unsafe-inline`)
- CSRF (timingSafeEqual)
- Rate limiting par IP + email
- Sessions régénérées après login
- Requêtes paramétrées (pas d'injection SQL)
- Webhooks Stripe/PayPal signés
- Jetons de reset en empreinte SHA-256
- Upload validé par magic bytes
- Montants recalculés côté serveur
- Helmet, erreurs 500 génériques
- Validation production (SESSION_SECRET ≥ 32, HTTPS, mot de passe admin changé)
- Révocation des sessions après changement de mot de passe
