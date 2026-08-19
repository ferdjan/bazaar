# Audit technique et plan d'amélioration — Bazaar

> **Objectif :** ce document est à la fois un audit technique et un **prompt d'exécution pour Claude Code / OpenCode / DeepSeek**.  
> Il doit être utilisé comme feuille de route pour améliorer Bazaar sans casser les fonctionnalités existantes.
>
> **Dépôt :** `github.com/ferdjan/bazaar` — branche `main`  
> **Stack observée :** Node.js 22, Express 4, EJS SSR, SQLite/better-sqlite3, express-session, Stripe, PayPal, COD, FR/AR RTL.

---

## 0. Consignes générales pour l'agent

Avant toute modification :

1. Lire la structure complète du projet.
2. Identifier les fichiers concernés et leurs dépendances.
3. Ne pas réécrire inutilement l'architecture.
4. Préserver le rendu SSR EJS, le bilinguisme FR/AR, le panier, les comptes, le back-office et les trois moyens de paiement.
5. Ne jamais considérer une validation frontend comme une mesure de sécurité : toute donnée doit être validée côté serveur.
6. Ne jamais faire confiance à une référence de commande, un `ref`, un `session_id`, un token PayPal ou une donnée provenant de l'URL pour déterminer quelle commande peut être payée ou marquée comme payée.
7. Après chaque groupe de modifications, exécuter `npm test`.
8. Ajouter des tests de régression pour chaque correction de sécurité importante.
9. Ne pas supprimer une protection existante pour faire passer un test.
10. Produire à la fin un résumé : fichiers modifiés, risques corrigés, tests exécutés et éventuels points restant à traiter.

---

# 1. Critique de l'audit/prompt précédent

Le prompt précédent est globalement bon : il identifie correctement plusieurs protections déjà présentes et plusieurs durcissements utiles.

### Points correctement identifiés

- Requêtes SQL paramétrées.
- Recalcul des montants côté serveur.
- Protection CSRF.
- Hashage bcrypt.
- Protection admin centralisée.
- Contrôle de propriété sur `/commande/:ref`.
- Vérification de signature du webhook Stripe.
- Session en mémoire comme limitation de production.
- CSP actuellement désactivée.
- Rate limiting absent sur l'authentification.
- Upload contrôlé principalement par extension.
- Gestion du stock perfectible.

Ces constats sont cohérents avec le code actuel : la configuration Express désactive actuellement la CSP et utilise le cookie de session sans `secure`; l'authentification ne possède pas de rate limiter; et la protection CSRF compare actuellement directement les chaînes.  

### Corrections importantes à apporter à l'audit précédent

L'audit précédent sous-estime cependant certains risques.

#### 1. Paiements : priorité plus élevée que dans l'ancien audit

Le problème PayPal n'est pas seulement l'absence de webhook.

Le flux actuel accepte `ref` depuis l'URL puis effectue une capture PayPal et, si elle est `COMPLETED`, marque cette référence comme payée. Il faut impérativement **lier l'identité du paiement PayPal à la commande locale** avant de modifier son état.

Même problème conceptuel côté Stripe : `confirmBySession(sessionId, ref)` vérifie que la session Stripe est payée, mais doit également vérifier que `session.client_reference_id === ref` et que le montant/devise correspondent à la commande locale.

Le webhook Stripe doit lui aussi vérifier la correspondance avec la commande avant de la marquer payée.

**Conclusion : les paiements doivent être traités comme une machine d'état vérifiée côté serveur, pas comme une simple confirmation provenant du navigateur.**

#### 2. Référence de commande

Le passage de 4 à 8 octets est une bonne amélioration, mais ce n'est pas la protection principale.

La vraie protection doit être :

- ne jamais considérer le `ref` comme une preuve d'identité ;
- vérifier l'utilisateur pour les pages privées ;
- utiliser un identifiant public suffisamment aléatoire ;
- ne jamais exposer des informations sensibles sur simple connaissance d'un `ref` ;
- limiter les endpoints qui déclenchent une action de paiement.

#### 3. Validation métier insuffisante

Le checkout vérifie seulement que les champs existent. Il faut également valider :

- email ;
- téléphone ;
- longueur maximale des champs ;
- quantité ;
- identifiants produits ;
- tailles disponibles ;
- valeurs numériques ;
- méthode de paiement ;
- existence et disponibilité réelle des produits.

Les données du panier/session ne doivent pas être considérées comme fiables au moment de créer la commande.

---

# 2. 🔴 Backend — Sécurité

## 2.1 Session cookie

Dans `src/app.js` :

- ajouter `app.set('trust proxy', 1)` uniquement si l'application est réellement derrière un reverse proxy maîtrisé ;
- activer `secure` en production ;
- conserver `httpOnly`;
- conserver `sameSite: 'lax'`;
- utiliser un secret de session fort.

Exigence :

```js
cookie: {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 1000 * 60 * 60 * 24 * 30,
}
```

Ne pas utiliser aveuglément `trust proxy` si l'infrastructure ne le justifie pas.

---

## 2.2 Remplacer MemoryStore

Le `MemoryStore` actuel est adapté au développement mais pas à une exploitation durable.

Utiliser `connect-sqlite3` pour rester cohérent avec SQLite, ou Redis si l'application évolue vers plusieurs instances.

Ajouter :

- persistance ;
- rotation/expiration correcte des sessions ;
- exclusion du fichier de session du dépôt.

---

## 2.3 Régénération de session après connexion

Après une authentification réussie, régénérer l'identifiant de session afin de réduire le risque de session fixation.

Exemple de logique :

```js
req.session.regenerate((err) => {
  if (err) return next(err);

  req.session.user = {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
  };

  res.redirect(dest);
});
```

Préserver les données nécessaires comme `returnTo` avant régénération puis les restaurer explicitement.

---

## 2.4 Rate limiting

Installer `express-rate-limit`.

Créer au minimum :

- limiteur strict sur `/connexion`;
- limiteur plus permissif sur `/inscription`;
- limiteur adapté aux endpoints sensibles de paiement ;
- éventuellement limiteur global très large contre les abus.

Ne pas appliquer un limiteur tellement agressif qu'il bloque les utilisateurs normaux derrière une même IP.

---

## 2.5 CSRF

Conserver la protection CSRF.

Remplacer la comparaison directe :

```js
token !== req.session.csrf
```

par une comparaison en temps constant avec `crypto.timingSafeEqual`, après vérification de longueur.

Important :

- ne pas accepter inutilement le token CSRF dans la query string ;
- préférer le champ POST ou le header ;
- conserver l'exclusion des webhooks qui disposent d'une authentification cryptographique propre.

---

## 2.6 CSP

Réactiver progressivement la Content Security Policy.

Avant d'activer une CSP stricte :

1. identifier les scripts inline ;
2. identifier les styles inline ;
3. identifier les ressources externes ;
4. introduire des nonces pour les scripts nécessaires ;
5. ajouter `object-src 'none'`;
6. ajouter `base-uri 'self'`;
7. ajouter `frame-ancestors 'self'` ou une politique adaptée ;
8. tester toutes les pages publiques et admin.

Ne pas utiliser `unsafe-eval`.

Réduire `unsafe-inline` autant que possible.

---

## 2.7 Validation serveur centralisée

Créer un système de validation cohérent pour les entrées :

- auth ;
- checkout ;
- produits admin ;
- catégories ;
- newsletter ;
- paramètres de recherche ;
- IDs ;
- pagination.

Valider :

- type ;
- longueur ;
- format ;
- valeurs autorisées ;
- limites numériques.

Ne jamais faire confiance à `parseInt(value) || 0` pour les données métier : une entrée invalide ne doit pas silencieusement devenir `0`.

---

# 3. 🔴 Paiements — priorité maximale

## 3.1 Stripe

Dans `confirmBySession(sessionId, ref)` :

1. récupérer la session Stripe ;
2. vérifier `payment_status === 'paid'`;
3. vérifier `session.client_reference_id === ref`;
4. récupérer la commande locale ;
5. vérifier que `payment_method === 'stripe'`;
6. vérifier le montant attendu ;
7. vérifier la devise ;
8. rendre l'opération idempotente ;
9. seulement ensuite passer la commande à `paid/payee`.

Le webhook doit appliquer la même logique de vérification.

Ne jamais faire :

```js
orderModel.updatePaymentStatus(ref, 'paid');
```

uniquement parce qu'un objet Stripe indique `paid`.

---

## 3.2 PayPal

Implémenter un webhook PayPal pour `PAYMENT.CAPTURE.COMPLETED`.

Mais surtout :

- enregistrer l'identifiant de commande PayPal côté commande locale ;
- associer `providerId` à la commande ;
- lors de la capture, vérifier que le paiement correspond à la bonne commande ;
- vérifier montant et devise ;
- vérifier le statut attendu ;
- vérifier la signature du webhook ;
- rendre le traitement idempotent.

Le navigateur ne doit jamais être considéré comme l'autorité finale.

---

## 3.3 Ne pas déclencher des opérations financières importantes en GET

Les routes de paiement actuellement accessibles par GET doivent être revues.

Une route GET ne doit pas provoquer arbitrairement une nouvelle opération financière ou une capture.

Séparer :

- affichage ;
- création d'une intention/session de paiement ;
- capture ;
- confirmation serveur ;
- webhook fournisseur.

Les opérations ayant un effet financier doivent être protégées et idempotentes.

---

# 4. 🔴 Checkout et stock

Le code actuel crée la commande et décrémente le stock dans une transaction, ce qui est une bonne base.

Mais le décrément actuel :

```sql
MAX(0, stock - ?)
```

peut masquer une insuffisance de stock.

Corriger en utilisant une opération atomique ou une vérification transactionnelle qui garantit :

```sql
stock >= quantité demandée
```

Avant de créer définitivement les lignes de commande.

La logique doit :

1. relire les produits depuis la base ;
2. vérifier qu'ils sont actifs ;
3. vérifier le stock ;
4. vérifier la quantité ;
5. vérifier la taille ;
6. recalculer les prix depuis la base ;
7. recalculer le total ;
8. créer la commande ;
9. décrémenter le stock ;
10. tout faire dans une transaction.

Le prix et le nom provenant du panier/session ne doivent jamais être la source de vérité.

---

# 5. Backend — robustesse et architecture

## 5.1 Gestion des erreurs

Éviter de retourner directement :

```js
message: err.message
```

à l'utilisateur.

Les messages d'erreur internes peuvent contenir des détails sur :

- API externe ;
- configuration ;
- base de données ;
- chemins ;
- identifiants.

Afficher un message générique côté client et journaliser le détail côté serveur.

---

## 5.2 Logs

Mettre en place des logs structurés contenant au minimum :

- timestamp ;
- méthode HTTP ;
- route ;
- statut ;
- durée ;
- identifiant de requête ;
- erreur éventuelle.

Ne jamais journaliser :

- mots de passe ;
- secrets ;
- cookies ;
- tokens CSRF ;
- clés Stripe/PayPal ;
- données de paiement sensibles.

---

## 5.3 Limites HTTP

Définir explicitement des limites adaptées :

- `express.json({ limit: ... })`;
- `express.urlencoded({ limit: ... })`;
- upload maximum ;
- nombre maximum de fichiers ;
- longueur maximale des champs.

Objectif : réduire les risques de consommation excessive de ressources.

---

## 5.4 Uploads

L'upload admin utilise actuellement l'extension du nom de fichier comme filtre.

Ajouter :

- vérification du contenu réel / magic bytes ;
- MIME réel ;
- taille ;
- nom de fichier généré côté serveur ;
- suppression du fichier en cas d'échec de validation ;
- idéalement traitement/redimensionnement des images ;
- empêcher tout fichier exécutable d'être servi comme contenu actif.

Ne jamais faire confiance à `originalname`.

---

## 5.5 Dépendances

Ajouter un contrôle régulier :

```bash
npm audit
npm outdated
```

Mettre en place Dependabot ou équivalent.

Ne pas mettre à jour aveuglément toutes les dépendances en production : tester les changements majeurs.

---

# 6. 🟠 Base de données

Le schéma est globalement propre :

- contraintes `CHECK`;
- clés étrangères ;
- index utiles ;
- prix en entier DZD.

Ajouter si nécessaire :

- index sur `orders.ref` (UNIQUE le fournit déjà) ;
- index adaptés aux recherches administratives si le volume augmente ;
- migrations versionnées plutôt que modifications manuelles du schéma ;
- sauvegardes automatiques SQLite ;
- stratégie de restauration testée.

Si le trafic augmente fortement ou si plusieurs instances deviennent nécessaires, prévoir une migration vers PostgreSQL.

---

# 7. 🟠 Frontend — UX et qualité

Le choix EJS SSR est pertinent pour Bazaar : il évite une SPA inutile et reste simple à maintenir.

## 7.1 Responsive design

Vérifier toutes les pages sur :

- mobile 320–375 px ;
- mobile large ;
- tablette ;
- desktop.

Priorité :

- navigation ;
- catalogue ;
- fiche produit ;
- panier ;
- checkout ;
- admin.

---

## 7.2 FR / AR / RTL

Vérifier systématiquement :

```html
<html lang="fr" dir="ltr">
```

et :

```html
<html lang="ar" dir="rtl">
```

Ne pas utiliser uniquement `margin-left/right`.

Préférer les propriétés CSS logiques :

```css
margin-inline-start
margin-inline-end
padding-inline
inset-inline-start
```

Tester :

- boutons ;
- formulaires ;
- tableaux ;
- panier ;
- prix ;
- icônes ;
- flèches ;
- navigation ;
- messages d'erreur.

---

## 7.3 Accessibilité

Faire un audit WCAG de base :

- labels associés aux champs ;
- focus visible ;
- navigation clavier ;
- boutons réellement `<button>`;
- liens réellement `<a>`;
- `alt` pertinent pour les images ;
- contraste ;
- hiérarchie H1/H2/H3 ;
- messages d'erreur accessibles ;
- `aria-live` pour les feedbacks dynamiques ;
- taille des zones tactiles.

Ne pas utiliser ARIA lorsque HTML sémantique suffit.

---

## 7.4 Checkout

Améliorer la conversion avec :

- `type="email"`;
- `autocomplete`;
- validation téléphone ;
- messages d'erreur proches des champs ;
- conservation des données valides après erreur ;
- indication claire du moyen de paiement ;
- résumé de commande toujours visible ;
- état de chargement lors d'une action.

La validation frontend reste uniquement une amélioration UX.

---

## 7.5 Images et performances

Pour les images produits :

- `loading="lazy"` hors images critiques ;
- dimensions explicites pour éviter le layout shift ;
- formats modernes ;
- compression ;
- thumbnails si nécessaire ;
- `srcset`/responsive images si le catalogue devient important.

Éviter de charger une image originale de 5 Mo pour une miniature de catalogue.

---

# 8. 🟠 SEO

Pour les pages publiques :

- `<title>` spécifique ;
- meta description ;
- Open Graph ;
- URL canonique ;
- URLs propres ;
- données structurées Product si approprié ;
- sitemap ;
- robots.txt ;
- attributs `lang` et `dir` corrects.

Pour FR/AR, étudier `hreflang` lorsque les deux versions ont réellement des URLs distinctes.

---

# 9. 🟠 Frontend — architecture EJS

Conserver les partials EJS et éviter la duplication.

Organiser les composants réutilisables :

- header ;
- navigation ;
- footer ;
- product card ;
- flash messages ;
- form fields ;
- pagination ;
- confirmation dialogs.

Éviter d'introduire React/Vue/Next.js uniquement pour résoudre des problèmes qui peuvent être traités en SSR + JavaScript léger.

---

# 10. Tests à ajouter

Les 20 assertions actuelles constituent une bonne base, mais elles ne couvrent pas suffisamment la sécurité.

Ajouter des tests pour :

### Auth

- mauvais mot de passe ;
- compte inexistant ;
- rate limiting ;
- session renouvelée après login ;
- accès admin refusé au client.

### CSRF

- POST sans token ;
- mauvais token ;
- token correct ;
- webhook toujours accepté uniquement par sa signature.

### IDOR

- client A ne peut pas consulter la commande de B ;
- admin peut consulter ;
- utilisateur non connecté ne peut pas accéder aux pages privées.

### Paiements

- Stripe `session_id` appartenant à une autre commande ;
- montant Stripe incorrect ;
- devise incorrecte ;
- PayPal order ID ne correspondant pas à la commande ;
- webhook PayPal invalide ;
- webhook rejoué ;
- double confirmation ;
- paiement déjà `paid`.

### Stock

- commande supérieure au stock ;
- deux commandes concurrentes ;
- produit inactif ;
- quantité invalide ;
- taille invalide.

### Upload

- extension valide avec contenu invalide ;
- fichier trop volumineux ;
- MIME invalide.

### Validation

- email invalide ;
- téléphone invalide ;
- champs excessivement longs ;
- prix invalide ;
- stock invalide ;
- ID non numérique.

---

# 11. Observabilité et production

Ajouter une checklist de production :

- HTTPS ;
- variables `.env` sécurisées ;
- secret de session aléatoire ;
- mot de passe admin unique ;
- aucun secret dans Git ;
- sauvegardes SQLite ;
- restauration testée ;
- logs ;
- monitoring ;
- health check ;
- gestion des erreurs ;
- rotation des logs ;
- dépendances à jour ;
- environnement `NODE_ENV=production`.

Le README ne doit pas présenter un mot de passe admin par défaut utilisable tel quel en production.

---

# 12. Priorités finales

| Priorité | Action |
|---|---|
| 🔴 P0 | Corriger le lien entre commande locale et paiement Stripe |
| 🔴 P0 | Corriger le lien entre commande locale et paiement PayPal |
| 🔴 P0 | Ajouter vérification montant/devise/méthode avant `paid` |
| 🔴 P0 | Rendre les confirmations/webhooks idempotents |
| 🔴 P0 | Valider le stock et recalculer panier/prix côté serveur |
| 🔴 P0 | Sécuriser session cookie + secret + régénération après login |
| 🔴 P1 | Rate limiting login/inscription/paiement |
| 🔴 P1 | Validation serveur centralisée |
| 🔴 P1 | Upload par magic bytes |
| 🟠 P1 | CSP nonce-based |
| 🟠 P1 | Logs structurés + erreurs génériques |
| 🟠 P1 | Tests sécurité/IDOR/paiements |
| 🟠 P2 | Session store persistant |
| 🟠 P2 | Accessibilité WCAG |
| 🟠 P2 | RTL complet |
| 🟠 P2 | Optimisation images |
| 🟡 P2 | SEO |
| 🟡 P3 | PostgreSQL si la charge le justifie |

---

# 13. PROMPT D'EXÉCUTION POUR CLAUDE CODE

```text
Tu travailles sur le dépôt Bazaar (Node.js 22 / Express / EJS / SQLite).

Objectif :
rendre l'application plus robuste et prête pour une vraie mise en production, sans changer inutilement son architecture ni ses fonctionnalités.

IMPORTANT :
- Lis d'abord le code réellement présent.
- Ne suppose jamais qu'une protection existe : vérifie-la.
- Ne supprime aucune protection existante.
- Ne fais pas confiance aux données venant de l'URL, du navigateur, du panier/session ou d'un fournisseur de paiement sans vérification serveur.
- Après chaque groupe logique de modifications, exécute npm test.
- Ajoute des tests pour les nouveaux comportements de sécurité.

PHASE 1 — AUDIT
1. Analyse src/app.js, middleware, routes, services, modèles, DB, vues et tests.
2. Identifie les flux d'authentification, session, CSRF, checkout, stock et paiements.
3. Vérifie particulièrement les correspondances commande locale <-> Stripe <-> PayPal.

PHASE 2 — AUTH/SESSION
1. Active secure sur le cookie en production.
2. Configure trust proxy uniquement lorsque nécessaire derrière le reverse proxy.
3. Remplace MemoryStore par un store persistant adapté.
4. Régénère la session après login.
5. Ajoute express-rate-limit sur login et inscription.
6. Renforce la validation serveur.
7. Ne laisse aucun mot de passe admin par défaut exploitable en production.

PHASE 3 — CSRF/CSP
1. Conserve CSRF.
2. Utilise crypto.timingSafeEqual avec buffers de même longueur.
3. N'accepte pas inutilement le token CSRF via query string.
4. Réactive progressivement une CSP nonce-based.
5. Teste toutes les pages après activation.

PHASE 4 — CHECKOUT/STOCK
1. Recalcule le panier depuis la base.
2. Vérifie produit actif, quantité, stock, taille et prix.
3. Effectue création commande + stock dans une transaction.
4. Empêche toute vente au-delà du stock disponible.
5. Ajoute les tests correspondants.

PHASE 5 — STRIPE
1. Lors de la confirmation, vérifie :
   - session existante ;
   - payment_status = paid ;
   - client_reference_id correspondant exactement à la commande ;
   - payment_method = stripe ;
   - montant correct ;
   - devise correcte.
2. Le webhook doit appliquer les mêmes contrôles.
3. Le traitement doit être idempotent.
4. Une session Stripe valide ne doit jamais pouvoir marquer une autre commande comme payée.

PHASE 6 — PAYPAL
1. Stocke l'identifiant PayPal associé à la commande locale.
2. Lors de la capture, vérifie que l'identifiant correspond à la commande.
3. Vérifie montant et devise.
4. Ajoute le webhook PAYMENT.CAPTURE.COMPLETED.
5. Vérifie la signature du webhook.
6. Rends le webhook idempotent.
7. Une capture PayPal valide ne doit jamais pouvoir payer une autre commande locale.

PHASE 7 — UPLOAD
1. Vérifie le contenu réel du fichier, pas seulement son extension.
2. Supprime les fichiers invalides.
3. Conserve la limite de taille.
4. Empêche les fichiers dangereux d'être exécutables.

PHASE 8 — FRONTEND
1. Conserve EJS SSR.
2. Améliore responsive mobile/tablette/desktop.
3. Vérifie FR/AR et RTL.
4. Utilise CSS logical properties.
5. Améliore accessibilité clavier, labels, focus, contraste et erreurs.
6. Améliore le checkout.
7. Optimise les images et évite les layout shifts.
8. N'ajoute pas de framework frontend lourd sans nécessité.

PHASE 9 — TESTS
Ajoute des tests pour :
- auth ;
- rate limit ;
- CSRF ;
- IDOR ;
- stock ;
- validation ;
- upload ;
- Stripe mismatch ;
- PayPal mismatch ;
- webhooks invalides ;
- webhooks rejoués ;
- double paiement.

PHASE 10 — FINAL
Exécute npm test.
Si possible, exécute également npm audit.
Présente :
- fichiers modifiés ;
- corrections de sécurité ;
- améliorations frontend ;
- améliorations backend ;
- tests exécutés ;
- problèmes restant à traiter.

NE MODIFIE PAS LE COMPORTEMENT MÉTIER SANS RAISON.
NE CONSIDÈRE JAMAIS UNE REDIRECTION DU NAVIGATEUR COMME UNE PREUVE DE PAIEMENT.
```

---

## 14. Règle importante pour les prochaines évolutions

Toute nouvelle fonctionnalité doit respecter cette hiérarchie :

**Base de données → logique métier serveur → sécurité → API/paiement → rendu EJS → amélioration UX.**

Le frontend ne doit jamais devenir la source de vérité pour :

- prix ;
- stock ;
- droits ;
- statut de commande ;
- statut de paiement ;
- identité utilisateur.

