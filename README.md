# Bazaar

Bazaar est une boutique e-commerce bilingue français/arabe (RTL), conçue pour l'Algérie. Les prix
sont affichés en dinars algériens (DZD). L'application prend en charge Stripe, PayPal et surtout le
paiement à la livraison (COD), avec étiquettes QR, comptes vendeurs, suivi des encaissements,
retours et mouvements de stock.

Stack principale : **Node.js 22, Express 4, EJS, SQLite (`better-sqlite3`)**.

## Fonctionnalités

- Catalogue, catégories, recherche FR/AR et fiches produits.
- Panier stocké en session et recalculé depuis la base avant commande.
- Comptes clients, commandes invitées et suivi public par référence + e-mail.
- Paiement COD, Stripe et PayPal.
- Back-office : tableau de bord, produits, catégories, commandes, clients et vendeurs.
- Étiquettes d'expédition imprimables avec QR sécurisé.
- Interface vendeur mobile/PWA pour scanner et confirmer un encaissement COD.
- Suivi séparé de la livraison, du paiement, des retours et du stock.
- Historique horodaté des actions avec identification de l'administrateur ou du vendeur.
- Interface français/arabe avec mise en page RTL.

## Rôles et permissions

| Rôle | Accès et responsabilités |
|---|---|
| `admin` | Gère le catalogue, les commandes, les clients, les vendeurs, les expéditions, les incidents, les retours et les étiquettes QR. |
| `seller` | Utilise uniquement l'espace `/scan`, consulte une commande via son QR et confirme l'argent COD réellement reçu. |
| `customer` | Achète, consulte son compte et ses propres commandes. |

Règles importantes :

- Un vendeur est créé uniquement par un administrateur depuis **Administration > Clients**.
- L'inscription publique crée toujours un compte `customer`.
- Un vendeur ne peut pas accéder à `/admin`.
- L'administrateur peut consulter un QR, mais son accès au scan est en lecture seule.
- Seul un utilisateur dont le rôle est exactement `seller` peut confirmer un encaissement COD.
- Stripe et PayPal sont confirmés par les fournisseurs de paiement, pas par le vendeur.

## Cycle d'une commande

### Paiement à la livraison (COD)

```text
en_attente -> expediee -> livree -> payee
```

1. La commande est créée et le stock est réservé immédiatement.
2. L'administrateur prépare l'expédition, ajoute éventuellement le transporteur et le suivi, puis
   marque la commande `expediee`.
3. L'administrateur marque la commande `livree` lorsque la livraison est confirmée.
4. Le vendeur scanne le QR après avoir reçu l'argent du client.
5. Le vendeur confirme l'encaissement : la commande passe à `payee`, `payment_status` passe à
   `paid` et `paid_at` est enregistré.

La livraison seule n'augmente jamais le chiffre d'affaires. L'encaissement est une opération
transactionnelle et idempotente : un deuxième scan ne peut pas compter deux fois la vente.

### Stripe et PayPal

```text
en_attente -> payee -> expediee -> livree
```

Le paiement est confirmé côté serveur après vérification de la référence, du fournisseur, du
montant et de la devise. Les confirmations et webhooks sont conçus pour être idempotents.

Stripe et PayPal ne prennent pas en charge le DZD. Le montant affiché reste en DZD, mais le client
est facturé en EUR selon `DZD_TO_EUR_RATE`. Le taux est enregistré indirectement dans le montant
EUR calculé au moment de la commande.

## États d'une commande

L'application sépare trois dimensions. Elles ne doivent pas être confondues lors d'une évolution.

### Progression principale : `orders.status`

| Valeur | Sens |
|---|---|
| `en_attente` | Commande créée. |
| `expediee` | Colis expédié. |
| `livree` | Colis livré, mais une COD peut encore être impayée. |
| `payee` | Paiement confirmé. Pour une COD, c'est l'étape finale. |
| `annulee` | Commande annulée. |

### Paiement : `orders.payment_status`

| Valeur | Sens |
|---|---|
| `pending` | Aucun encaissement confirmé. |
| `paid` | Argent encaissé et daté dans `paid_at`. |
| `failed` | Paiement en ligne échoué. |

Un remboursement est représenté par `refund_dzd > 0`. Dans l'interface, il est affiché comme
**Remboursée**, même si `payment_status` conserve `paid` pour garder la trace de l'encaissement
initial.

### Livraison et retours : `orders.delivery_status`

| Valeur | Sens |
|---|---|
| `pending` | Aucun incident logistique particulier. |
| `failed` | Échec de livraison. |
| `damaged` | Colis ou produit endommagé. |
| `returning` | Retour en cours de transport. |
| `returned` | Retour physiquement reçu par la boutique. |

Une commande retournée et remboursée s'affiche donc clairement ainsi :

```text
Livraison : Retour reçu
Paiement : Remboursée
```

## Stock, chiffre d'affaires et retours

### Réservation du stock

Le stock est décrémenté dans la même transaction SQLite que la création de la commande. La requête
exige `stock >= quantité`, ce qui empêche un stock négatif et annule toute la commande si un article
n'est plus disponible.

### Annulation

Une annulation faite avec l'action métier depuis `en_attente` restitue le stock. Le champ
`stock_released` empêche une deuxième restitution. Les mouvements sont enregistrés dans
`inventory_events`.

### Retour

Le stock ne revient jamais automatiquement lors d'un simple échec de livraison. Le processus est :

1. Enregistrer `Échec de livraison` ou `Retour en cours`.
2. Attendre la réception physique du colis.
3. Enregistrer `Retour reçu`.
4. Traiter le retour comme `Article revendable` ou `Article endommagé`.

| Situation | Stock vendable | Effet financier |
|---|---|---|
| Retour reçu, article revendable | Quantités réintégrées une seule fois | Aucun effet si impayé ; remboursement si déjà payé. |
| Retour reçu, article endommagé | Aucune réintégration | Remboursement si déjà payé. |
| Échec de livraison sans colis reçu | Aucun changement | Aucun chiffre d'affaires si impayé. |
| Commande livrée et encaissée | Stock reste sorti | Vente ajoutée au chiffre d'affaires. |

### Chiffre d'affaires

Le tableau de bord calcule le chiffre d'affaires net avec la règle suivante :

```text
sommes encaissées - remboursements
```

Seules les commandes avec `payment_status = paid` et non annulées sont comptées. `refund_dzd` est
soustrait du total encaissé. Une commande seulement livrée, expédiée ou en attente ne compte pas.

## Étiquettes QR et espace vendeur

### Génération par l'administrateur

Depuis la fiche d'une commande, l'administrateur clique sur **Générer et imprimer l'étiquette**.
L'étiquette contient la référence, le client, le téléphone, l'adresse, le montant COD et le QR.

Le QR contient une URL de la forme :

```text
https://domaine.example/scan/<jeton-aleatoire>
```

Le jeton possède 32 octets aléatoires. Seule son empreinte SHA-256 est stockée dans
`shipment_labels`. Une réimpression remplace le hash actif et invalide immédiatement l'ancien QR.

### Utilisation par le vendeur

1. Le vendeur ouvre `/connexion` sur son téléphone.
2. Après connexion, il est redirigé vers `/scan`.
3. Il scanne le QR ou ouvre directement son lien.
4. Il vérifie la référence, le client, l'adresse, le montant et les états.
5. Le bouton de confirmation apparaît uniquement pour une commande COD `livree`, encore `pending`
   et non remboursée.
6. Il confirme seulement après réception réelle de l'argent.

La caméra utilise `BarcodeDetector` lorsque le navigateur le permet. La saisie manuelle du jeton
reste disponible. Le manifeste Web permet d'installer l'outil comme application Web sur Android.

La caméra nécessite HTTPS, sauf sur `localhost`. En production, `BASE_URL` doit être l'URL HTTPS
publique exacte. Un QR créé avec `http://localhost:3000` ne fonctionnera pas depuis un téléphone,
car `localhost` désignera le téléphone lui-même.

## Installation locale

Prérequis : Node.js 22 et npm.

```bash
npm install
cp .env.example .env
npm run seed
npm run dev
```

Sous Windows, créer `.env` à partir de `.env.example` avec l'outil habituel si `cp` n'est pas
disponible. L'application est servie par défaut sur <http://localhost:3000>.

Le serveur appelle également le seed au démarrage. Le seed et les migrations sont idempotents.

### Compte administrateur de développement

| Champ | Valeur |
|---|---|
| E-mail | `admin@example.com` |
| Mot de passe | `admin123` |

Ce compte est réservé au développement. En production, l'application refuse de démarrer si
`ADMIN_PASSWORD` est absent, égal à `admin123` ou contient moins de 12 caractères.

## Configuration

| Variable | Usage |
|---|---|
| `NODE_ENV` | Utiliser `production` en production. |
| `PORT` | Port HTTP, `3000` par défaut. |
| `BASE_URL` | URL publique complète utilisée par les QR, e-mails et retours de paiement. HTTPS obligatoire en production. |
| `SESSION_SECRET` | Secret de session ; au moins 32 caractères en production. |
| `TRUST_PROXY` | `1` uniquement derrière un reverse proxy maîtrisé comme Render. |
| `ADMIN_EMAIL` | E-mail du compte admin créé au premier seed. |
| `ADMIN_PASSWORD` | Mot de passe admin initial. Fort et unique en production. |
| `DB_PATH` | Chemin de la base SQLite ; `./data.db` par défaut. |
| `DELIVERY_FEE_DZD` | Frais de livraison forfaitaires, `600` par défaut. |
| `DZD_TO_EUR_RATE` | Conversion d'un DZD vers l'EUR pour Stripe/PayPal. |
| `STRIPE_SECRET_KEY` | Clé serveur Stripe. |
| `STRIPE_PUBLIC_KEY` | Clé publique Stripe. |
| `STRIPE_WEBHOOK_SECRET` | Secret de signature du webhook Stripe. |
| `PAYPAL_CLIENT_ID` | Identifiant API PayPal. |
| `PAYPAL_CLIENT_SECRET` | Secret API PayPal. |
| `PAYPAL_MODE` | `sandbox` ou `live`. |
| `PAYPAL_WEBHOOK_ID` | Identifiant du webhook PayPal. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Connexion SMTP pour les e-mails. |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Identifiants et expéditeur SMTP. |
| `RESET_TOKEN_TTL_HOURS` | Durée de validité d'un lien de réinitialisation. |
| `RATE_LIMIT_*` | Surcharge optionnelle des limites de requêtes. |

En production, la validation de configuration exige au minimum :

```text
SESSION_SECRET valide
BASE_URL en HTTPS
ADMIN_PASSWORD fort
```

## Base de données

Tables métier principales :

| Table | Responsabilité |
|---|---|
| `users` | Comptes `admin`, `seller` et `customer`. |
| `categories` | Catégories bilingues. |
| `products` | Catalogue, prix DZD, stock, tailles et images. |
| `orders` | Commandes, paiement, livraison, retour et coordonnées client. |
| `order_items` | Lignes figées de chaque commande. |
| `order_status_history` | Audit des changements avec acteur et date. |
| `shipment_labels` | Hash du QR actif par commande. |
| `inventory_events` | Restitutions et mouvements de stock liés aux commandes. |
| `sessions` | Sessions Express persistées dans SQLite. |
| `newsletter` | Abonnements à la newsletter. |

Les migrations légères sont exécutées par `src/db/connection.js`. Une migration existante élargit
notamment les anciens rôles `admin/customer` vers `admin/seller/customer` sans changer les IDs.

## Routes principales

| Route | Accès | Usage |
|---|---|---|
| `/`, `/catalogue`, `/produit/:slug` | Public | Vitrine et catalogue. |
| `/panier` | Public/session | Gestion du panier. |
| `/commande` | Client ou invité | Checkout. |
| `/suivi` | Public | Suivi par référence + e-mail. |
| `/connexion`, `/inscription` | Public | Authentification client/admin/vendeur. |
| `/compte` | Client | Commandes du compte. |
| `/admin` | Admin | Tableau de bord. |
| `/admin/commandes/:ref` | Admin | Gestion d'une commande, retour et QR. |
| `/admin/clients` | Admin | Clients et création de vendeurs. |
| `/scan` | Vendeur ou admin en lecture | Accueil du scanner. |
| `/scan/:token` | Vendeur ou admin en lecture | Commande liée au QR. |
| `/scan/payer` | Vendeur uniquement côté métier | Confirmation transactionnelle COD. |
| `/webhooks/stripe`, `/webhooks/paypal` | Fournisseur signé | Confirmation des paiements en ligne. |

## Structure du projet

```text
src/
  app.js                      configuration Express et montage des routes
  server.js                   point d'entrée et arrêt propre
  config.js                   variables d'environnement et validation prod
  db/
    connection.js             connexion SQLite et migrations
    schema.sql                schéma d'une base neuve
    seed.js                   admin, catégories et produits d'exemple
  middleware/                 auth, CSRF, variables de vues, rate limiting
  models/                     accès aux utilisateurs, produits et commandes
  routes/                     vitrine, auth, checkout, paiements, admin, scan
  services/
    payment/                  COD, Stripe et PayPal
    shipmentLabel.js          jetons et QR d'expédition
    cart.js                   recalcul et validation serveur du panier
    orderStatus.js            étapes et timeline des commandes
views/
  pages/                      interface client et scan vendeur
  admin/                      back-office et étiquette imprimable
  partials/                   composants EJS partagés
public/
  css/style.css               styles globaux et responsive
  js/scanner.js               caméra QR côté navigateur
  manifest.webmanifest        installation PWA
  uploads/                    images ajoutées par l'admin
scripts/test.js               tests HTTP et métier sur SQLite en mémoire
```

La logique de contrôle est actuellement intégrée aux routes et aux modèles ; il n'existe pas de
dossier `controllers` utilisé.

## Tests et vérification

```bash
npm test
npm audit --omit=dev
```

La suite utilise Supertest et une base SQLite `:memory:`. Au dernier passage documenté, elle compte
**153 assertions** couvrant notamment :

- inscription, connexion et contrôle des rôles ;
- CSRF, rate limiting et contrôle d'accès ;
- création atomique de commande et stock insuffisant ;
- paiement Stripe/PayPal vérifié ;
- parcours COD expédition, livraison et encaissement vendeur ;
- refus d'encaissement COD par l'administrateur ;
- QR hashé, réimpression et révocation de l'ancien QR ;
- retour revendable, restitution unique du stock et remboursement ;
- suivi public sans fuite entre clients ;
- réinitialisation de mot de passe et invalidation des sessions ;
- validation réelle du contenu des images uploadées.

## Sécurité

- Mots de passe hashés avec bcrypt.
- Régénération de session après connexion et cookie `HttpOnly`, `SameSite=Lax`, `Secure` en prod.
- Sessions persistées dans SQLite et limitées à 24 heures.
- CSRF global avec comparaison en temps constant.
- Helmet, CSP avec nonce, compression et limites de taille des corps.
- Rate limiting global et renforcé sur les routes sensibles.
- Requêtes SQLite préparées et transactions pour le stock et l'encaissement COD.
- Vérification Stripe/PayPal côté serveur, avec montant, devise, méthode et identifiant fournisseur.
- Jetons QR et reset stockés sous forme de hash SHA-256.
- Images validées par magic bytes et nommées côté serveur.
- Messages d'erreur génériques côté client et détails journalisés côté serveur.

## Déploiement et limites de production

Le fichier `render.yaml` configure un service Render Node.js. Avant ouverture publique :

1. Définir `NODE_ENV=production`, `BASE_URL`, `SESSION_SECRET` et un `ADMIN_PASSWORD` fort.
2. Vérifier que `BASE_URL` correspond exactement au domaine HTTPS final avant d'imprimer des QR.
3. Configurer les clés et webhooks Stripe/PayPal uniquement lorsque les paiements sont prêts.
4. Configurer SMTP si la réinitialisation par e-mail doit fonctionner.
5. Tester un parcours COD complet avec un vrai téléphone et un compte vendeur.

SQLite, les sessions et `public/uploads` sont écrits sur le système de fichiers local. Sur Render,
ce stockage est éphémère sans disque persistant. Sans persistance, un redéploiement peut supprimer
les comptes, commandes, QR, sessions et images ajoutées.

Pour une instance unique et un trafic modéré, utiliser un disque persistant et des sauvegardes
testées. Pour plusieurs instances ou une montée en charge, migrer vers PostgreSQL, Redis pour les
sessions et un stockage objet pour les images.

## Règles à préserver lors des prochaines modifications

1. Une commande COD livrée n'est pas forcément payée.
2. Seul un vendeur authentifié confirme un encaissement COD via le QR.
3. L'administrateur gère la logistique et les retours, mais ne confirme pas l'argent COD.
4. Le stock est réservé à la commande et restitué uniquement après annulation admissible ou retour
   physiquement reçu et revendable.
5. Un article endommagé ne retourne jamais dans le stock vendable.
6. Un retour payé conserve l'encaissement historique et ajoute un remboursement distinct.
7. Le chiffre d'affaires est net des remboursements et exclut les commandes impayées ou annulées.
8. Toute opération sensible doit rester transactionnelle, idempotente, autorisée et historisée.
9. Un nouveau QR invalide l'ancien ; aucun jeton brut ne doit être stocké en base.
10. Toute évolution des règles ci-dessus doit mettre à jour les tests et ce README dans le même
    changement.
