# Audit de sécurité de Foyer, avant exposition sur Internet

Audit réalisé sur la branche `main` (commit `97a2f3f`), le 4 septembre 2026, en vue
d'une publication derrière NGINX Proxy Manager avec un certificat Let's Encrypt.

Méthode : lecture intégrale de `backend/src`, `frontend/src`, `deploy/`, du
`Dockerfile` et de la CI, puis vérification **par exécution réelle** du service
compilé (`NODE_ENV=production`, secret JWT posé, base neuve, onboarding par
l'API). Chaque constat marqué « vérifié » a été reproduit en commandes, et les
résultats bruts sont cités dans le rapport.

---

## 1. Avant tout : une faille critique, exploitable sans authentification

**L'inscription libre est activée par défaut, et l'API la sert à n'importe qui.**

`POST /api/auth/register` est un endpoint public, gouverné par le réglage
`signupAllowed`, dont la valeur par défaut est `true`
(`backend/src/settings/registry.ts:351`). Pire : l'installeur LXC écrit
`FOYER_ALLOW_SIGNUP=true` dans `/etc/foyer/foyer.env`
(`deploy/lxc/install.sh:147`), et `docker-compose.yml` fait de même. Comme une
variable d'environnement **verrouille** le réglage, un administrateur ne peut
même pas couper les inscriptions depuis l'application : la case est grisée.

Un compte ainsi créé n'est rattaché à aucun membre (`memberId: null`), donc il
n'est ni administrateur ni enfant. Or **aucun endpoint métier ne demande autre
chose qu'une session valide.**

Scénario, reproduit intégralement :

```
POST /api/auth/register  {"email":"robot@attaquant.example","password":"..."}   → 201 + jeton
GET  /api/state                                → 200  agenda, membres, contacts, adresses
GET  /api/finances/bootstrap                   → 200  comptes et soldes
GET  /api/finances/export.json                 → 200  tout le module Finances
GET  /api/finances/export.csv                  → 200  toutes les opérations
GET  /api/files/1                              → 200  pièce jointe (document scanné)
GET  /api/members/accounts                     → 200  adresses de connexion de la famille
GET  /api/calendar/ics                         → 200  jeton permanent du flux calendrier
PUT  /api/state                                → 200  écriture de l'agenda du foyer
POST /api/finances/transactions                → 201  écriture des comptes
```

Sortie réelle de la lecture d'agenda par ce compte :

```
events: [{"id":"e1","title":"Car scolaire Lena","date":"2026-09-07",
          "start":"07:40","end":"07:55","who":["m2"],
          "lieu":"Arret du Bourg, 12 rue des Lilas"}]
membres: ['Thomas', 'Enfant']
```

C'est exactement le pire scénario du modèle de menace : l'emploi du temps de
l'enfant et le lieu où il attend le car, lisibles par une seule requête HTTP
anonyme. Un robot de scan qui trouve le domaine et tente `/api/auth/register`
(un chemin absolument banal) obtient tout, en lecture **et en écriture**.

### Correctif immédiat, avant même de lire le reste

Le contournement d'exploitation ne demande pas de recompiler :

```sh
# LXC
sed -i 's/^FOYER_ALLOW_SIGNUP=.*/FOYER_ALLOW_SIGNUP=false/' /etc/foyer/foyer.env
systemctl restart foyer
curl -s localhost:8099/api/setup/status   # doit renvoyer "allowSignup":false

# Docker
# docker-compose.yml :  FOYER_ALLOW_SIGNUP: "false"
docker compose up -d
```

Puis vérifier qu'aucun compte parasite n'a déjà été créé :

```sh
sqlite3 /var/lib/foyer/foyer.db \
  "SELECT id, email, member_id, created_at FROM users ORDER BY id;"
```

Tout compte dont `member_id` est `NULL` et que vous ne reconnaissez pas est un
intrus : supprimez-le, et changez ensuite le secret JWT (procédure dans
`docs/exploitation-securite.md`) pour révoquer ses jetons.

Le correctif de fond, à porter dans le code : la valeur par défaut de
`signupAllowed` doit être `false`, l'installeur ne doit plus poser la variable,
et un compte sans membre rattaché ne doit accéder à aucune donnée du foyer.
Détail au constat **C1**.

---

## 2. La liste exhaustive des endpoints exposés

C'est le document à relire en premier. Trois colonnes comptent : qui peut
appeler, et ce qui sort.

### 2.1 Sans authentification (6 endpoints)

| Méthode et chemin | Limitation de débit | Données retournées | Justifié ? |
|---|---|---|---|
| `GET /api/health` | non | `{ok:true}` | Oui. Sonde Docker et proxy. À bloquer côté NGINX depuis l'extérieur, sans intérêt public. |
| `GET /api/setup/status` | non | `{needsSetup, allowSignup}` | Oui, mais fuite mineure : dit à un robot si le foyer est configuré et si l'inscription est ouverte. Voir **M9**. |
| `POST /api/setup` | 30 / 15 min | Crée le foyer et le compte admin, **uniquement si zéro compte existe** | Oui. Le garde `countUsers() > 0` est correct : une fois le foyer créé, l'endpoint répond 409. |
| `POST /api/auth/login` | 30 / 15 min | Jeton JWT ou 401 | Oui. Voir **E2**, **E3** pour ses défauts. |
| `POST /api/auth/register` | 30 / 15 min | Jeton JWT, compte sans membre | **Non. C'est la faille critique C1.** |
| `GET /api/calendar/feed.ics?token=` | **aucune** | Tout le calendrier du foyer : événements, échéances de contrat, tâches datées | Par nécessité (Google et Apple Agenda ne savent pas porter de jeton). Le jeton fait 144 bits, il n'est pas devinable. Mais voir **E6**. |

### 2.2 Authentification simple, aucun rôle exigé

**Tout compte connecté, y compris un compte enfant et un compte auto-inscrit.**

| Méthode et chemin | Données retournées |
|---|---|
| `GET /api/state` | **Le document du foyer entier** : membres, agenda, emplois du temps, contacts, adresses, recettes, repas, documents, messages, notes |
| `PUT /api/state` | Écriture du même document (réglages et préférences d'autrui exceptés) |
| `GET /api/live` | Liste de courses et tâches |
| `GET /api/me` | Son propre compte, avec les indicateurs `admin` et `enfant` |
| `PUT /api/me/credentials` | Change sa propre adresse et son mot de passe (exige le mot de passe actuel) |
| `GET /api/members/accounts` | **Les adresses de connexion de tous les comptes du foyer.** Voir **E5** |
| `GET /api/home/rules` | Règles de contexte de l'accueil |
| `GET /api/calendar/school-holidays` | Vacances scolaires (données publiques) |
| `GET /api/calendar/ics` | **Le jeton secret du flux ICS, et le crée s'il n'existe pas.** Voir **E6** |
| `GET /api/system/version` | Version, dépôt GitHub, état de l'auto-mise à jour |
| `GET /api/system/update-check` | Dernière version publiée et ses notes |
| `GET /api/system/update-status` | État de la dernière mise à jour |
| `POST /api/shopping/ops` | Écriture de la liste de courses |
| `POST /api/tasks/ops` | Écriture des tâches |
| `POST /api/files?owner=&id=` | Téléversement d'un fichier (20 Mo max serveur, plafond du foyer en dessous) |
| `GET /api/files/:id` | **Téléchargement d'une pièce du module Documents.** Identifiant entier séquentiel |
| `DELETE /api/files/:id` | **Suppression d'une pièce du module Documents** |
| `GET /api/push/status` | Clé publique VAPID, ses propres appareils, qui du foyer est abonné, journal des envois |
| `POST /api/push/subscribe` · `POST /unsubscribe` · `DELETE /subscribe/:id` · `POST /test` | Gestion de ses propres appareils |
| `POST /api/recipes/import` | Import d'une recette depuis une URL. **Seule requête sortante déclenchée par l'utilisateur.** 30 / 5 min |

#### Module Finances, en entier sous simple authentification

Aucune de ces routes ne vérifie de rôle (sauf `/restore`).

| Méthode et chemin | Données |
|---|---|
| `GET /finances/bootstrap` | Comptes, catégories, soldes, prêts, couverture, alias |
| `GET /finances/home` | Solde courant, résumé du mois, échéances, épargne |
| `GET /finances/export.json` | **Sauvegarde complète du module, en un appel** |
| `GET /finances/export.csv` | **Toutes les opérations, en un appel** |
| `GET /finances/accounts` · `GET /accounts/:id/schedule` | Comptes, soldes, tableau d'amortissement |
| `POST /finances/accounts` · `PUT /accounts/:id` · `DELETE /accounts/:id` | Écriture des comptes |
| `POST /finances/accounts/:id/aliases` · `DELETE /aliases/:id` | Alias de compte |
| `GET /finances/categories` · `POST` · `PUT /:id` · `DELETE /:id` | Catégories et budgets |
| `GET /finances/dashboard` | Tableau de bord mensuel |
| `GET /finances/transactions` | **Toutes les opérations, filtrées et paginées** |
| `POST /finances/transactions` · `PUT /:id` · `DELETE /:id` | Écriture des opérations |
| `GET /finances/summary` | Agrégats du mois |
| `GET /finances/contracts` · `POST` · `PUT /:id` · `DELETE /:id` | **Contrats : fournisseurs, références client, échéances** |
| `POST /finances/assets` · `PUT /:id` · `DELETE /:id` | Biens |
| `POST /finances/savings` · `PUT /:id` · `DELETE /:id` · `POST /:id/task` | Projets d'épargne |
| `GET /finances/readings` · `POST` · `PUT /:id` · `DELETE /:id` | Relevés de compteur |
| `GET /finances/rules` · `POST` · `PUT /:id` · `DELETE /:id` · `POST /:id/move` · `POST /rules/preview` · `POST /rules/apply` | Règles de catégorisation |
| `GET /finances/tags` | Étiquettes |
| `GET /finances/attachments?owner=&id=` | Liste des pièces jointes |
| `POST /finances/attachments` | Téléversement (20 Mo) |
| `GET /finances/attachments/:id` | **Téléchargement d'une pièce jointe.** Identifiant entier séquentiel |
| `DELETE /finances/attachments/:id` | **Suppression d'une pièce jointe** |
| `GET /finances/attachments-check` | Écarts entre la base et le disque |
| `POST /finances/imports` | **Import d'un relevé bancaire, 25 Mo. CSV, OFX, CAMT.053, XLSX, tableau HTML** |
| `GET /finances/imports` · `GET /imports/:id/preview` · `POST /imports/:id/accounts` · `POST /imports/:id/commit` · `DELETE /imports/:id` | Cycle d'import |
| `GET /finances/transfers` · `GET /transfers/candidates` · `POST /transfers` · `DELETE /transfers/:group` | Virements internes |

### 2.3 Authentifié, membre non enfant

Le routeur `/api/settings` ferme sa porte aux comptes marqués `enfant`, écran
**et** API (`backend/src/settings/routes.ts:43`). C'est le seul cloisonnement
enfant du produit, et il est correctement fait côté serveur.

| Méthode et chemin | Données |
|---|---|
| `GET /api/settings` | Registre des réglages, valeurs effectives, ce que l'environnement impose, vue de déploiement (**sans les secrets**), journal des modifications |
| `PATCH /api/settings` | Écrit clé par clé. Un réglage de portée « foyer » exige l'administration ; une préférence personnelle n'est écrivable que pour soi |

### 2.4 Administrateur du foyer requis

| Méthode et chemin | Effet |
|---|---|
| `POST /api/members/:memberId/account` | Ouvre un accès à un membre |
| `PUT /api/members/:memberId/account` | Change son adresse ou son mot de passe |
| `DELETE /api/members/:memberId/account` | Retire son accès (refus sur soi-même) |
| `POST /api/calendar/ics/regenerate` | Renouvelle le jeton du flux ICS |
| `GET /api/settings/export` | Configuration en JSON |
| `POST /api/settings/import` | Réimporte une configuration |
| `GET /api/system/status` | Version, disque, poids des données, chemin de la base, sauvegardes |
| `POST /api/system/backup` | Instantané `VACUUM INTO` |
| `GET /api/system/backup/:name` | Télécharge un instantané (**toute la base**) |
| `DELETE /api/system/backup/:name` | Efface un instantané |
| `POST /api/system/update` | **Dépose le fichier déclencheur de l'auto-mise à jour** (exécutée en root par systemd). Voir **M12** |
| `POST /api/finances/restore` | Remplace tout le module Finances (double garde : admin + `confirm: REMPLACER`) |

### 2.5 Ce qui n'existe pas, et c'est une bonne nouvelle

Aucune réinitialisation de mot de passe par lien ou par courriel. Aucun envoi de
courriel du tout. C'est le classique le plus souvent cassé : il n'est pas là.

---

## 3. Les fichiers servis statiquement

`express.static(STATIC_DIR)` sert **uniquement** le répertoire de l'application
compilée (`backend/public` en LXC, `/app/public` en Docker). Contenu réel, après
construction :

| Fichier | Contrôle d'accès | Cache-Control | Remarque |
|---|---|---|---|
| `index.html` | aucun (public) | `no-store, must-revalidate` | Coquille de l'application, aucune donnée |
| `main-YFHLIFY6.js` | aucun (public) | `public, max-age=31536000, immutable` | 1 Mo. Contient les **noms** des variables d'environnement (registre partagé front/back), jamais leurs valeurs |
| `styles-NELLXPGD.css` | aucun (public) | `immutable` | |
| `sw.js` | aucun (public) | `max-age=0, must-revalidate` | Service worker |
| `manifest.webmanifest`, `favicon.ico`, `favicon.svg`, `icon-192.png`, `icon-512.png` | aucun (public) | `max-age=0, must-revalidate` | |

**Aucune carte de source** n'est produite en production (vérifié : `ls *.map`
ne renvoie rien ; `sourceMap` n'est activé que dans la configuration
`development` de `angular.json`).

**Aucun fichier sensible n'est dans cette racine** : pas de `.git`, pas de
`.env`, pas de base de données. Le `.dockerignore` exclut `.git`, `.env`,
`backend/data` et `data`. L'installeur LXC copie uniquement
`frontend/dist/frontend/browser`.

**Les pièces jointes et les documents ne sont PAS servis statiquement.** Ils
vivent dans `FOYER_DATA_DIR/pieces`, en dehors de toute racine servie, et ne
sortent que par `GET /api/files/:id` et `GET /api/finances/attachments/:id`,
tous deux derrière le garde de session. C'était votre soupçon principal : il est
infondé sur ce point précis. Le problème est ailleurs, dans **qui** a une
session (voir **C1** et **E1**).

À noter : la route de repli `app.get('*')` renvoie `index.html` avec un code
**200** pour n'importe quel chemin inexistant. `/.git/config`, `/.env` et
`/backup.sql` répondent donc 200 avec du HTML. Rien ne fuit, mais un scanner
lira « 200 » partout. Voir **F2**.

---

## 4. Ce qui est sain, et sur quoi vous pouvez vous appuyer

Cette section n'est pas de la politesse. Elle délimite ce que vous n'avez pas à
refaire.

**Injection SQL : rien à signaler.** Toutes les requêtes passent par
`better-sqlite3` en requêtes préparées avec des paramètres liés, y compris les
filtres dynamiques : `whereClause()` (`backend/src/finances/repo.ts:277`)
construit une liste de fragments constants et pousse les valeurs dans un tableau
de paramètres. Aucune concaténation de valeur utilisateur dans du SQL, nulle part
dans le dépôt. Les tris ne sont pas dynamiques (`ORDER BY t.date DESC, t.id DESC`
est écrit en dur), donc le piège habituel n'existe pas.

**JWT : la vérification est correcte.** Vérifié en attaquant :

```
Jeton alg=none                     → 401
Jeton signé avec un autre secret   → 401
Aucun jeton                        → 401 sur /state, /finances/export.json, /files/1, /settings, /system/status
```

`jwt.verify(token, JWT_SECRET)` avec un secret de type chaîne : `jsonwebtoken`
refuse `none` et n'accepte aucun algorithme asymétrique, il n'y a donc pas de
confusion d'algorithme possible. Le secret est **obligatoire en production** :
absent, trop court (moins de 16 caractères) ou égal à une valeur connue,
le service **refuse de démarrer** (`backend/src/server.ts:110-124`), en
imprimant un secret aléatoire prêt à copier. C'est le bon comportement.

**Révocation des sessions : le mécanisme existe déjà.** Chaque jeton porte une
`token_version`, comparée à celle du compte à chaque requête
(`backend/src/server.ts:230`). Changer un mot de passe l'incrémente, ce qui
invalide immédiatement toutes les sessions de ce compte. Supprimer le compte
invalide aussi. Et changer `FOYER_JWT_SECRET` déconnecte tout le monde d'un coup.
Vous avez donc bien un bouton d'arrêt d'urgence : la procédure est dans
`docs/exploitation-securite.md`.

**Aucun secret dans l'historique Git.** 81 commits examinés, motifs classiques
recherchés (clés privées, jetons GitHub, jetons Slack, clés AWS,
`FOYER_JWT_SECRET=`). Les seules correspondances sont des messages d'erreur du
code et une valeur de test (`un-secret-tres-long-et-aleatoire`). **Rien à
faire tourner.**

**XSS : la surface est réellement fermée.** Aucune occurrence de `innerHTML`,
`bypassSecurityTrustHtml`, `DomSanitizer` ni `eval()` dans tout
`frontend/src`. Angular échappe par défaut, et rien ne contourne cet
échappement. Combiné à la politique de sécurité de contenu ci-dessous, c'est
solide.

**La politique de sécurité de contenu n'est pas décorative.** Valeur réellement
émise, relevée sur le service en fonctionnement :

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self';
base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; script-src-attr 'none'
```

`script-src 'self'` sans `unsafe-inline` ni `unsafe-eval`, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'` : c'est une
vraie politique, pas un `default-src` permissif. `X-Powered-By` est retiré.
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: SAMEORIGIN`, HSTS présent. `upgrade-insecure-requests` est
volontairement désactivé pour ne pas casser les installations locales en HTTP
clair, ce qui est un choix défendable.

**CORS : correct.** `origin: false` par défaut, donc aucune origine croisée
autorisée. Pas de joker, pas de reflet automatique de l'en-tête `Origin`. Une
liste blanche explicite est possible via `FOYER_CORS_ORIGINS`, et elle n'est pas
utilisée en déploiement mono-conteneur.

**Le parseur XML est immunisé par construction contre XXE et l'expansion
d'entités.** `backend/src/finances/import/xml.ts` est écrit à la main : il retire
les `<!DOCTYPE ...>` avant toute analyse, et son unique table d'entités
(`ENTITIES`) contient les cinq entités prédéfinies plus les références
numériques. Il n'existe **aucun** chemin de code capable de résoudre une entité
externe ni de développer une entité définie par le document. `SYSTEM
"file:///etc/passwd"` et la « bombe des milliards de rires » sont donc
structurellement impossibles sur les imports CAMT.053 et OFX. C'est mieux fait
que la plupart des applications qui tirent une bibliothèque XML complète.

**Les fichiers ne sont pas devinables par leur nom, et la traversée de chemin est
impossible.** Le nom donné par l'utilisateur n'atteint jamais le système de
fichiers : le chemin est dérivé du SHA-256 du contenu
(`relPathFor()`, `backend/src/storage/blobs.ts`). Le nom n'est conservé qu'en
base, pour l'affichage, et il ressort dans un `Content-Disposition` construit
selon la RFC 6266 avec un repli ASCII et un filtrage des caractères de contrôle
(`backend/src/headers.ts`), ce qui ferme aussi l'injection d'en-tête.

**Le type des téléversements est décidé sur les octets, pas sur l'extension**
(`detectType()`), et tout ce qui n'est ni une image ni un PDF est servi en
`Content-Disposition: attachment` avec `X-Content-Type-Options: nosniff` : un
fichier déposé ne peut pas être interprété comme une page dans l'origine de
l'application.

**La traversée de chemin sur le téléchargement de sauvegarde est bloquée.**
`safeSnapshotName()` impose `^foyer-\d{4}-\d{2}-\d{2}-\d{4}\.db$`. Vérifié :

```
GET /api/system/backup/../foyer.db        → 404
GET /api/system/backup/..%2ffoyer.db      → 404
GET /api/system/backup/%2e%2e%2ffoyer.db  → 404
GET /api/system/backup/....//foyer.db     → 404
```

**La protection anti-SSRF de l'import de recette est sérieuse** (schémas
restreints à http et https, refus des identifiants dans l'URL, refus des plages
privées, lien-local et métadonnées **après résolution DNS**, redirections suivies
à la main et **revalidées à chaque saut**, taille plafonnée à 3 Mo en flux et
délai à 12 s). Il ne lui manque qu'une chose, la réidentification DNS : voir
**E7**.

**Les gardes de `PUT /api/state` sont bien pensés.** Un non-administrateur ne
peut ni modifier les réglages du foyer, ni ajouter ou retirer un membre, ni
changer un indicateur d'administration (donc pas d'auto-promotion), ni modifier
la fiche d'un autre membre, ni écrire les préférences d'autrui. Un enfant n'écrit
aucune préférence. Ces contrôles sont côté serveur, comme il faut.

**Les sauvegardes sont cohérentes.** `VACUUM INTO` plutôt qu'une copie de
`foyer.db` en WAL : c'est la seule façon correcte de sauvegarder à chaud, et le
code le fait.

**La configuration ne rend jamais un secret.** `deploymentView()` renvoie
l'**état** d'un réglage de type `secret` (posé ou non), jamais sa valeur.

**Aucune donnée de démonstration, aucun compte de test, aucun mode
développement dans l'image de production.** `NODE_ENV=production` est fixé dans
le `Dockerfile` et dans l'unité systemd, l'onboarding crée un foyer vierge, et
il n'existe pas de jeu de démo intégré.

**Aucune télémétrie.** `NG_CLI_ANALYTICS=false` au build, aucun appel sortant en
dehors de trois destinations nommées et justifiées : `api.github.com` (version),
`data.education.gouv.fr` (vacances scolaires), et l'URL que vous collez vous-même
pour importer une recette. Plus les services push (Mozilla, Google, Apple) quand
un rappel part.

---

## 5. Les constats

Sévérités : **critique** (exploitable sans authentification depuis Internet),
**élevée** (exploitable par un compte authentifié, ou sous une condition simple),
**moyenne** (défaut de durcissement, exploitable en combinaison), **faible**
(bonne pratique non respectée, sans exploitation directe).

| # | Sévérité | Constat | Fichier et ligne | Scénario d'exploitation | Correction proposée | Effort |
|---|---|---|---|---|---|---|
| **C1** | **critique** | Inscription libre ouverte par défaut, et verrouillée ouverte par l'installeur. Un compte sans membre rattaché accède à tout | `settings/registry.ts:351` (`default: true`) ; `server.ts:342` ; `deploy/lxc/install.sh:147` ; `docker-compose.yml:25` | Un robot POSTe sur `/api/auth/register`, obtient un jeton, puis lit l'agenda des enfants avec leur adresse, les finances, les documents scannés, et **écrit** dans le document du foyer. Reproduit intégralement, sortie citée en section 1 | Trois gestes : (1) `default: false` pour `signupAllowed` ; (2) l'installeur et le compose ne posent plus `FOYER_ALLOW_SIGNUP` du tout ; (3) **surtout**, un compte dont `member_id` est `NULL` doit être refusé sur toute route métier, avec un message clair invitant à demander un accès à un administrateur. Le garde (2) seul serait de la configuration ; le garde (3) est structurel et protège même une base déjà polluée | S |
| **E1** | élevée | Aucun cloisonnement du compte enfant en dehors des réglages : lecture **et suppression** des finances et des documents de famille | `server.ts:565` (`api.use('/finances', auth, ...)`), `server.ts:590` (`/files`) ; `storage/routes.ts:106` ; `finances/routes.ts:417` | Le compte enfant lit `/api/finances/export.csv` (toutes les opérations), télécharge `/api/files/1` (une pièce d'identité scannée), et **supprime** une pièce jointe ou une transaction. Vérifié : `DELETE /api/files/1 → 204`, `DELETE /api/finances/transactions/1 → 200`, `GET /api/finances/export.json → 200` | Un garde `requireAdulte` (membre non `enfant`) monté sur `/api/finances` et sur `/api/files`, comme celui qui existe déjà pour `/api/settings`. Les pièces du module Documents peuvent aussi porter une visibilité, mais le garde global est le geste qui compte, et il est petit | S |
| **E2** | élevée | La limitation de débit du formulaire de connexion se contourne par un en-tête `X-Forwarded-For` falsifié dès que le backend est joignable directement | `server.ts:150` (`app.set('trust proxy', 1)`) | Vérifié : 40 tentatives depuis la même IP donnent 16 × 401 puis 24 × 429 ; les mêmes tentatives avec `X-Forwarded-For: 203.0.113.$i` donnent **10 × 401 d'affilée**, le compteur repart à zéro à chaque en-tête. Derrière NGINX Proxy Manager correctement configuré, l'en-tête est réécrit et la protection tient ; directement joignable (le port 8099 ouvert sur le LAN, aujourd'hui, avec le service qui écoute sur `0.0.0.0`), le bourrage d'identifiants est **illimité** | Ne pas faire confiance à un en-tête que le proxy n'a pas posé : côté NGINX, imposer `proxy_set_header X-Forwarded-For $remote_addr;` (écraser, pas ajouter) ; côté Express, garder `trust proxy: 1` et faire écouter le service sur `127.0.0.1` quand une adresse d'écoute est configurée (`FOYER_BIND`). Détail des deux côtés en section 7 | S |
| **E3** | élevée | La limitation actuelle bloque la famille et laisse passer l'attaque distribuée : compteur par IP seulement, les connexions réussies comptent, aucun compteur par compte, aucune temporisation progressive | `server.ts:205-211` | Vérifié : après 30 tentatives ratées depuis une IP, **le vrai mot de passe reçoit un 429**. Toute la famille derrière une même sortie 4G est coupée par un seul attaquant. À l'inverse, 30 tentatives par IP et par quart d'heure sur un parc de mille IP donnent 30 000 essais : c'est un bourrage d'identifiants confortable | Deux compteurs plutôt qu'un : par IP (généreux, pour ne pas couper la maison) **et par compte visé** (strict, avec temporisation progressive), les connexions réussies ne comptant plus (`skipSuccessfulRequests`). Et une journalisation des échecs pour que fail2ban prenne le relais côté proxy | M |
| **E4** | élevée | Énumération des comptes par le temps de réponse | `server.ts:334-338` | Le message est bien identique dans les deux cas (« Identifiants invalides »), mais pas le temps : un compte inexistant sort avant tout calcul, un compte existant paie une vérification bcrypt. Mesuré : **2,0 ms contre 81,0 ms** en moyenne sur 5 essais, écarts nets (min 1,5 / max 2,9 contre min 80,1 / max 81,7). Un attaquant teste une liste d'adresses et sait lesquelles existent, puis concentre le bourrage dessus | Comparer systématiquement contre un condensat bcrypt factice quand le compte n'existe pas, pour que les deux chemins coûtent le même temps. Trois lignes | S |
| **E5** | élevée | `GET /api/members/accounts` ne demande pas l'administration : tout compte connecté obtient les adresses de connexion de toute la famille | `server.ts:527` | Vérifié : le compte auto-inscrit reçoit `{"accounts":[{"memberId":"me","email":"thomas@example.fr"},{"memberId":"m1","email":"enfant@example.fr"}]}`. C'est la liste exacte des identifiants à attaquer, et les adresses personnelles de la famille | Ajouter `requireAdmin` : cet écran est celui de la gestion des accès, il est déjà réservé à un administrateur dans l'interface | S |
| **E6** | élevée | `GET /api/calendar/ics` rend le jeton du flux calendrier à tout compte connecté, et le crée s'il n'existe pas | `server.ts:680` | Le compte enfant, ou le compte auto-inscrit, appelle l'endpoint et obtient un jeton (vérifié : `{"token":"8a92cdc497ffb690cee71c2c97ac9d9e61d5"}`). Ce jeton donne ensuite un accès **permanent et sans authentification** à tout le calendrier du foyer, donc aux horaires des enfants. Il survit à la suppression du compte : seul un renouvellement explicite le coupe. C'est le canal d'exfiltration le plus discret de l'application | Réserver la lecture **et** la création du jeton à un administrateur (`requireAdmin`), comme l'est déjà `/regenerate`. Et poser une limitation de débit sur `/api/calendar/feed.ics`, qui n'en a aucune | S |
| **E7** | élevée | Réidentification DNS sur l'import de recette : l'adresse est validée puis résolue une seconde fois, indépendamment | `recipes/fetch.ts:98-107` (`dns.lookup`) et `:190` (`fetch(current)`) | `assertPublicUrl()` résout le nom et vérifie que l'adresse est publique, puis `fetch()` **résout à nouveau**. Un attaquant qui contrôle un domaine avec un TTL très court répond une adresse publique à la vérification et `192.168.1.10` à la requête réelle. Le conteneur va alors lire votre Home Assistant, votre Synology ou l'interface du routeur, et le contenu de la page remonte dans le message d'erreur ou dans la recette importée. Le module est activé par défaut (`recipeImport: true`) | Épingler l'adresse : résoudre une fois, puis fournir à `fetch` un `Agent` undici dont la fonction `connect.lookup` renvoie l'adresse déjà validée. La vérification et la connexion portent alors sur la même adresse, par construction | M |
| **E8** | élevée | Bombe zip à l'import de relevé : le déflatage n'a aucune borne de sortie | `finances/import/zip.ts:47` (`zlib.inflateRawSync(data)`) | Vérifié : un faux `.xlsx` de **305 907 octets** fait monter le service à **988 Mo de mémoire résidente** et bloque le processus **5,7 secondes**. Le plafond de téléversement étant de 25 Mo et le taux de compression d'environ 1000:1, un seul fichier peut viser 25 Go : le conteneur est tué par le noyau. Quelques requêtes en parallèle suffisent à couper le service pour la famille | `zlib.inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 })`, et refuser une entrée dont la taille décompressée annoncée dépasse déjà ce plafond. Une ligne, plus le message d'erreur | S |
| **E9** | élevée | L'export complet du module Finances est appelable par tout compte connecté, et n'est pas journalisé | `finances/routes.ts:279` (`export.json`), `:430` (`export.csv`) | Deux GET, aucun rôle exigé, aucune trace. C'est le point d'exfiltration parfait : toutes les opérations, tous les comptes, toutes les références de contrat, en un appel, sans que rien ne l'ait noté | Réserver aux administrateurs (`requireAdmin`), et écrire une ligne de journal nommant le membre, l'horodatage et le nombre de lignes sorties. Même chose pour `GET /api/system/backup/:name` | S |
| **M1** | moyenne | Injection de formules dans l'export CSV | `finances/repo.ts:430` (`csvCell`) | Vérifié : un libellé d'opération `=cmd\|'/C calc'!A1` ressort tel quel dans `export.csv` (`"2026-09-02";"=cmd\|'/C calc'!A1";...`). Les guillemets CSV **ne protègent pas** : Excel et LibreOffice lisent le contenu de la cellule et l'interprètent comme une formule. Le libellé peut venir d'un relevé bancaire importé, donc d'une source que vous ne maîtrisez pas | Préfixer d'une apostrophe simple toute cellule commençant par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot, dans `csvCell`. Une ligne, et ça vaut aussi pour l'export ICS et les exports du frontend | S |
| **M2** | moyenne | Aucune journalisation des connexions, réussies ou échouées | `server.ts:328-339` | Un bourrage d'identifiants ne laisse **aucune trace** dans `journalctl -u foyer`. Vous ne pouvez ni le détecter, ni alimenter fail2ban depuis les journaux applicatifs, ni savoir après coup si un compte a été compromis. C'est la demande explicite de votre point 7 | Une ligne `log.info` sur chaque connexion réussie (adresse de connexion, IP réelle, horodatage) et `log.attention` sur chaque échec, avec l'IP issue de `req.ip`. Compléter par le changement de mot de passe et la révocation, déjà journalisés | S |
| **M3** | moyenne | Coût bcrypt à 10, sur une implémentation JavaScript pure qui bloque la boucle d'événements | `db.ts:163`, `:188`, `:210` (`bcrypt.hashSync(password, 10)`) | Le stockage est **correct sur le fond** (bcrypt, sel intégré, jamais de MD5 ni de SHA nu) : ce n'est pas un constat critique. Mais le coût 10 est bas pour 2026, et `bcryptjs` est du JavaScript pur : les 81 ms mesurés en E4 sont **81 ms pendant lesquelles le service ne répond à personne d'autre**. Monter le coût aggrave le blocage | Passer aux versions asynchrones (`bcrypt.hash` / `bcrypt.compare`, qui découpent le travail et rendent la main) et monter le coût à 12. Les condensats existants restent valides, bcrypt porte son coût dans le condensat : les anciens mots de passe continuent de fonctionner et se recalculent au prochain changement | S |
| **M4** | moyenne | `PUT /api/state` accepte n'importe quel objet JSON, sans validation de schéma | `server.ts:362-368` | Le seul contrôle est `typeof state === 'object'`. Un compte connecté écrit 4 Mo de structures arbitraires dans le document du foyer : champs inconnus conservés, types incohérents, tableaux remplacés par des objets. Le frontend, qui porte toute la logique métier, plante ou se comporte de travers pour toute la famille jusqu'à restauration. Ce n'est pas une fuite, c'est une casse | Valider la forme des tableaux de premier niveau (membres, événements, tâches, contacts, recettes, repas) et **rejeter explicitement** plutôt que de retomber sur une valeur par défaut, comme le demande le brief. Borner aussi le nombre d'entrées par collection | M |
| **M5** | moyenne | Les fichiers de données sont lisibles par tout le monde sur la machine | `deploy/lxc/install.sh` (`chown -R`, sans `chmod`) | Vérifié sur une base fraîche : `foyer.db` en `0644`, `pieces/` en `0755`. Tout compte local du conteneur lit la base entière et les documents scannés. Hors périmètre pour un accès physique, mais un service tiers compromis dans le même LXC y accède | `umask 0077` dans l'unité systemd et `chmod 700` sur `FOYER_DATA_DIR` à l'installation. Commandes en section 7 | S |
| **M6** | moyenne | Le conteneur Docker tourne en root, sans système de fichiers en lecture seule, et publie le port sur toutes les interfaces | `Dockerfile` (aucune directive `USER`) ; `docker-compose.yml:10` (`"8099:8099"`) | Une exécution de code dans le processus Node donne root dans le conteneur. Et `8099:8099` publie sur `0.0.0.0` : le backend est joignable depuis tout le réseau local, ce qui rend E2 exploitable sans passer par le proxy | `USER node` dans le `Dockerfile` (avec `chown` sur `/data`), `read_only: true` plus un `tmpfs` pour `/tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, et publication sur `127.0.0.1:8099:8099` | M |
| **M7** | moyenne | Dépendances portant des vulnérabilités publiées | `frontend/package.json:17` ; `backend/package.json` | `@angular/core` et `@angular/compiler` en 21.2.x : XSS de sévérité **haute** par attributs gestionnaires d'événements dans l'i18n (GHSA-jj27-h5hq-8x99). L'application n'utilise pas l'i18n, l'exploitabilité réelle est donc douteuse, mais la version est vulnérable. Côté backend, `qs` (via `body-parser` et `express` 4) porte deux avis modérés : contournement de limite de tableau, et déni de service | `npm audit fix` des deux côtés, puis reconstruction et passage des tests. Aucune de ces corrections n'est cassante | S |
| **M8** | moyenne | La CI ne fait ni audit de dépendances ni recherche de secrets | `.github/workflows/ci.yml` | Une dépendance vulnérable ou un secret committé passe sans rien déclencher. Le dépôt est propre aujourd'hui : il s'agit de le garder ainsi | Deux étapes qui **échouent la construction** : `npm audit --omit=dev --audit-level=high` sur les deux paquets, et une recherche de motifs de secrets sur le diff. Plus la suite de tests de sécurité décrite en section 6 | S |
| **M9** | moyenne | Longueur minimale de mot de passe à 6 caractères | `settings/registry.ts` (`passwordMinLength`) | Six caractères tiennent quelques secondes hors ligne si la base fuit, et pas beaucoup plus en ligne une fois E2 et E3 corrigés. Pour une application publique portant ces données, c'est trop bas | Porter le défaut à 12, refuser les mots de passe d'une liste courte des plus courants, et ne pas imposer de règle de composition (elle produit des mots de passe pires). Les comptes existants ne sont pas invalidés : la règle s'applique au prochain changement | S |
| **M10** | moyenne | En-têtes de sécurité : `Permissions-Policy` absente, HSTS à 180 jours sans `preload` | `server.ts:155-171` | Rien d'exploitable en soi. Mais `Permissions-Policy` absente laisse à une éventuelle injection l'accès à la géolocalisation, au micro et à la caméra, et un HSTS court laisse une fenêtre de rétrogradation vers HTTP | `permissionsPolicy` fermant `geolocation`, `camera`, `microphone`, `payment`, `usb`, `interest-cohort`. Pour HSTS, **une seule source** : le laisser à helmet et ne pas l'activer dans NGINX Proxy Manager, sinon l'en-tête sort en double. Voir section 7 | S |
| **M11** | moyenne | Jeton en `localStorage`, session de 30 jours, aucune expiration par inactivité, aucun renouvellement | `frontend/src/app/core/api.service.ts:179` ; `server.ts:216` | Le jeton est lisible par tout script s'exécutant dans la page. La politique de sécurité de contenu et l'absence totale d'`innerHTML` rendent ce scénario peu probable, mais une session de 30 jours qui ne tourne jamais reste une fenêtre large sur un téléphone perdu | **Mon avis : ne pas migrer vers un cookie httpOnly.** Le gain réel est faible ici (le XSS est déjà fermé par ailleurs) et le coût est élevé : protection CSRF à ajouter partout, gestion du `SameSite` qui casse l'abonnement ICS et le service worker, et une refonte de l'authentification que vous ne vouliez pas. Ce qui vaut le coup, à la place : abaisser le défaut de session à 7 jours, ajouter une expiration par inactivité côté client (déconnexion après 12 h sans activité), et renouveler le jeton en tâche de fond | M |
| **M12** | moyenne | Un compte administrateur compromis obtient l'exécution de code en root sur le LXC | `server.ts:733` (`POST /api/system/update`) ; `deploy/lxc/install.sh` (unité `path` root) ; `deploy/lxc/self-update.sh` | Le backend, non privilégié, dépose `.update-trigger` ; une unité systemd `path` **root** exécute `self-update.sh`, qui télécharge la dernière release depuis `FOYER_GITHUB_REPO` et la compile. Le mécanisme est bien conçu (le service ne détient pas sudo), mais la chaîne « compte admin volé → root sur l'hyperviseur invité » existe. Elle est activée par défaut | Ce n'est pas une faille à corriger, c'est un compromis à décider en connaissance de cause. **Ma recommandation : `SELF_UPDATE=false` dès que le domaine est public**, et mise à jour manuelle par `update.sh`. Si vous la gardez, exiger le mot de passe de l'administrateur dans le corps de `POST /api/system/update`, comme `/me/credentials` le fait déjà | S |
| **F1** | faible | Pas de deuxième facteur | (aucun) | Voir mon avis argumenté en section 8. Ce n'est pas une faille : c'est une décision qui vous revient | Voir section 8 | L |
| **F2** | faible | La route de repli répond 200 pour n'importe quel chemin | `server.ts:822` | `/.git/config`, `/.env`, `/wp-login.php` renvoient tous 200 avec `index.html`. Aucune donnée ne fuit, mais un scanner conclut que tout existe, et vos journaux de proxy deviennent illisibles | Répondre 404 pour les chemins qui ressemblent à un fichier (comportant un point) et servir `index.html` uniquement pour les routes de l'application | S |
| **F3** | faible | Les polices Google sont chargées depuis le navigateur de chaque membre | `frontend/src/index.html` ; CSP autorisant `fonts.googleapis.com` | Chaque ouverture de l'application envoie l'IP de la famille à Google, avec le référent. Pour une application dont la raison d'être est de ne pas confier ses données à un tiers, c'est une incohérence | Embarquer les fichiers de police dans l'application et retirer `fonts.googleapis.com` et `fonts.gstatic.com` de la CSP. Bénéfice secondaire : l'application fonctionne mieux hors ligne | S |
| **F4** | faible | Plages IP réservées manquantes dans le filtre anti-SSRF | `recipes/fetch.ts:52-74` | `198.18.0.0/15` (bancs d'essai), `198.51.100.0/24` et `203.0.113.0/24` (documentation), `64:ff9b::/96` (NAT64) et `2002::/16` (6to4) passent le filtre. Aucune de ces plages n'est routable chez vous, l'impact réel est nul, mais la liste doit être complète pour rester une protection et pas une approximation | Compléter `isPrivateAddress`. Quelques lignes, à faire en même temps que E7 | S |
| **F5** | faible | Aucun renouvellement de jeton | `server.ts:216` | Un jeton émis vit 30 jours pleins et ne tourne jamais. Volé le premier jour, il sert 29 jours de plus. Corrigé en pratique par le changement de mot de passe, qui incrémente `token_version` | Renouveler silencieusement le jeton à chaque appel de `/api/me` quand il approche de son terme. Complémentaire de M11 | S |

Effort : **S** = moins d'une demi-journée, **M** = une à deux journées, **L** = au-delà.

---

## 6. Les tests de sécurité à ajouter en CI

Non négociables selon votre brief, et tous écrits pour échouer avant la
correction et passer après. Ils s'ajoutent à la suite existante
(`backend/test/*.test.ts`, exécutée par `npm test` et bloquante en CI).

| Test | Ce qu'il vérifie |
|---|---|
| `auth-guards` | Chaque endpoint protégé appelé sans jeton répond 401. La liste des endpoints publics est **écrite en dur dans le test** : ajouter une route publique par mégarde fait échouer la CI |
| `auth-jwt` | Un jeton signé `alg: none` est rejeté. Un jeton signé avec un autre secret est rejeté. Un jeton dont la `token_version` est périmée est rejeté |
| `auth-roles` | Un membre non administrateur reçoit 403 sur `/api/system/status`, `/api/system/backup`, `/api/members/:id/account`, `/api/settings/export`, `/api/finances/restore`, `/api/calendar/ics` |
| `auth-enfant` | Un compte enfant reçoit 403 sur `/api/finances/*` et sur `/api/files/*`, en lecture **comme** en suppression |
| `auth-sans-membre` | Un compte dont `member_id` est `NULL` reçoit 403 sur toute route métier (le garde structurel de C1) |
| `auth-fichiers` | `GET /api/files/:id` et `GET /api/finances/attachments/:id` répondent 401 sans session valide, y compris avec un jeton expiré ou révoqué |
| `auth-enumeration` | Le temps de réponse de `/api/auth/login` pour un compte inexistant et pour un mauvais mot de passe reste dans le même ordre de grandeur, et le message est identique |
| `import-bombe` | Une archive dont une entrée dépasse le plafond de décompression est refusée, sans allocation massive |
| `export-csv` | Une cellule commençant par `=`, `+`, `-` ou `@` ressort neutralisée |
| `ssrf-recette` | Une URL résolvant vers une adresse privée est refusée, y compris après redirection, y compris quand la première résolution rend une adresse publique (réidentification DNS) |

Ces tests demandent d'extraire l'assemblage de l'application Express de
`server.ts` dans un module exportable : aujourd'hui, importer `server.ts`
démarre l'écoute réseau. C'est une refonte de plomberie, sans changement de
comportement, et elle est comptée dans l'effort de la tranche 1.

---

## 7. Exposition réseau : la configuration, pas les principes

Cette section est écrite pour être appliquée telle quelle. Les procédures
complètes (rotation du secret, compromission, sauvegarde chiffrée, checklist de
mise en ligne) sont dans les documents séparés listés en section 9.

### 7.1 Le backend ne doit être joignable que par le proxy

Aujourd'hui le service écoute sur `0.0.0.0` (`server.ts:889`). Trois façons de le
contenir, de la meilleure à la plus rustique.

**LXC, avec le proxy sur une autre machine** (le cas le plus courant) : garder
l'écoute sur toutes les interfaces et filtrer avec nftables.

```sh
cat > /etc/nftables.conf <<'EOF'
table inet foyer {
  chain entree {
    type filter hook input priority filter; policy accept;
    ct state established,related accept
    iif lo accept
    # Remplacez par l'adresse de votre NGINX Proxy Manager
    ip saddr 10.0.0.20 tcp dport 8099 accept
    tcp dport 8099 drop
  }
}
EOF
systemctl enable --now nftables
nft list table inet foyer
```

**LXC, avec le proxy sur la même machine** : le plus simple et le plus sûr, faire
écouter le service en local seulement.

```sh
echo 'FOYER_BIND=127.0.0.1' >> /etc/foyer/foyer.env
systemctl restart foyer
ss -ltnp | grep 8099          # doit afficher 127.0.0.1:8099, pas 0.0.0.0:8099
```

Cela suppose la petite correction de code qui lit `FOYER_BIND` (comptée dans la
tranche 2). En attendant, la règle nftables ci-dessus fait le travail.

**Docker** : publier sur la boucle locale seulement.

```yaml
ports:
  - "127.0.0.1:8099:8099"
```

**Vérification depuis un autre poste du réseau local**, à faire après :

```sh
# Doit expirer ou être refusé, pas répondre
curl -m 5 -sv http://ADRESSE_DU_LXC:8099/api/health
nmap -Pn -p 8099 ADRESSE_DU_LXC     # attendu : filtered ou closed
```

**Vérification depuis l'extérieur**, une fois le domaine ouvert :

```sh
curl -m 5 -sv http://VOTRE_IP_PUBLIQUE:8099/api/health   # doit échouer
```

### 7.2 NGINX Proxy Manager

Dans l'interface : **Details** → schéma `http`, hôte et port du LXC, **Block
Common Exploits** activé, **Websockets Support** désactivé (l'application n'en
utilise pas). **SSL** → certificat Let's Encrypt, **Force SSL** activé, **HTTP/2**
activé, **HSTS désactivé** (helmet l'émet déjà : l'activer des deux côtés produit
un en-tête en double, que certains clients rejettent).

Dans l'onglet **Advanced**, coller ceci :

```nginx
# TLS 1.2 minimum. Retirez TLSv1.2 si aucun appareil ancien ne doit se connecter.
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;

# L'adresse du client, ECRASEE et non ajoutee : c'est ce qui rend la
# limitation de debit du backend fiable (constat E2).
proxy_set_header X-Forwarded-For  $remote_addr;
proxy_set_header X-Real-IP        $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Host             $host;

# Un televersement de piece jointe monte a 20 Mo, un import de releve a 25 Mo.
client_max_body_size 30m;

# Un import de releve prend quelques secondes ; au-dela c'est une panne.
proxy_connect_timeout 10s;
proxy_send_timeout    60s;
proxy_read_timeout    60s;

# Aucune raison d'exposer la sonde de sante depuis Internet.
location = /api/health { return 404; }

# Chemins que seule la maison doit atteindre. Adaptez la plage a votre reseau.
location ~ ^/api/(system|settings)/ {
  allow 192.168.1.0/24;
  allow 10.0.0.0/24;
  deny  all;
  proxy_pass http://ADRESSE_DU_LXC:8099;
}
```

Le dernier bloc est votre restriction par IP sur les chemins sensibles :
l'administration système et les réglages ne sont plus atteignables depuis
Internet, même avec un compte administrateur volé. La famille garde tout le
reste depuis l'extérieur.

**Vérification depuis l'extérieur :**

```sh
curl -sI https://foyer.mondomaine.fr | grep -iE "strict-transport|content-security|x-frame|x-content-type|referrer"
curl -s -o /dev/null -w "%{http_code}\n" https://foyer.mondomaine.fr/api/health          # attendu 404
curl -s -o /dev/null -w "%{http_code}\n" http://foyer.mondomaine.fr/                     # attendu 301
curl -s -o /dev/null -w "%{http_code}\n" https://foyer.mondomaine.fr/api/state           # attendu 401
curl -s -o /dev/null -w "%{http_code}\n" https://foyer.mondomaine.fr/.git/config         # attendu 404 apres F2
```

### 7.3 Contenir une falsification de requête sortante

Le conteneur n'a besoin de joindre que trois destinations publiques, plus les
services push. Il n'a **aucune** raison d'atteindre votre réseau local.

```sh
cat >> /etc/nftables.conf <<'EOF'
table inet foyer_sortie {
  chain sortie {
    type filter hook output priority filter; policy accept;
    ct state established,related accept
    skuid foyer ip daddr 127.0.0.0/8 accept
    skuid foyer ip daddr 10.0.0.0/8      reject
    skuid foyer ip daddr 172.16.0.0/12   reject
    skuid foyer ip daddr 192.168.0.0/16  reject
    skuid foyer ip daddr 169.254.0.0/16  reject
    skuid foyer ip daddr 100.64.0.0/10   reject
  }
}
EOF
systemctl reload nftables
```

`skuid foyer` limite la règle au seul utilisateur du service : le reste du
conteneur garde son accès au réseau local. C'est la seconde barrière derrière la
correction de E7, et elle tient même si le code se trompe.

**Vérification :**

```sh
sudo -u foyer curl -m 3 -s -o /dev/null -w "%{http_code}\n" http://192.168.1.1/   # doit echouer
sudo -u foyer curl -m 5 -s -o /dev/null -w "%{http_code}\n" https://api.github.com/  # doit repondre
```

### 7.4 Détecter et bloquer les tentatives répétées

Une fois M2 corrigé, les journaux applicatifs nomment les échecs de connexion
avec l'IP réelle. En attendant, les journaux du proxy suffisent pour les
réponses 401 et 429.

```sh
cat > /etc/fail2ban/filter.d/foyer.conf <<'EOF'
[Definition]
failregex = ^.*\[foyer\] Connexion refusee .* depuis <HOST>.*$
ignoreregex =
EOF

cat > /etc/fail2ban/jail.d/foyer.conf <<'EOF'
[foyer]
enabled  = true
backend  = systemd
journalmatch = _SYSTEMD_UNIT=foyer.service
maxretry = 10
findtime = 10m
bantime  = 1h
action   = nftables-multiport[name=foyer, port="80,443", protocol=tcp]
EOF

systemctl restart fail2ban
fail2ban-client status foyer
```

Sur la machine du proxy, en complément, à partir des journaux NGINX :

```sh
# Les dix adresses les plus insistantes sur le formulaire de connexion, aujourd'hui
awk '$7=="/api/auth/login"' /var/log/nginx/proxy-host-*_access.log \
  | awk '{print $1}' | sort | uniq -c | sort -rn | head
```

### 7.5 Consulter les connexions

Une fois M2 en place :

```sh
# Les connexions reussies des dernieres 24 h
journalctl -u foyer --since "24 hours ago" | grep "Connexion reussie"

# Les echecs, groupes par adresse
journalctl -u foyer --since "7 days ago" | grep "Connexion refusee" \
  | grep -oE "depuis [0-9a-f.:]+" | sort | uniq -c | sort -rn
```

### 7.6 Durcissement du service et des fichiers

```sh
# Permissions des donnees (constat M5)
chmod 700 /var/lib/foyer
find /var/lib/foyer -type f -exec chmod 600 {} +
find /var/lib/foyer -type d -exec chmod 700 {} +

# Durcissement systemd, en complement de ce que pose deja l'installeur
mkdir -p /etc/systemd/system/foyer.service.d
cat > /etc/systemd/system/foyer.service.d/durcissement.conf <<'EOF'
[Service]
UMask=0077
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=false
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
PrivateDevices=true
# Garde-fou contre la bombe zip (constat E8), en attendant la correction
MemoryMax=1G
EOF
systemctl daemon-reload && systemctl restart foyer
systemd-analyze security foyer.service | tail -5
```

`MemoryDenyWriteExecute=false` est nécessaire : le compilateur juste-à-temps de
Node en a besoin. `MemoryMax=1G` fait tuer et redémarrer le service plutôt que de
laisser une bombe zip épuiser la mémoire de l'hôte.

---

## 8. Deuxième facteur : mon avis franc

**Recommandation : oui, un TOTP, mais après les corrections critiques et
élevées, pas avant. Et pour tous les comptes adultes, pas seulement
l'administrateur.**

Le raisonnement. Une fois C1, E2, E3 et E4 corrigés, votre exposition réelle au
bourrage d'identifiants devient faible : trois ou quatre comptes seulement, des
mots de passe que vous choisissez, une limitation par compte et par IP, aucune
énumération. Le TOTP n'apporte alors qu'un gain marginal contre le scan
automatisé, qui est votre menace numéro un.

Ce qu'il apporte vraiment, c'est une protection contre le scénario que rien
d'autre ne couvre : **la réutilisation de mot de passe**. Si l'un de vous utilise
ailleurs le mot de passe du foyer, et que cet ailleurs fuit, un attaquant entre
avec des identifiants valides. Aucune limitation de débit ne voit passer une
connexion réussie du premier coup. Vu la nature des données (l'emploi du temps
des enfants et votre adresse), ce scénario justifie à lui seul le coût.

Et pourquoi tous les adultes, pas seulement l'administrateur : parce qu'après
correction de E1, un compte adulte non administrateur lit quand même l'agenda,
les finances et les documents. Protéger seulement l'administrateur ne protégerait
que les réglages, c'est-à-dire ce qui compte le moins.

**Coût d'implémentation** : deux à trois journées. TOTP se code sans dépendance
nouvelle (`crypto.createHmac('sha1')` suffit, la RFC 6238 tient en trente
lignes), avec le QR code engendré côté navigateur. Il faut : une colonne
`totp_secret` et une colonne `totp_recovery` dans `users`, un écran
d'activation, un second temps dans le formulaire de connexion, des codes de
récupération à imprimer, et un moyen de désactiver le TOTP d'un membre depuis un
compte administrateur (sinon un téléphone perdu ferme le compte définitivement).
Aucun service tiers, aucun compte externe, aucune dépendance payante.

**Ce que je vous déconseille** : rendre le TOTP obligatoire pour les comptes
enfants. Un enfant qui perd son téléphone perd son accès, vous passez votre temps
à débloquer, et la protection ne sert à rien puisqu'un compte enfant correctement
cloisonné (E1) ne donne accès à presque rien.

### Cantonner les comptes enfants

Vous demandez comment les cantonner sans affaiblir l'ensemble. La réponse est
qu'un compte enfant ne doit pas être un compte adulte avec des écrans masqués :
il doit être refusé côté serveur sur les modules qui ne le concernent pas. Le
mécanisme existe déjà et il est bien fait pour `/api/settings`
(`settings/routes.ts:43`) : un intercepteur monté sur le routeur, qui répond 403
avant toute logique métier. Il suffit de le monter aussi sur `/api/finances` et
sur `/api/files` (constat E1).

Sur le code court : **ne le faites pas.** Un code à quatre ou six chiffres sur un
formulaire public est cassé en quelques heures même avec une limitation de débit,
et il partagerait la même surface d'authentification que vos comptes adultes.
Donnez aux enfants un vrai mot de passe, plus court à taper mais pas plus faible
(trois mots choisis au hasard, par exemple), et cantonnez-les par les
autorisations plutôt que par la faiblesse du facteur.

---

## 9. Documents d'exploitation

Écrits séparément, pour être ouverts au moment où vous en avez besoin :

- `docs/mise-en-ligne-checklist.md` : à dérouler avant d'ouvrir le domaine
- `docs/exploitation-securite.md` : rotation du secret JWT, déconnexion de toutes
  les sessions, procédure en cas de suspicion de compromission
- `docs/sauvegarde-restauration.md` : sauvegarde et restauration chiffrées, base
  et pièces jointes comprises
- `docs/risques-acceptes.md` : ce qui reste risqué après toutes les corrections

---

## 10. Plan de correction proposé

À valider avant que je touche au code.

**Tranche 1, les critiques et le socle de test.** C1 (les trois gestes, dont le
garde structurel sur les comptes sans membre), plus l'extraction de
l'application Express pour rendre les routes testables, plus les tests
`auth-guards`, `auth-jwt`, `auth-sans-membre`. Déployable seule.

**Tranche 2, les élevées.** E1 à E9, chacune avec son test. Deux sous-lots :
autorisations (E1, E5, E6, E9) puis robustesse (E2, E3, E4, E7, E8), pour que le
premier parte vite.

**Tranche 3, le reste groupé.** M1 à M12 et F1 à F5, moins F1 (le TOTP) qui
mérite sa propre décision et son propre chantier.

**Ce qui va se passer pour les sessions en cours, à chaque tranche :**

- Tranche 1 : **aucune déconnexion**, sauf pour les comptes sans membre
  rattaché, qui perdent l'accès. Si vous en avez de légitimes (un compte créé par
  inscription puis jamais rattaché), rattachez-les à un membre **avant** de
  déployer. La requête pour les lister est en section 1.
- Tranche 2 : aucune déconnexion. Un compte enfant perdra l'accès aux écrans
  Finances et Documents, ce qui se verra immédiatement dans l'interface.
- Tranche 3 : aucune déconnexion, sauf si vous changez `sessionDays`, qui ne
  s'applique qu'aux connexions suivantes.

**Retour arrière**, valable pour chaque tranche : les corrections sont des
commits séparés sur une branche dédiée, sans migration de base et sans
changement de schéma. Revenir en arrière est un `git revert` du commit, une
reconstruction et un redémarrage du service, sans perte de données ni
déconnexion. La seule exception est le passage de bcrypt au coût 12 (M3) : les
condensats déjà recalculés restent valides après retour arrière, bcrypt portant
son coût dans le condensat.
