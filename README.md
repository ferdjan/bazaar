# Bazaar 🛍️

Boutique e-commerce (vêtements & électronique) — interface **FR / Arabe (RTL)**, devise **Dinar
algérien (DZD)**, paiement **Stripe + PayPal + cash à la livraison**.

Stack : **Node.js + Express + SQLite** (rendu serveur EJS).

## Fonctionnalités

- Catalogue produits (2 catégories de départ, filtres, recherche FR/AR)
- Fiches produit, panier en session, comptes clients (bcrypt)
- Checkout avec **3 moyens de paiement** : carte (Stripe), PayPal, cash à la livraison
- Back-office admin : produits, catégories, commandes, clients, tableau de bord
- Interface bilingue FR / Arabe avec bascule RTL
- Sécurité : mots de passe hashés, CSRF, requêtes SQL préparées, uploads contrôlés, helmet

## Installation

```bash
npm install
cp .env.example .env   # puis renseigner les valeurs
npm run seed           # crée la base + admin + produits d'exemple (idempotent)
npm run dev            # serveur de dev (nodemon)
# ou
npm start              # serveur de production
```

Le site est servi sur `http://localhost:3000`.

## Compte admin (par défaut)

| Champ | Valeur |
|---|---|
| E-mail | `admin@example.com` |
| Mot de passe | `admin123` |

> ⚠️ **Change le mot de passe admin** en production (variable `ADMIN_PASSWORD` dans `.env`
> avant le premier `npm run seed`, ou en base).

## Configuration (.env)

| Variable | Rôle |
|---|---|
| `PORT` | Port HTTP (3000) |
| `SESSION_SECRET` | Secret de session (chaîne longue aléatoire en prod) |
| `DZD_TO_EUR_RATE` | Taux 1 DZD → EUR pour les paiements en ligne |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLIC_KEY` / `STRIPE_WEBHOOK_SECRET` | Clés Stripe |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_MODE` | Clés PayPal (`sandbox` ou `live`) |

## Paiements

- **Cash à la livraison** : fonctionne immédiatement, sans configuration.
- **Stripe** (mode test) : crée des clés sur <https://dashboard.stripe.com/test/apikeys>, puis
  test avec la carte `4242 4242 4242 4242`. Le webhook (`/webhooks/stripe`) confirme le paiement.
- **PayPal** (sandbox) : crée une app sur <https://developer.paypal.com/dashboard>, mode `sandbox`.
  La capture se fait au retour de l'acheteur.

### ⚠️ Devise

Stripe et PayPal **ne supportent pas le DZD**. La boutique affiche les prix en **DZD**, mais les
paiements en ligne sont facturés en **EUR** via le taux `DZD_TO_EUR_RATE` (montant converti au
moment du checkout). Le cash à la livraison reste en DZD.

## Tests

```bash
npm test   # 20 assertions d'intégration HTTP (supertest, base :memory:)
```

## Structure

```
src/
├── server.js          point d'entrée
├── app.js             app Express (middlewares, routes)
├── config.js          lecture .env
├── db/                connexion, schema, seed
├── models/            product, category, user, order
├── controllers/       (logique intégrée aux routes)
├── routes/            index, catalog, cart, auth, checkout, payments, admin
├── middleware/        auth, csrf, locals
└── services/          payment (cod/stripe/paypal), i18n, currency, cart, slugify
views/                 templates EJS (vitrine + admin)
public/                CSS + uploads produits
scripts/test.js        tests d'intégration
```

## Limites connues (production)

- **Session en mémoire** (`express-session` MemoryStore) : remplacer par un store persistant
  (`connect-sqlite3` ou Redis) pour un déploiement multi-process.
- **CSP désactivé** (helmet) pour simplifier l'admin ; à réactiver avec nonces.
- **Pas de rate-limiting** sur la connexion : ajouter `express-rate-limit` contre le brute-force.
- **Webhook PayPal non implémenté** : la confirmation se fait par capture au retour ; ajouter le
  webhook `PAYMENT.CAPTURE.COMPLETED` pour plus de robustesse.
- **SQLite** : suffisant pour un trafic modéré ; migrer vers PostgreSQL si besoin.
- **HTTPS** : à assurer via un reverse-proxy (Nginx/Caddy) en production.
