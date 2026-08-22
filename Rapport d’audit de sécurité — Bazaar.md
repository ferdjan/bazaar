# Rapport d’audit de sécurité — Bazaar

**Cible :** [https://bazaar-rezw.onrender.com/](https://bazaar-rezw.onrender.com/)
**Dépôt analysé :** [github.com/ferdjan/bazaar](https://github.com/ferdjan/bazaar)
**Date :** 21 août 2026
**Périmètre :** analyse défensive du code public et contrôles externes non destructifs. Aucun compte n’a été utilisé, aucune commande ni paiement n’a été créé, et aucune donnée n’a été modifiée.

## Conclusion en termes simples

Le site possède déjà plusieurs protections sérieuses : HTTPS, redirection HTTP vers HTTPS, cookie de session `Secure`/`HttpOnly`/`SameSite=Lax`, CSP avec nonce, protection CSRF, contrôle d’accès administrateur, requêtes SQL préparées, validation serveur du panier et vérifications serveur des paiements. Les contrôles publics effectués n’ont pas révélé de fuite directe de `.env`, de code source, de base SQLite ou de répertoire Git.

Cependant, **je ne recommande pas de rendre la boutique pleinement opérationnelle avant de corriger ou vérifier quatre points**. Le plus urgent est la version de Multer utilisée pour les uploads. Le deuxième point, potentiellement bloquant, concerne la persistance des données sur Render. Les deux autres concernent la configuration du compte administrateur et le stockage des jetons de réinitialisation de mot de passe.

> **Verdict :** bonne base de développement, mais mise en production à suspendre jusqu’à la vérification du stockage Render et des secrets de production, puis mise à jour de Multer.

## Priorités d’action

| Priorité | Constat | Gravité | Décision recommandée |
| --- | --- | --- | --- |
| 1 | Multer `1.4.5-lts.2` est dans une branche affectée par un déni de service multipart annoncé par Express en 2026. | **Élevée** | Mettre à niveau vers `multer >= 2.2.0`, puis retester l’upload. |
| 2 | SQLite, les sessions et les uploads sont écrits sur le système de fichiers local. Render indique que celui-ci est éphémère sans disque persistant. | **Bloquante si aucun stockage persistant n’est configuré** | Vérifier Render immédiatement ; ajouter un disque persistant ou migrer vers PostgreSQL + stockage objet. |
| 3 | Le code contient encore des valeurs de secours faibles pour `SESSION_SECRET`, `ADMIN_PASSWORD` et `admin@example.com`. | **Élevée si les variables Render sont absentes ou si `NODE_ENV` n’est pas `production`** | Configurer les secrets dans Render et faire échouer le démarrage si un secret de production manque. |
| 4 | Les jetons de réinitialisation sont stockés en clair dans SQLite. | **Moyenne** | Stocker uniquement un hash SHA-256 du jeton et invalider les sessions après changement de mot de passe. |
| 5 | Le cookie de session est persistant pendant environ 30 jours. | **Moyenne** | Réduire la durée à quelques heures ou une journée, sauf fonctionnalité « rester connecté » conçue séparément. |
| 6 | Une référence de commande connue permet d’afficher publiquement son total et son statut. | **Faible à moyenne** | Protéger davantage les pages de paiement/confirmation ou utiliser un jeton de confirmation distinct. |

## 1. Multer : mise à jour urgente

Le dépôt déclare `multer: ^1.4.5-lts.1` et l’installation locale a résolu la dépendance vers **Multer 1.4.5-lts.2**. La documentation officielle Express signale `CVE-2026-5079`, une vulnérabilité de déni de service par noms de champs multipart très profondément imbriqués, pour les versions Multer `>= 1.0.0, < 2.2.0`. La version corrigée annoncée est `>= 2.2.0` [1].

Le risque concerne le parseur multipart lui-même. Le fait que Bazaar utilise `memoryStorage` et limite la taille des fichiers est positif, mais cela ne remplace pas la mise à jour du parseur. Une personne pourrait tenter de consommer excessivement la mémoire ou le CPU du service via le formulaire d’upload administrateur.

Dans le dépôt, le fichier [src/routes/admin.js](https://github.com/ferdjan/bazaar/blob/main/src/routes/admin.js#L16-L36) possède déjà `fileSize: 5 * 1024 * 1024` et `files: 1`, ce qui est une bonne base. Il faut néanmoins mettre à jour la dépendance et ajouter, si la nouvelle version le permet dans votre configuration, des limites explicites pour le nombre de champs, le nombre total de parties, la taille des noms de champs et la taille des en-têtes multipart.

La correction minimale à effectuer localement est :

```bash
npm install multer@^2.2.0
npm audit
npm test
```

Après cette mise à jour, testez manuellement dans l’espace admin une vraie image JPEG, PNG et WebP, puis un fichier non-image renommé en `.jpg`. Le dernier doit être refusé. Ne testez pas avec une charge multipart volumineuse sur le site public.

## 2. Risque Render : perte de la base, des comptes et des images

Le code utilise SQLite dans `src/db/connection.js`, un store de session SQLite dans `src/services/sessionStore.js` et écrit les images uploadées dans `public/uploads`. Render indique officiellement que le système de fichiers d’un service est **éphémère par défaut** et que les changements locaux sont perdus lors d’un redémarrage ou d’un redéploiement sans disque persistant [2] [3].

Ce point n’est pas une faille HTTP, mais il est critique pour une boutique. Sans stockage persistant, un redéploiement peut faire disparaître les utilisateurs, commandes, sessions, produits ajoutés et images uploadées. Une sauvegarde ne doit pas être considérée comme faite simplement parce que le service fonctionne aujourd’hui.

Vous devez vérifier dans le tableau de bord Render que le service dispose bien d’un disque persistant monté au chemin qui contient `data.db` et `public/uploads`. Le dépôt prévoit `DB_PATH` comme variable optionnelle dans [.env.example](https://github.com/ferdjan/bazaar/blob/main/.env.example#L39-L40). Si le chemin n’est pas placé sur le disque persistant, la configuration ne suffit pas.

Pour une vraie mise en production, la solution la plus robuste est de migrer la base vers PostgreSQL et les images vers un stockage objet. Une solution temporaire peut consister à utiliser un disque persistant Render, à effectuer des sauvegardes régulières et à tester une restauration sur une copie. Si plusieurs instances sont ajoutées plus tard, SQLite et le store de session local ne suffiront plus.

## 3. Compte administrateur et secrets de production

Le fichier [src/config.js](https://github.com/ferdjan/bazaar/blob/main/src/config.js#L4-L20) prévoit les valeurs de secours suivantes : `SESSION_SECRET = dev-secret-change-me`, `ADMIN_EMAIL = admin@example.com` et `ADMIN_PASSWORD = admin123`. Le script de seed refuse bien de créer le mot de passe `admin123` lorsque `NODE_ENV=production` [4]. Cette protection est utile, mais elle dépend entièrement de la présence correcte de `NODE_ENV=production` au moment du seed.

Le risque est donc une erreur de configuration : si Render ne définit pas `NODE_ENV=production`, ou si le compte admin a déjà été créé avec le mot de passe de développement, l’identifiant faible peut rester utilisable. Je n’ai pas tenté de me connecter avec ce compte, car cela aurait été une action d’authentification inutile sur votre instance.

Dans Render, vérifiez au minimum les variables suivantes :

| Variable | Valeur attendue |
| --- | --- |
| `NODE_ENV` | `production` |
| `BASE_URL` | `https://bazaar-rezw.onrender.com` ou votre domaine final HTTPS |
| `SESSION_SECRET` | une valeur aléatoire longue, différente du dépôt et de l’exemple |
| `ADMIN_EMAIL` | votre adresse réelle d’administration, non publique si possible |
| `ADMIN_PASSWORD` | un mot de passe unique, long et non réutilisé |
| `STRIPE_SECRET_KEY` | clé live uniquement lorsque Stripe est prêt ; jamais dans GitHub |
| `STRIPE_WEBHOOK_SECRET` | secret webhook correspondant à l’URL de production |
| `PAYPAL_MODE` | `live` uniquement lorsque PayPal est réellement configuré |
| `PAYPAL_CLIENT_SECRET` | secret PayPal live, uniquement dans les variables Render |
| `TRUST_PROXY` | à définir seulement selon le proxy Render réellement utilisé ; suivre la note du code |

Je recommande de rendre la configuration « fail closed » : en production, l’application doit refuser de démarrer si `SESSION_SECRET`, `BASE_URL` ou `ADMIN_PASSWORD` sont absents, trop courts ou égaux à une valeur de développement. Il vaut mieux un déploiement qui échoue avec un message clair qu’un site démarré avec un compte administrateur prévisible.

## 4. Jetons de réinitialisation de mot de passe

Le flux de mot de passe oublié possède plusieurs bonnes protections. Il génère un jeton aléatoire de 32 octets, lui donne une expiration d’une heure par défaut, renvoie une réponse générique et invalide le jeton après utilisation. Ces éléments correspondent à plusieurs recommandations OWASP [5].

Le point à corriger est le stockage : [src/routes/auth.js](https://github.com/ferdjan/bazaar/blob/main/src/routes/auth.js#L74-L130) génère le jeton puis le modèle utilisateur l’enregistre tel quel dans SQLite. Si quelqu’un obtenait une copie de la base, il pourrait utiliser les jetons encore valides pour réinitialiser des comptes.

La correction est simple : envoyer le jeton original uniquement dans l’e-mail, mais enregistrer en base `sha256(token)`. Lorsqu’un utilisateur ouvre le lien, calculer le même hash et rechercher ce hash. Après la réinitialisation, vider le hash et la date d’expiration. Comme le jeton est déjà aléatoire et long, SHA-256 sert ici d’empreinte de recherche ; il ne faut pas utiliser le mot de passe utilisateur comme clé de stockage.

Après un changement de mot de passe, il est également préférable d’invalider les sessions existantes du compte. Le store de session actuel utilise SQLite ; il faudra donc prévoir une stratégie simple, par exemple un champ `session_version` ou `password_changed_at` vérifié à chaque requête authentifiée.

## 5. Durée de vie du cookie de session

L’instance renvoie un cookie `connect.sid` avec `Secure; HttpOnly; SameSite=Lax`, et le code configure `httpOnly: true`, `sameSite: 'lax'` et `secure` en production [6]. C’est un résultat positif : OWASP recommande ces attributs et rappelle que `SameSite` complète la protection CSRF sans la remplacer [7].

Le cookie observé possède toutefois une expiration d’environ 30 jours, cohérente avec `maxAge: 1000 * 60 * 60 * 24 * 30` dans [src/app.js](https://github.com/ferdjan/bazaar/blob/main/src/app.js#L67-L78). Si le cookie est volé, cette durée élargit la fenêtre d’utilisation. Pour une boutique qui contient des commandes et des données personnelles, je recommande une session de 8 à 24 heures, ou un cookie de session sans `maxAge`. Si vous voulez proposer « rester connecté », cette fonctionnalité doit utiliser un mécanisme séparé, révocable et limité, pas la session administrative principale.

## 6. Références de commande et exposition limitée

Les routes de paiement cherchent une commande avec la référence fournie dans l’URL et les pages publiques de confirmation affichent la référence, les montants, le mode de paiement et le statut. Le modèle génère une référence aléatoire de 8 octets, soit 16 caractères hexadécimaux [8]. Elle est difficile à deviner par force brute, mais une référence peut être copiée depuis une URL, un historique ou un message.

Le risque observé est surtout une exposition de données commerciales : connaître une référence permet de consulter le total et le statut de la commande. Le nom, l’adresse et le téléphone ne sont pas affichés par le modèle de confirmation publique examiné, et la page détaillée `/commande/:ref` vérifie bien que l’utilisateur est propriétaire ou admin. Pour réduire encore le risque, utilisez un jeton de confirmation distinct, à usage limité, ou exigez la session du propriétaire pour les pages de paiement et de confirmation des clients inscrits.

## Contrôles positifs constatés

| Contrôle | Résultat |
| --- | --- |
| Redirection HTTP vers HTTPS | Observée : HTTP renvoie `301` vers HTTPS. |
| HSTS | Présent avec `max-age=15552000; includeSubDomains`. |
| CSP | Présente avec nonce, `object-src 'none'`, sans `unsafe-eval` observé. |
| Cookie de session | `Secure`, `HttpOnly`, `SameSite=Lax` observés. |
| En-têtes | `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, COOP/CORP observés. |
| Fichiers sensibles publics | `/.env`, `/package.json`, `/src/app.js`, `/data.db`, `/.git/HEAD` et `/uploads/` ont répondu 404. |
| Contrôle admin | `/admin` sans session redirige vers `/connexion`. |
| CSRF | Le code protège globalement les requêtes non sûres ; plusieurs POST sans jeton ont répondu 403 lors du smoke test. |
| XSS de recherche | L’entrée `<script>alert(1)</script>` a été reflétée sous forme échappée `&lt;script&gt;...`, sans balise script brute. |
| Paiements | Stripe et PayPal vérifient côté serveur la référence, le montant et la devise avant de marquer une commande payée, selon le code examiné. |
| Secrets dans Git | Aucun fichier `.env`, certificat, clé privée ou secret live n’a été trouvé dans l’état actuel ni dans les 8 commits clonés ; les correspondances historiques étaient des valeurs d’exemple. |

## État après les modifications du 22 août 2026

Les améliorations suivantes ont été intégrées et vérifiées localement :

| Sujet | État |
| --- | --- |
| Multer | Mis à niveau vers `2.2.0` avec limites multipart renforcées. |
| Configuration production | Refus de démarrage si le secret de session, l’URL HTTPS ou le mot de passe admin sont faibles ou absents. |
| Session | Durée maximale réduite de 30 jours à 24 heures. |
| Dashboard | Filtres serveur par statut et compteurs par statut ajoutés. |
| Actions admin | Actions expédier, livrer, payer COD et annuler ajoutées avec contrôle des transitions. |
| CSRF | Les actions admin sont protégées comme les autres formulaires sensibles. |
| Historique | Les changements de statut enregistrent l’administrateur, l’ancien statut, le nouveau statut, l’action et le suivi. |
| Paiement COD | Une commande COD expédiée ou livrée reste impayée jusqu’à l’action explicite « payer ». |
| Paiements en ligne | Une action locale ne peut pas marquer Stripe ou PayPal comme payé ; la confirmation fournisseur reste obligatoire. |

La suite locale contient désormais **133 assertions OK**. Elle couvre notamment les filtres du dashboard, les actions admin, le refus sans CSRF, les transitions COD, la conservation du suivi, l’historique et le calcul du chiffre d’affaires. `npm audit --omit=dev` signale **0 vulnérabilité**.

## Tests et limites de l’audit

Les vérifications externes étaient limitées à des requêtes GET publiques et à des POST sans jeton CSRF, donc sans création de compte, panier, commande, paiement ou upload. L’audit n’a pas testé le tableau de bord Render, les variables d’environnement réelles, le compte admin, les webhooks avec des signatures réelles ni les comptes Stripe/PayPal.

La suite `npm test` passe dans l’environnement actuel. Les vérifications restent des tests automatisés locaux : elles ne remplacent pas un test de déploiement, un test de restauration de sauvegarde, ni une validation avec de vraies signatures Stripe/PayPal. Les webhooks et les comptes de paiement réels n’ont pas été exercés dans cette passe.

## Plan de mise en production recommandé

Commencez par **ne pas activer les vrais paiements** et ne publiez pas le compte admin tant que la configuration n’est pas vérifiée. Dans Render, confirmez `NODE_ENV=production`, remplacez tous les secrets d’exemple, vérifiez le chemin persistant de SQLite et des uploads, et effectuez une sauvegarde/restauration de test.

Multer est maintenant en `2.2.0`, le stockage des jetons est hashé et la durée du cookie a été réduite. Avant l’ouverture publique, testez manuellement un parcours complet en environnement de test : création d’un client, connexion, panier, commande en paiement à la livraison, actions expédier/livrer/payer, accès à la commande d’un autre compte, réinitialisation de mot de passe, accès admin et upload d’un fichier invalide.

Les prochaines priorités sont : vérifier le disque persistant Render et la restauration, ajouter une pagination des commandes, puis tester les webhooks avec les comptes Stripe et PayPal de test. L’historique actuel utilise SQLite ; lors d’une migration PostgreSQL, cette table devra être migrée avec les commandes.

> **Règle simple avant ouverture au public :** un redéploiement de test ne doit faire disparaître ni un compte, ni une commande, ni une image ; un compte admin ne doit pas fonctionner avec `admin123` ; et une image non valide ne doit jamais être acceptée.

## Références

[1]: https://expressjs.com/en/blog/2026-06-30-security-releases/ "Express.js — June 2026 Security Releases"
[2]: https://render.com/docs/disks "Render — Persistent Disks"
[3]: https://render.com/docs/deploys "Render — Deploying on Render"
[4]: https://github.com/ferdjan/bazaar/blob/main/src/db/seed.js#L18-L31 "Bazaar — seed du compte admin"
[5]: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html "OWASP — Forgot Password Cheat Sheet"
[6]: https://github.com/ferdjan/bazaar/blob/main/src/app.js#L67-L78 "Bazaar — configuration de session"
[7]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html "OWASP — Session Management Cheat Sheet"
[8]: https://github.com/ferdjan/bazaar/blob/main/src/models/order.js#L14-L18 "Bazaar — génération des références de commande"
