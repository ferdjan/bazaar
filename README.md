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

> ⚠️ **En production**, le démarrage **refuse** de créer un compte admin avec le mot de passe
> par défaut (`admin123`) : définis `ADMIN_PASSWORD` (mot de passe fort) dans `.env` avant le
> premier `npm run seed`. En développement uniquement, le couple `admin@example.com` /
> `admin123` est créé pour simplifier les tests.

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
npm test   # assertions d'intégration HTTP (supertest, base :memory:)
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

- **SQLite** : suffisant pour un trafic modéré ; migrer vers PostgreSQL si besoin. Le store de
  session est persisté dans SQLite (`sessions`), adapté à une instance unique.
- **HTTPS** : à assurer via un reverse-proxy (Nginx/Caddy) en production, avec `TRUST_PROXY=1`
  et `NODE_ENV=production` (active `secure` sur le cookie de session).
- **Multi-instance** : SQLite et le store de session SQLite ne conviennent pas à plusieurs
  processus partageant la même base ; passer alors à PostgreSQL + Redis.

## Sécurité (aperçu)

- Mots de passe hashés (bcrypt), régénération de session après connexion, cookie `secure` en prod.
- CSRF (comparaison en temps constant), CSP nonce-based (helmet), `nosniff`.
- Rate limiting sur connexion / inscription / paiement.
- Paiements vérifiés côté serveur : la commande locale est liée à la session Stripe / ordre PayPal
  (`provider_id`), avec contrôle du montant, de la devise et de la méthode avant tout passage à
  « payé ». Confirmations et webhooks sont idempotents.
- Stock décrémenté atomiquement (`stock >= quantité`) et recalcul du panier depuis la base.
- Uploads d'images validés par contenu réel (magic bytes), jamais par extension.
