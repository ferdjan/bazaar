# Rapport d’audit de sécurité — Bazaar

J’ai audité le dépôt ferdjan/bazaar dans son état actuel. L’application possède une base technique sérieuse, mais je déconseille une mise en production commerciale avant correction des règles de transition des commandes, des remboursements et du stockage persistant.
Constats Prioritaires
1. Critique: une commande Stripe/PayPal impayée peut être marquée payée indirectement
Références: src/models/order.js:263-291, src/routes/admin.js:247-261
setStatus() interdit bien de choisir directement payee, mais considère automatiquement comme payée toute étape située après payee:
if (idx >= payeeIdx) {
  parts.push("payment_status = 'paid'");
}
Pour Stripe et PayPal, le cycle est:
en_attente -> payee -> expediee -> livree
Un administrateur peut donc envoyer directement expediee ou livree. La commande devient alors payment_status = paid sans confirmation Stripe ou PayPal.
Correction recommandée: ne jamais déduire le paiement d’un statut logistique. Pour un paiement en ligne, en_attente -> payee doit uniquement être effectué par une confirmation fournisseur vérifiée. L’expédition ne doit être possible que si payment_status = paid.
2. Critique: une commande payée peut être annulée sans remboursement
Références: src/models/order.js:253-260, src/models/order.js:326-334
setStatus(ref, 'annulee') ne vérifie ni payment_status, ni la méthode de paiement, ni l’existence d’un remboursement.
Le chiffre d’affaires exclut ensuite toutes les commandes annulées:
WHERE payment_status = 'paid' AND status != 'annulee'
Une vente réellement encaissée peut donc disparaître du chiffre d’affaires sans remboursement client.
Correction recommandée: interdire l’annulation d’une commande payée. Utiliser une opération distincte de remboursement, enregistrant le fournisseur, le montant, l’identifiant de remboursement, son statut et sa date.
3. Élevé: les deux chemins d’annulation ne produisent pas les mêmes effets
Références: src/models/order.js:298-319, src/routes/admin.js:232-261
L’action métier actionFor(..., 'cancel') peut restituer le stock. La modification manuelle /statut appelle directement setStatus() et ne le restitue pas.
Résultat possible:
Commande annulée
stock_released = 0
stock produit toujours diminué
Correction recommandée: supprimer l’annulation générique depuis setStatus() et centraliser toute annulation dans une transaction cancelOrder().
4. Élevé: la machine à états autorise les sauts et régressions
Référence: src/models/order.js:244-295
setStatus() vérifie uniquement que la valeur appartient à une liste. Il ne vérifie pas si la transition depuis l’état actuel est autorisée.
Il est notamment possible de:
- passer directement de en_attente à livree;
- remettre une commande livrée à en_attente;
- réactiver une commande annulée;
- faire régresser une commande réellement payée vers pending.
La suite teste et considère même ce dernier comportement comme correct dans scripts/test.js:617:
régression payee -> livree remet pending
C’est dangereux: une régression logistique ne doit jamais annuler un paiement fournisseur réel.
Correction recommandée: créer une table explicite des transitions autorisées et interdire les régressions par défaut.
5. Élevé: une capture PayPal est déclenchée par une requête GET
Références: src/routes/payments.js:85-105, src/routes/payments.js:62-75
Le retour PayPal appelle:
await paypal.captureAndVerify(order);
Une requête GET de navigation ne devrait pas produire d’effet financier. Elle peut être déclenchée par un navigateur, un robot, un préchargement ou une personne disposant de l’URL.
Les routes de succès et d’annulation n’utilisent pas non plus canAccessPayment().
Correction recommandée: utiliser les webhooks signés comme source de vérité. Les routes GET de retour doivent uniquement afficher l’état actuel. Si une synchronisation de secours est nécessaire, elle doit être authentifiée, idempotente et séparée de la page GET.
6. Élevé: le remboursement est seulement enregistré localement
Référence: src/models/order.js:147-156
Lors d’un retour payé, le système exécute:
UPDATE orders SET refund_dzd = total_dzd
Cela n’effectue aucun remboursement Stripe ou PayPal. L’interface peut donc afficher « remboursée » alors que le fournisseur n’a rien remboursé.
Correction recommandée: ajouter un véritable workflow de remboursement fournisseur avec états pending, succeeded, failed, identifiant externe et idempotence.
7. Élevé: le stockage Render Free est éphémère
Références: render.yaml:7, README.md:398-407
Le projet stocke localement:
- la base SQLite;
- les sessions;
- les images uploadées;
- les commandes et paiements;
- les coupons, avis et QR.
Render Free peut supprimer ces données lors d’un redéploiement ou d’une recréation d’instance.
Correction recommandée avant production:
- PostgreSQL pour les données;
- stockage objet S3-compatible pour les images;
- Redis pour les sessions et le rate limiting;
- sauvegardes automatiques hors instance;
- test régulier de restauration.
8. Élevé: la consommation d’un jeton de réinitialisation n’est pas atomique
Références: src/routes/auth.js:119-135, src/models/user.js:69-79
La route lit le jeton, puis effectue séparément la mise à jour. Deux requêtes concurrentes pourraient valider le même jeton avant son invalidation.
Correction recommandée: effectuer un UPDATE conditionnel sur le hash du jeton et son expiration, puis vérifier que changes === 1.
Problèmes Importants
 9. PayPal utilise une vérification trop partielle
Référence: src/services/payment/paypal.js:77-95
Seule la première purchase_unit est vérifiée. Le code ne confirme pas strictement:
- qu’il existe exactement une unité;
- que result.id === order.provider_id;
- que custom_id et invoice_id correspondent;
- que le montant réellement capturé correspond au montant attendu.
10. Absence de déduplication persistante des webhooks
Les signatures sont vérifiées et markPaid() est idempotent, ce qui est positif. Mais aucun event_id fournisseur n’est conservé.
Recommandation: ajouter une table payment_events avec une contrainte unique sur (provider, event_id).
11. Le taux EUR peut changer après création de la commande
Les services de paiement recalculent le montant EUR à partir de total_dzd et du taux courant. Pourtant, total_eur existe déjà dans la commande.
Recommandation: enregistrer au checkout:
payment_currency
payment_amount_minor
exchange_rate
Puis ne plus recalculer le montant pendant le paiement ou le webhook.
12. Les coupons ne sont pas complètement revalidés dans la transaction
Référence: src/models/order.js:35-43
La réservation transactionnelle vérifie l’activité et le nombre d’utilisations, mais pas l’expiration ou le montant minimum.
Recommandation: le modèle de commande doit recalculer lui-même la réduction. Il ne doit pas faire confiance à un discount_dzd transmis par l’appelant.
13. Validation d’image insuffisante
Référence: src/services/image.js:8-45
La vérification des magic bytes est préférable à la confiance dans l’extension, mais elle ne garantit pas que le fichier est une image valide et décodable.
Recommandation: décoder et réencoder avec sharp, limiter les dimensions et supprimer les métadonnées.
14. Les uploads ne sont pas transactionnels
Si l’écriture SQL échoue après l’enregistrement d’un fichier, celui-ci reste orphelin. Lors d’une modification, l’ancienne image peut être supprimée avant confirmation de l’UPDATE.
Recommandation: utiliser des fichiers temporaires et ne supprimer l’ancienne image qu’après succès de la transaction SQL.
15. Les contraintes SQL restent trop faibles
Ajouter notamment des CHECK pour:
total_dzd >= 0
delivery_dzd >= 0
refund_dzd >= 0
refund_dzd <= total_dzd
qty > 0
price_dzd >= 0
delivery_status devrait aussi être contraint à ses valeurs autorisées.
16. Incompatibilité entre CSP et handlers JavaScript inline
Références: src/app.js:34-50, views/admin/order.ejs:50, views/admin/label.ejs:22
La CSP interdit unsafe-inline, mais les vues utilisent:
onsubmit="return confirm(...)"
onclick="window.print()"
Ces actions risquent d’être bloquées dans un navigateur.
Correction recommandée: remplacer les handlers inline par un fichier JavaScript utilisant addEventListener().
17. SDK PayPal obsolète
npm ci signale que @paypal/checkout-server-sdk@1.0.3 n’est plus maintenu.
Recommandation: planifier une migration vers @paypal/paypal-server-sdk, après sécurisation des workflows actuels.
18. Politique de mots de passe trop faible
Six caractères sont acceptés, y compris pour les vendeurs dans src/routes/admin.js:287-295.
Recommandation:
- minimum 12 caractères pour admin et vendeur;
- minimum 10 à 12 pour les clients;
- MFA pour les administrateurs;
- possibilité de changer le mot de passe depuis le compte.
Architecture Recommandée
La logique critique est actuellement répartie entre routes, modèles et services de paiement. C’est la cause principale des divergences observées.
Je recommande de créer progressivement une couche métier:
src/services/orders.js
src/services/payments.js
src/services/refunds.js
src/services/inventory.js
Les opérations publiques devraient être explicites:
createOrder()
shipOrder()
deliverOrder()
cancelUnpaidOrder()
confirmOnlinePayment()
confirmCodPayment()
receiveReturn()
refundOrder()
Chaque opération doit être:
- transactionnelle;
- autorisée selon le rôle;
- idempotente;
- historisée;
- testée selon la méthode de paiement;
- incapable de modifier implicitement un autre domaine métier.
Évitez surtout une méthode générique comme setStatus() pour les opérations financières.
Tests À Ajouter En Priorité
 1. Stripe pending + tentative expediee doit être refusée.
 2. PayPal pending + tentative livree doit être refusée.
 3. Commande payée + annulation sans remboursement doit être refusée.
 4. Annulation d’une commande en attente doit restituer le stock exactement une fois.
 5. Une commande payée ne doit jamais redevenir pending par changement logistique.
 6. Deux utilisations concurrentes du même jeton de reset: une seule doit réussir.
 7. Deux webhooks avec le même event_id: un seul traitement.
 8. Échec SQL après upload: aucun fichier orphelin.
 9. Parcours navigateur admin avec CSP active.
10. Remboursement Stripe/PayPal échoué: la commande ne doit pas être présentée comme remboursée.
Points Positifs
Le projet ne doit pas être réécrit. Plusieurs choix sont déjà solides:
- architecture simple et compréhensible;
- requêtes SQL préparées;
- création de commande et réservation de stock transactionnelles;
- protection contre le stock négatif;
- CSRF global;
- Helmet et CSP;
- sessions persistantes avec cookies sécurisés;
- régénération de session après authentification;
- rate limiting sur les routes sensibles;
- mots de passe bcrypt;
- jetons de reset et QR stockés sous forme de hash;
- QR suffisamment aléatoires et révocables;
- vérification serveur du montant, de la devise et de la référence des paiements;
- séparation entre administrateur et vendeur;
- suivi public protégé par référence et adresse e-mail;
- bonne documentation métier;
- suite de tests déjà riche.
Résultats Des Vérifications
- npm test: 182 assertions réussies
- npm audit --omit=dev: 0 vulnérabilité connue
- Installation: réussie
- Avertissement: projet déclaré pour Node 22, environnement d’audit sous Node 24
- Avertissement: SDK PayPal actuel déprécié
- Arbre Git: aucune modification produite pendant l’audit
Ordre De Travail Conseillé
 1. Corriger setStatus() et formaliser les transitions.
 2. Unifier l’annulation et la restitution du stock.
 3. Créer un vrai workflow de remboursement.
 4. Retirer les effets financiers des routes GET.
 5. Ajouter la déduplication des webhooks.
 6. Rendre le reset atomique.
 7. Passer à un stockage de production persistant.
 8. Renforcer PayPal et figer le montant EUR.
 9. Durcir les uploads et les contraintes SQL.
10. Ajouter des tests navigateur et de concurrence.
La qualité générale est bonne pour une application en développement avancé. Le principal risque n’est pas une injection SQL ou une vulnérabilité npm évidente, mais une machine à états métier trop permissive, susceptible de rendre le paiement, le stock et le chiffre d’affaires incohérents.
▣  Build · GPT-5.6 Sol · 3m 19s
crée un fichier recomendation.md
+ Thought: Creating recomendation.md file · 2ms
Je vais créer bazaar/recomendation.md avec le rapport structuré par priorité, les références de code, les corrections proposées et une feuille de route exploitable.