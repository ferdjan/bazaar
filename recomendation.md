# Recommandations et plan de travail - Bazaar

## 1. Objectif du document

Ce document présente les résultats de la revue technique du projet Bazaar et propose un plan de
travail détaillé pour améliorer sa sécurité, sa fiabilité métier, son architecture et son aptitude à
être déployé en production.

L'audit porte sur l'état du dépôt au 31 août 2026. Les vérifications suivantes ont été exécutées :

- installation des dépendances avec `npm ci` ;
- exécution de `npm test` : 182 assertions réussies ;
- exécution de `npm audit --omit=dev` : aucune vulnérabilité connue détectée ;
- revue des routes, modèles, services, vues, paiements, sessions, uploads et fichiers de déploiement.

La réussite des tests et de l'audit npm est positive, mais elle ne garantit pas à elle seule la
cohérence des règles commerciales. Les risques principaux concernent actuellement les transitions
de commande, la confirmation des paiements, les remboursements et la persistance des données.

## 2. Résumé exécutif

Bazaar possède une bonne base technique : structure lisible, requêtes SQL préparées, protection
CSRF, sessions sécurisées, stock réservé dans une transaction, contrôle des rôles, jetons sensibles
hachés et suite de tests déjà importante.

Une mise en production commerciale n'est toutefois pas recommandée avant la correction des quatre
points suivants :

1. Une commande Stripe ou PayPal encore impayée peut être considérée comme payée après un changement
   manuel vers un statut logistique situé après `payee`.
2. Une commande payée peut être annulée localement sans remboursement réel et disparaître du chiffre
   d'affaires.
3. Les différents chemins d'annulation ne restituent pas toujours le stock de la même manière.
4. Le déploiement Render Free utilise un système de fichiers éphémère pour SQLite, les sessions et
   les images.

La priorité doit donc être donnée aux invariants financiers et de stock avant l'ajout de nouvelles
fonctionnalités.

## 3. Points positifs à préserver

- Requêtes SQLite préparées et paramétrées.
- Création de commande et décrément du stock dans une transaction.
- Condition SQL `stock >= quantité`, empêchant un stock négatif.
- Protection CSRF globale.
- Helmet, politique CSP et limites de taille des requêtes.
- Cookies de session `HttpOnly`, `SameSite=Lax` et `Secure` en production.
- Régénération de la session après authentification.
- Contrôle distinct des rôles `admin`, `seller` et `customer`.
- Confirmation COD limitée au vendeur authentifié.
- Vérification serveur du montant, de la devise et de la référence des paiements.
- Jetons de réinitialisation et QR stockés sous forme de hash SHA-256.
- Révocation de l'ancien QR lors d'une réimpression.
- Références de commande publiques suffisamment difficiles à deviner.
- Historique des changements de statut avec identification de l'acteur.
- Documentation métier détaillée dans le README.
- Suite de tests couvrant déjà de nombreux parcours critiques.

## 4. Constats prioritaires

### P0.1 - Contournement indirect de la confirmation Stripe ou PayPal

**Sévérité : critique**

Fichiers concernés :

- `src/models/order.js:263-291`
- `src/routes/admin.js:247-261`

`setStatus()` interdit de sélectionner directement `payee`, mais positionne automatiquement
`payment_status = 'paid'` quand le statut demandé se situe après `payee` dans le parcours de la
commande.

Pour Stripe et PayPal, le parcours est :

```text
en_attente -> payee -> expediee -> livree
```

Une commande en ligne encore `pending` peut donc être envoyée directement vers `expediee` ou
`livree`, puis être considérée comme payée sans confirmation du fournisseur.

**Correction recommandée :**

- ne jamais modifier `payment_status` depuis une opération logistique ;
- réserver `markPaid()` aux webhooks ou confirmations fournisseur vérifiées ;
- refuser l'expédition d'une commande Stripe ou PayPal tant que `payment_status != 'paid'` ;
- remplacer les changements génériques de statut par des opérations métier explicites ;
- ajouter des tests modèle et HTTP pour chaque tentative de contournement.

**Critères d'acceptation :**

- une commande Stripe `pending` ne peut pas passer à `expediee` ou `livree` ;
- une commande PayPal `pending` ne peut pas passer à `expediee` ou `livree` ;
- seul un événement fournisseur vérifié peut marquer un paiement en ligne comme encaissé ;
- aucune action logistique ne modifie `payment_status`.

### P0.2 - Annulation d'une commande payée sans remboursement réel

**Sévérité : critique**

Fichiers concernés :

- `src/models/order.js:253-260`
- `src/models/order.js:326-334`
- `src/routes/admin.js:247-261`

La branche d'annulation ne vérifie ni le statut de paiement, ni la méthode, ni l'existence d'un
remboursement. Par ailleurs, le chiffre d'affaires exclut les commandes annulées. Une vente
encaissée peut donc disparaître du reporting sans que le client ait été remboursé.

**Correction recommandée :**

- autoriser l'annulation simple uniquement avant paiement et avant expédition ;
- interdire `annulee` sur une commande payée sans opération de remboursement ;
- créer un workflow de remboursement distinct ;
- stocker le fournisseur, l'identifiant externe, le montant, la devise, le statut et la date du
  remboursement ;
- calculer le chiffre d'affaires depuis les encaissements et remboursements réels.

**Critères d'acceptation :**

- une commande payée ne peut pas être annulée directement ;
- un remboursement en échec ne produit pas l'état « remboursée » ;
- une commande remboursée conserve la trace de son encaissement initial ;
- le chiffre d'affaires net est égal aux encaissements confirmés moins les remboursements confirmés.

### P0.3 - Annulations incohérentes et stock non restitué

**Sévérité : élevée**

Fichiers concernés :

- `src/models/order.js:298-319`
- `src/routes/admin.js:232-261`

L'action métier `/action` peut restituer le stock, tandis que la route `/statut` appelle directement
`setStatus()` et ne le restitue pas. Deux annulations identiques peuvent donc produire des résultats
différents.

**Correction recommandée :**

- centraliser l'annulation dans `cancelOrder(ref, actor)` ;
- exécuter dans une seule transaction la validation, l'annulation, la restitution de stock,
  l'événement d'inventaire et l'historique ;
- supprimer l'annulation du changement générique de statut ;
- garantir l'idempotence avec `stock_released` et une condition SQL.

**Critères d'acceptation :**

- toute annulation admissible restitue le stock exactement une fois ;
- aucun autre chemin ne peut positionner directement `status = 'annulee'` ;
- chaque restitution crée un événement d'inventaire ;
- une seconde tentative d'annulation n'a aucun effet financier ou de stock.

### P0.4 - Stockage de production éphémère

**Sévérité : critique en production**

Fichiers concernés :

- `render.yaml:7`
- `src/db/connection.js`
- `src/services/sessionStore.js`
- `src/services/image.js`

Render Free ne garantit pas la persistance du système de fichiers. Un redéploiement peut supprimer
les commandes, comptes, sessions, images, coupons, avis et données de suivi.

**Correction recommandée :**

- migrer les données vers PostgreSQL ;
- stocker les sessions et compteurs de rate limiting dans Redis ;
- stocker les images dans un service S3-compatible ;
- mettre en place des sauvegardes automatiques hors instance ;
- documenter et tester une procédure de restauration.

**Solution temporaire acceptable :**

- utiliser un disque persistant pour SQLite et les uploads ;
- automatiser une sauvegarde quotidienne vers un stockage externe ;
- tester l'intégrité et la restauration de la base avant ouverture publique.

## 5. Constats importants

### P1.1 - Machine à états trop permissive

Fichier concerné : `src/models/order.js:244-295`

`setStatus()` vérifie la présence du statut dans une liste, mais pas la validité de la transition
depuis l'état courant. Des étapes peuvent être sautées ou inversées. Le test situé dans
`scripts/test.js:617` considère actuellement qu'une régression de `payee` vers `livree` doit remettre
le paiement à `pending`. Cette règle doit être supprimée : une modification logistique ne doit jamais
annuler un paiement réellement encaissé.

**Recommandation :** définir des transitions explicites selon la méthode de paiement et refuser les
régressions par défaut.

### P1.2 - Capture PayPal déclenchée par GET

Fichier concerné : `src/routes/payments.js:85-105`

La route GET de succès PayPal appelle `captureAndVerify()`. Une navigation GET ne doit pas déclencher
d'effet financier.

**Recommandation :** utiliser le webhook signé comme source principale. La route de retour doit
seulement afficher l'état courant. Toute synchronisation de secours doit être authentifiée,
idempotente et séparée de la navigation GET.

### P1.3 - Contrôle d'accès incomplet sur les retours de paiement

Fichier concerné : `src/routes/payments.js:62-111`

Les routes de succès et d'annulation n'appellent pas `canAccessPayment()`. Elles peuvent afficher des
informations sur une commande à partir de sa référence.

**Recommandation :** exiger le propriétaire, la session ayant créé la commande ou une preuve de
retour robuste. À défaut, afficher une confirmation générique puis rediriger vers le suivi par
référence et e-mail.

### P1.4 - Vérification PayPal incomplète

Fichier concerné : `src/services/payment/paypal.js:77-95`

La vérification utilise uniquement la première `purchase_unit` et ne vérifie pas strictement toutes
les propriétés immuables du paiement.

**Recommandation :** vérifier notamment :

- `result.id === order.provider_id` ;
- `purchase_units.length === 1` ;
- `reference_id`, `custom_id` et `invoice_id` ;
- le statut et le montant de la capture réelle ;
- la devise et le montant stocké lors de la création de commande.

### P1.5 - Absence de déduplication persistante des webhooks

L'idempotence de `markPaid()` est positive, mais aucun identifiant d'événement Stripe ou PayPal n'est
stocké.

**Recommandation :** ajouter une table `payment_events` avec une contrainte unique sur
`(provider, event_id)`. L'insertion de l'événement et la mise à jour de la commande doivent appartenir
à la même transaction.

### P1.6 - Jeton de réinitialisation non consommé atomiquement

Fichiers concernés :

- `src/routes/auth.js:119-135`
- `src/models/user.js:69-79`

La lecture du jeton et son invalidation sont séparées. Deux requêtes concurrentes pourraient valider
le même jeton avant la première mise à jour.

**Recommandation :** consommer le jeton avec un `UPDATE` conditionnel vérifiant simultanément son
hash et son expiration, puis exiger `changes === 1`.

### P1.7 - Montant de paiement recalculé avec le taux courant

Le montant EUR est recalculé depuis `total_dzd` pendant le paiement. Une modification de
`DZD_TO_EUR_RATE` peut produire une différence entre la création, la tentative de paiement et la
confirmation.

**Recommandation :** stocker une fois pour toutes :

```text
payment_currency
payment_amount_minor
exchange_rate
```

Stripe, PayPal et les webhooks doivent utiliser ces valeurs persistées sans recalcul.

## 6. Améliorations de robustesse

### P2.1 - Contraintes SQL métier

Ajouter des contraintes et migrations pour garantir au minimum :

```sql
CHECK (total_dzd >= 0)
CHECK (delivery_dzd >= 0)
CHECK (discount_dzd >= 0)
CHECK (refund_dzd >= 0 AND refund_dzd <= total_dzd)
CHECK (qty > 0)
CHECK (price_dzd >= 0)
CHECK (delivery_status IN ('pending', 'failed', 'damaged', 'returning', 'returned'))
```

Les migrations doivent être versionnées dans une table `schema_migrations` et exécutées de manière
transactionnelle.

### P2.2 - Validation transactionnelle des coupons

La réservation SQL vérifie l'activité et le nombre d'utilisations, mais pas toutes les règles du
coupon. Le modèle de commande ne doit pas faire confiance à une remise calculée par l'appelant.

**Recommandation :** recalculer le coupon dans la transaction de création et vérifier l'expiration,
le minimum d'achat, la limite d'usage, le type et le montant final.

### P2.3 - Validation réelle des images

Fichier concerné : `src/services/image.js`

Les magic bytes évitent les extensions falsifiées mais ne prouvent pas que l'image est décodable.

**Recommandation :** utiliser `sharp` pour décoder, limiter les dimensions, supprimer les métadonnées
et réencoder vers un format contrôlé.

### P2.4 - Cohérence entre fichiers et base de données

Les images sont écrites avant la confirmation de l'opération SQL. Une erreur peut laisser un fichier
orphelin ou supprimer trop tôt une ancienne image.

**Recommandation :** écrire vers un fichier temporaire, confirmer la transaction SQL, déplacer le
nouveau fichier puis supprimer l'ancien. Ajouter une tâche périodique de détection des fichiers non
référencés.

### P2.5 - CSP et événements JavaScript inline

Fichiers concernés :

- `views/admin/order.ejs:50`
- `views/admin/label.ejs:22`

La CSP interdit les scripts inline alors que ces vues utilisent `onsubmit` et `onclick`.

**Recommandation :** remplacer ces attributs par un fichier JavaScript chargé depuis `public/js` et
des appels à `addEventListener()`.

### P2.6 - Redirections basées sur `Referer`

Certaines routes redirigent directement vers le header `Referer`, contrôlé par le client.

**Recommandation :** utiliser des destinations fixes ou n'accepter que les URLs appartenant à
l'origine configurée dans `BASE_URL`.

### P2.7 - Politique de mots de passe

La longueur minimale actuelle de six caractères est insuffisante pour les comptes privilégiés.

**Recommandation :**

- minimum 12 caractères pour les administrateurs et vendeurs ;
- minimum 10 à 12 caractères pour les clients ;
- changement de mot de passe depuis le compte ;
- invalidation des autres sessions après changement ;
- MFA pour l'administration avant une exploitation commerciale importante.

### P2.8 - SDK PayPal déprécié

`@paypal/checkout-server-sdk@1.0.3` n'est plus maintenu.

**Recommandation :** migrer vers `@paypal/paypal-server-sdk` après stabilisation du workflow de
paiement et ajouter des tests d'intégration avant le remplacement.

## 7. Architecture cible recommandée

La logique critique est actuellement distribuée entre les routes, le modèle `order` et les services
de paiement. Une couche métier légère réduirait les divergences sans nécessiter une réécriture.

Structure suggérée :

```text
src/services/orders.js
src/services/payments.js
src/services/refunds.js
src/services/inventory.js
```

Opérations métier suggérées :

```text
createOrder()
shipOrder()
deliverOrder()
cancelUnpaidOrder()
confirmOnlinePayment()
confirmCodPayment()
recordDeliveryIssue()
receiveReturn()
refundOrder()
```

Chaque opération sensible doit être :

- autorisée selon le rôle ;
- transactionnelle ;
- idempotente ;
- historisée ;
- testée selon la méthode de paiement ;
- incapable de modifier implicitement un autre domaine métier.

Les routes doivent seulement valider la requête, vérifier l'accès, appeler le service métier puis
produire la réponse HTTP.

## 8. Plan de travail détaillé

### Phase 0 - Préparation et filet de sécurité

**Durée indicative : 0,5 à 1 jour**

1. Créer une branche dédiée aux corrections métier.
2. Documenter les invariants actuels de commande, paiement, stock et retour.
3. Ajouter des fixtures permettant de créer rapidement des commandes COD, Stripe et PayPal.
4. Ajouter les tests qui reproduisent les défauts critiques avant de modifier le code.
5. Conserver une sauvegarde de la base de développement utilisée pour les essais.

**Livrables :**

- tests rouges reproduisant les contournements ;
- tableau des transitions autorisées ;
- scénarios de référence pour chaque méthode de paiement.

### Phase 1 - Sécurisation des transitions de commande

**Priorité : P0**
**Durée indicative : 2 à 4 jours**

1. Définir les transitions autorisées pour COD et paiements en ligne.
2. Retirer toute modification de `payment_status` depuis `setStatus()`.
3. Remplacer les appels génériques par `shipOrder()` et `deliverOrder()`.
4. Refuser l'expédition en ligne avant paiement confirmé.
5. Refuser les régressions de statut et la réactivation d'une commande annulée.
6. Centraliser l'annulation dans `cancelUnpaidOrder()`.
7. Effectuer annulation, restitution de stock et historique dans une transaction unique.
8. Adapter l'interface admin pour ne proposer que les actions réellement admissibles.
9. Mettre à jour les traductions et messages d'erreur.
10. Mettre à jour le README avec la machine à états finale.

**Tests obligatoires :**

- Stripe `pending -> expediee` refusé ;
- PayPal `pending -> livree` refusé ;
- COD `en_attente -> expediee -> livree` accepté ;
- COD `livree -> payee` accepté uniquement par un vendeur ;
- commande payée ne redevient jamais `pending` via une action logistique ;
- annulation en attente restitue le stock une seule fois ;
- commande annulée ne peut pas être réactivée.

**Critère de sortie :** aucun formulaire admin ne peut modifier implicitement un état financier.

### Phase 2 - Paiements, événements et remboursements

**Priorité : P0/P1**
**Durée indicative : 4 à 7 jours**

1. Créer une table `payment_events` pour dédupliquer les webhooks.
2. Créer une table `refunds` ou `payment_transactions` pour tracer les remboursements.
3. Enregistrer le montant et la devise de paiement au moment de la commande.
4. Utiliser les montants persistés dans Stripe, PayPal et les webhooks.
5. Retirer la capture PayPal de la route GET de succès.
6. Faire des webhooks signés la source de vérité principale.
7. Renforcer la vérification des identifiants et unités PayPal.
8. Implémenter les remboursements Stripe et PayPal avec idempotence.
9. Définir le processus manuel et la preuve attendue pour un remboursement COD.
10. Recalculer le chiffre d'affaires depuis les paiements et remboursements confirmés.
11. Protéger les pages de retour avec le même contrôle d'accès que les pages de paiement.
12. Ajouter des journaux structurés sans données sensibles.

**Tests obligatoires :**

- webhook valide, invalide et dupliqué ;
- mauvais montant, mauvaise devise et mauvais identifiant fournisseur ;
- retour GET sans capture financière ;
- remboursement réussi, échoué et dupliqué ;
- annulation payée sans remboursement refusée ;
- chiffre d'affaires net cohérent après remboursement.

**Critère de sortie :** toute valeur `paid` ou `refunded` correspond à une opération vérifiable et
historisée.

### Phase 3 - Persistance et exploitation en production

**Priorité : P0 avant lancement**
**Durée indicative : 3 à 8 jours selon la stratégie**

Option recommandée :

1. Provisionner PostgreSQL.
2. Adapter la couche de données et les migrations.
3. Migrer les données SQLite existantes avec un script vérifiable.
4. Provisionner Redis pour les sessions et le rate limiting.
5. Configurer un stockage objet pour les images.
6. Ajouter des sauvegardes quotidiennes automatiques.
7. Définir la durée de rétention et le chiffrement des sauvegardes.
8. Tester une restauration complète dans un environnement séparé.
9. Ajouter une surveillance du serveur, de la base, des webhooks et des sauvegardes.
10. Mettre à jour `render.yaml` et la documentation de déploiement.

Option temporaire :

1. Ajouter un disque persistant Render.
2. Placer SQLite et les uploads sur ce disque.
3. Copier quotidiennement une sauvegarde vers un stockage externe.
4. Ajouter un test d'intégrité SQLite automatisé.
5. Vérifier la restauration avant toute ouverture commerciale.

**Critère de sortie :** un redéploiement ou remplacement d'instance ne provoque aucune perte de
données métier.

### Phase 4 - Authentification et contrôle d'accès

**Priorité : P1**
**Durée indicative : 2 à 3 jours**

1. Rendre la consommation du jeton de reset atomique.
2. Renforcer la longueur minimale des mots de passe.
3. Ajouter le changement de mot de passe depuis le compte.
4. Invalider les autres sessions après changement ou reset.
5. Ajouter un rate limit partagé via Redis.
6. Appliquer les contrôles d'accès aux retours de paiement.
7. Ajouter une MFA pour les administrateurs si le projet traite de vraies commandes.
8. Ajouter des événements d'audit pour les changements de mot de passe et rôles.

**Tests obligatoires :**

- deux POST concurrents avec le même jeton : un seul succès ;
- jeton expiré ou déjà utilisé refusé ;
- sessions précédentes invalidées ;
- retour paiement inaccessible à un autre client ;
- protections de rôle admin et vendeur maintenues.

### Phase 5 - Données, coupons et uploads

**Priorité : P2**
**Durée indicative : 3 à 5 jours**

1. Ajouter les contraintes SQL et migrations versionnées.
2. Déplacer le calcul final des coupons dans la transaction de commande.
3. Vérifier l'expiration et le minimum d'achat lors de la réservation SQL.
4. Ajouter `sharp` et réencoder les images uploadées.
5. Limiter les dimensions et retirer les métadonnées.
6. Rendre l'écriture des fichiers cohérente avec la transaction SQL.
7. Créer un outil de détection et suppression contrôlée des fichiers orphelins.
8. Normaliser les numéros de téléphone avant stockage.

**Tests obligatoires :**

- coupon expirant pendant la commande ;
- deux commandes concurrentes utilisant le dernier coupon ;
- image tronquée, polyglotte ou de dimensions excessives ;
- échec SQL après upload sans fichier orphelin ;
- contraintes SQL refusant montants ou quantités invalides.

### Phase 6 - Interface, CSP et expérience utilisateur

**Priorité : P2**
**Durée indicative : 2 à 4 jours**

1. Supprimer `onclick` et `onsubmit` des vues.
2. Déplacer les comportements dans des fichiers JavaScript externes.
3. Ajouter des tests Playwright sur les parcours principaux.
4. Tester l'interface en français, arabe et RTL.
5. Tester le checkout sur mobile et petits écrans.
6. Vérifier le scanner QR sur un vrai appareil HTTPS.
7. Améliorer les états de chargement et messages d'erreur de paiement.
8. Vérifier l'accessibilité clavier, les labels et le contraste.
9. Remplacer les redirections `Referer` par des destinations internes sûres.

**Parcours navigateur à automatiser :**

- inscription, connexion et déconnexion ;
- ajout au panier, coupon et checkout COD ;
- paiement en ligne en mode sandbox ;
- impression d'une étiquette ;
- confirmation d'annulation ;
- navigation catalogue et galerie produit ;
- administration mobile ;
- affichage RTL.

### Phase 7 - Maintenance et observabilité

**Priorité : P2/P3**
**Durée indicative : 2 à 3 jours**

1. Migrer vers le SDK PayPal maintenu.
2. Ajouter un lint et un formateur dans les scripts npm.
3. Mettre en place une CI exécutant installation, tests et audit.
4. Ajouter des identifiants de corrélation aux événements métier.
5. Surveiller les erreurs, latences, webhooks rejetés et paiements en attente.
6. Définir des alertes pour les sauvegardes, stocks négatifs et incohérences de paiement.
7. Documenter les procédures d'incident et de restauration.
8. Planifier les mises à jour de dépendances.

## 9. Matrice de priorité

| Élément | Priorité | Risque actuel | Effort estimé |
|---|---:|---:|---:|
| Machine à états et contournement du paiement | P0 | Critique | Moyen |
| Annulation, stock et remboursement | P0 | Critique | Moyen à élevé |
| Stockage persistant de production | P0 | Critique | Moyen à élevé |
| Webhooks et déduplication | P1 | Élevé | Moyen |
| Capture PayPal par GET | P1 | Élevé | Faible à moyen |
| Reset atomique | P1 | Élevé | Faible |
| Montant EUR figé | P1 | Moyen à élevé | Moyen |
| Contraintes SQL et migrations | P2 | Moyen | Moyen |
| Validation et stockage des images | P2 | Moyen | Moyen |
| CSP et JavaScript inline | P2 | Moyen | Faible |
| Politique de mots de passe et MFA | P2 | Moyen | Moyen |
| Migration du SDK PayPal | P2 | Moyen | Moyen |
| Tests navigateur et observabilité | P2 | Moyen | Moyen |

## 10. Checklist avant mise en production

- [ ] Aucun changement logistique ne peut confirmer ou annuler un paiement.
- [ ] Les transitions de commande sont explicites et testées.
- [ ] Les commandes payées ne peuvent pas être annulées sans remboursement confirmé.
- [ ] Les annulations admissibles restituent le stock exactement une fois.
- [ ] Les remboursements Stripe et PayPal sont vérifiés et historisés.
- [ ] Les webhooks sont signés, idempotents et dédupliqués par identifiant d'événement.
- [ ] Les routes GET de retour n'effectuent aucune capture financière.
- [ ] Les montants de paiement et taux de conversion sont figés à la commande.
- [ ] La base, les sessions et les images utilisent un stockage persistant.
- [ ] Les sauvegardes sont automatiques, externes et restaurables.
- [ ] Le jeton de reset est consommé atomiquement.
- [ ] Les comptes admin et vendeur utilisent des mots de passe forts.
- [ ] Les contraintes SQL empêchent les montants, quantités et états invalides.
- [ ] Les images sont décodées, limitées et réencodées côté serveur.
- [ ] La CSP ne bloque aucune fonctionnalité nécessaire.
- [ ] Les parcours critiques sont testés dans un vrai navigateur.
- [ ] Les paiements Stripe et PayPal sont testés en environnement sandbox.
- [ ] Un parcours COD complet est testé avec un vendeur et un vrai téléphone.
- [ ] Les erreurs et webhooks rejetés sont surveillés.
- [ ] La procédure de restauration a été testée avec succès.

## 11. Ordre recommandé d'exécution

1. Écrire les tests reproduisant les défauts critiques.
2. Corriger la machine à états et séparer paiement et logistique.
3. Unifier l'annulation et la restitution du stock.
4. Créer le workflow réel de remboursement.
5. Retirer les effets financiers des routes GET.
6. Dédupliquer les webhooks et figer le montant de paiement.
7. Sécuriser la persistance des données de production.
8. Rendre le reset de mot de passe atomique.
9. Renforcer les contraintes SQL, coupons et uploads.
10. Corriger la CSP et ajouter les tests navigateur.
11. Migrer le SDK PayPal et mettre en place la CI et l'observabilité.

## 12. Conclusion

Le projet est plus avancé et mieux protégé qu'un prototype e-commerce classique. Il n'est pas
nécessaire de le réécrire. La priorité consiste à remplacer les changements de statut génériques par
des opérations métier explicites et à garantir qu'aucune action logistique ne puisse modifier
implicitement un paiement.

Après correction de la machine à états, mise en place des remboursements réels et sécurisation du
stockage persistant, Bazaar disposera d'une base beaucoup plus fiable pour un lancement commercial.
