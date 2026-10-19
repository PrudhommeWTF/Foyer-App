# CLAUDE.md

Conventions durables pour travailler sur **Foyer** (application de gestion familiale auto-hébergée). À lire avant toute modification.

## Le projet en bref

- **Cible : familles françaises de métropole.** La locale (`fr-FR`), le fuseau (`Europe/Paris`) et la devise (euro) sont **fixes et codés en dur**, pas configurables. Pas d'i18n : l'interface est en français uniquement.
- **Stack :** Angular 21 (frontend) + Node/Express + TypeScript + SQLite via `better-sqlite3` (backend). Un seul conteneur : le backend sert `/api` **et** l'app compilée.
- **Déploiement :** Docker (image unique) ou LXC natif Proxmox (systemd). Voir `deploy/lxc/` et `docker-compose.yml`.

## Architecture

- **Document JSON pour le cœur, tables relationnelles pour les Finances et l'Employé à domicile.** L'essentiel de l'état du foyer (membres, événements, tâches, courses, repas, recettes, contacts, cartes de fidélité, réglages) est un **unique document JSON** (`HouseholdState`) stocké dans SQLite, exposé par `GET/PUT /api/state`. Quatre modules font exception, dans leurs propres **tables relationnelles** hors du document : **Finances** (`fin_*`), pour ne pas recharger et réécrire des milliers d'opérations à chaque sauvegarde, **Employé à domicile** (`emp_*`, suivi des heures de ménage et déclaration CESU, réservé aux adultes ; voir `docs/employe-domicile.md`) **Équipements** (`eqp_*`, fiches des appareils, garanties, factures ; voir `docs/equipements.md`) et **Tables** (`tab_*`, entraînement au calcul mental : sessions, réponses, maîtrise par opération, programmes ; jamais de suppression, `tab_mastery` recalculable depuis `tab_answers` ; voir `docs/tables.md`). Entretien y ajoute ses **coûts** (`ent_*`, montants réservés aux adultes, hors du document qui part aussi aux enfants ; le montant d'une réalisation s'inscrit dans la transaction de la coche par `onTaskCommit`). Les **pièces jointes** (photos de recettes, pièces Finances, factures et plaques des équipements) sont des octets sur le disque adressés par des tables (`hh_attachments`, `fin_attachments`, `eqp_attachments` qui relie une fiche à une ligne de `hh_attachments`), jamais dans le document. **Courses, tâches et lieux** vivent dans le document mais s'écrivent par **opérations ciblées journalisées** (`hh_shop_ops`, `hh_task_ops`, `hh_place_ops`), pas par un PUT complet, pour que deux téléphones qui cochent en même temps ne s'écrasent pas. Les **lieux** (inventaires de vacances : `places` + `placeItems`) suivent le même dispositif, un seul flux d'opérations portant à la fois les lieux et leurs affaires (voir `docs/lieux.md`).
- **Entretien = des tâches.** Les gestes d'entretien sont les tâches d'une liste unique `kind: 'entretien'` (id fixe `entretien`), avec un objet `maintenance` (pièce, stock, pause) ; pas de second moteur de récurrence. Le moteur `recurrence.ts` existe en **deux copies identiques** (frontend `core/`, backend `tasks/`), vérifiées par la CI : modifier celle du frontend puis la recopier. Les pièces (`rooms`) sont un socle commun du document, hors module. Voir `docs/entretien.md`.
- **Le store frontend est la source de vérité métier.** Toute la logique (dérivés budget, récurrence agenda, génération de courses, notifications, etc.) est portée fidèlement dans `frontend/src/app/core/foyer.store.ts` à partir de la maquette de design (`docs/`).
- **Modules activables.** Un administrateur peut désactiver « Repas et cuisine », « Cartes de fidélité », « Finances », « Employé à domicile », « Entretien de la maison » et « Équipements » (drapeaux foyer `modRepas`, `modFidelite`, `modFinances`, `modEmploye`, `modEntretien`, `modEquipements`, défaut activé, voir `frontend/src/app/core/modules.ts`), et activer « École » (`modEcole`, **défaut désactivé** : il contacte un service extérieur, ÉcoleDirecte ; désactivé, aucune requête ne part). Désactiver **masque** partout (menu, tuiles, recherche, repères, sections de réglages) **et verrouille** côté serveur : endpoints relationnels en 403 (`requireModule`), sous-arbres document figés dans `PUT /state` (comme les courses), outils MCP retirés. Les données ne sont **jamais** supprimées à la désactivation ; la réactivation propose de les reprendre ou de repartir à zéro (`POST /api/modules/:id/reset`, confirmation par saisie).
- **Auth JWT** (jsonwebtoken) + mots de passe **bcrypt**. Le jeton porte une `token_version` : changer un mot de passe révoque les sessions. Le jeton de session voyage dans un cookie **`HttpOnly` + `SameSite=Lax`** (invisible au JavaScript, donc hors de portée d'un XSS) posé par le serveur ; le front ne stocke qu'un drapeau « session ouverte », jamais le jeton. L'en-tête `Authorization: Bearer` reste accepté en repli pour les scripts d'API. Le flux ICS a son propre jeton (en query), sans rapport avec la session. **Portail enfant** : un adulte ouvre sur son appareil la session d'un membre enfant (`POST /auth/switch/:memberId`), cookie de type `typ: 'sw'` (claims `mid`, `via`, `vtv`, `sid`, `at`) qui **remplace** celui du parent ; `req.switched` est posé, `req.user.id` vaut 0 (aucun compte), `denySwitched` ferme les routes de compte ; retour par le mot de passe du parent (`/auth/switch/back`, mêmes compteurs que la connexion, voir `auth/limits.ts`), journal `auth_switches`. Les files hors ligne (courses, tâches, lieux) sont rangées **par membre** (`core/op-queues.ts`) et chaque lot porte `as`, refusé en 409 s'il n'est pas celui de la session. Voir `docs/portail-enfant.md`.
- **`base href` relatif** (`./`) : un seul build fonctionne servi à la racine ou derrière un reverse-proxy sur un sous-chemin. Les URLs sont dérivées de `document.baseURI`.
- **Version de l'app :** source de vérité = variable d'env `FOYER_VERSION` (injectée au build Docker, ou dans `/etc/foyer/foyer.env` en LXC). Ne jamais réintroduire de fichier `version` séparé.

## Structure des dossiers

```
frontend/src/app/
  core/       # store (foyer.store.ts), api.service.ts, models.ts, ui-state.ts, helpers.ts, constants.ts, icon.ts
  screens/    # un fichier par écran fonctionnel (calendar, courses, budget, …) ; un dossier quand l'écran a des composants (home/, taches/)
  shell/      # chrome : login, onboarding, sidebar, topbar, tabbar, modales (family, profile, search, notifications), toast
  shared/     # composants réutilisables (avatar, modal)
backend/src/  # server.ts (Express + routes), db.ts (SQLite), models.ts, seed.ts (EMPTY_STATE + buildInitialState)
              # shopping/, tasks/ et places/ : sous-arbres du document écrits par opérations ciblées (ops.ts pur, repo.ts transaction + journal, routes.ts)
              # entretien/ : liste Entretien protégée, catalogue des gestes (config/entretien-catalogue.json, surchargeable dans FOYER_DATA_DIR) ; les gestes eux-mêmes passent par tasks/ ; coûts en tables ent_* (schema.ts, costs.ts, costs-routes.ts adultes seulement)
              # finances/ et employes/ : modules relationnels hors document (schema.ts versionné, repo.ts, routes.ts, backup.ts) ; employes réservé aux adultes
              # equipements/ : module relationnel, tables eqp_* ; pièces = socle Maison du document (rooms, partagé avec Entretien), jamais une table ; garantie calculée à la lecture (warranty.ts, copie identique dans le front) ; fichiers = OwnerKind 'equipment' de storage/files.ts, gardé (servi seulement par le module, /api/files l'ignore) et compté par le ménage du démarrage ; un enfant ne reçoit ni série ni montant (filtre serveur)
              # export/ : écritures de fichiers sans dépendance (pdf.ts tableau WinAnsi, zip-writer.ts sans compression, au fil de l'eau)
              # ecole/ : module ÉcoleDirecte, tables ed_* ; client/ est le SEUL code qui parle à ÉcoleDirecte (sans dépendance au reste de Foyer) ; service.ts l'appelle et écrit les tables ; routes, écrans, planificateur ne lisent que les tables
              # tables/ : module Tables (calcul mental), tables tab_* ; mastery.ts pur (Leitner par couple commutatif), bareme.ts (config/tables-bareme.json, surchargeable dans FOYER_DATA_DIR, jamais de temps en dur), repo.ts, routes.ts (un enfant ne lit et n'écrit que lui), recalcul.ts (npm run tables:recalcul)
              # notify/ : rappels Web Push (reminders.ts pur, push.ts clés + appareils + journal, scheduler.ts, routes.ts)
              # mcp/ : serveur MCP pour les assistants (tools.ts, ecole-tools.ts, entretien-tools.ts) ; un outil `write` n'est offert qu'à un jeton write, un outil `adultes` masqué et refusé à un jeton enfant ; les outils ecole_* filtrent par élève (un enfant ne voit que lui)
deploy/lxc/   # install.sh, proxmox-create.sh, self-update.sh, update.sh, uninstall.sh
docs/         # maquette de design de référence
```

## Conventions de code

- **Angular moderne obligatoire** : composants `standalone`, `ChangeDetectionStrategy.OnPush`, **signals** (pas de RxJS pour l'état local), **control flow** intégré (`@if` / `@for` / `@switch` / `@let`, jamais `*ngIf` / `*ngFor`).
- **Sélecteurs** : `screen-*` pour les écrans, `app-*` pour le shell, `f-*` pour les primitives partagées (`f-icon`, `f-avatar`, `f-modal`).
- **Style dense.** Le code existant est terse : méthodes du store souvent en une ligne, templates inline. Écris du code qui **ressemble au code environnant** (densité, nommage, idiomes) plutôt que d'imposer un autre style.
- **Langue du code** : identifiants et commentaires en **anglais** ; textes destinés à l'utilisateur en **français**.
- **TypeScript strict.** Le code doit passer `tsc --noUnusedLocals --noUnusedParameters` sans erreur (imports, variables et paramètres inutilisés = à retirer).
- **Pas de code mort ni d'UI « coquille ».** Chaque bouton, champ, toggle ou écran affiché doit avoir un **effet réel** (mutation d'état + sauvegarde, appel API, navigation, etc.). Ne pas laisser de réglage persisté sans consommateur, ni de libellé trompeur (ex. « Inviter » alors qu'aucun email n'est envoyé). Retirer ou câbler, jamais faire semblant.
- **Schéma d'état :** quand un champ de `HouseholdState`/`Settings` n'est plus lu nulle part, le retirer **partout** (modèles back **et** front, `EMPTY_STATE` + `buildInitialState`, `SetupPayload`, `normalise()`). Les bases existantes ignorent les clés en trop, aucune migration nécessaire.
- **Secrets à rejouer** (identifiants ÉcoleDirecte) : chiffrés par `storage/secret-box.ts` (AES-256-GCM, clé `FOYER_SECRET_KEY`), jamais renvoyés par une route ni écrits au journal. Ne jamais dériver cette clé de `FOYER_JWT_SECRET`.
- **Migrations SQLite** additives et idempotentes : `try { db.exec('ALTER TABLE …'); } catch { /* déjà présent */ }`.

## Règles d'écriture

- **Pas de tirets longs (tirets cadratins).** Ni dans l'interface, ni dans la doc, ni dans les réponses. Utiliser une virgule, deux-points, ou des parenthèses à la place.
- **Français dans l'interface.** Tout texte visible par l'utilisateur est en français, ton chaleureux mais sobre.
- **Honnêteté.** Signaler ce qui ne marche pas ou n'est que cosmétique ; ne pas surparler. Sur un choix produit, présenter le compromis et **recommander**.

## Workflow Git et découpage

- **Toujours développer sur une branche dédiée partant de `main`**, jamais de commit direct sur `main`.
- **Une PR = un sujet cohérent.** Ne pas mélanger des changements sans rapport. Préférer plusieurs petites PR à une grosse fourre-tout.
- **Avant de committer :** builder le backend (`npm run build` = `tsc`) **et** le frontend (`npm run build` = `ng build`), et vérifier `tsc --noUnusedLocals`. Pour tout changement d'UI, vérifier le rendu dans le navigateur (voir ci-dessous).
- **Messages de commit en français**, descriptifs : une ligne de résumé à l'impératif, puis un corps qui explique le **quoi et le pourquoi** (pas seulement le quoi). Grouper les changements liés dans un même commit.
- **Fusion en squash** vers `main`.

## Niveau d'explication attendu

- **Réponses en français**, concises et structurées (titres, listes, tableaux pour les bilans).
- Expliquer les **décisions** et leurs compromis, pas chaque ligne. Quand une demande a plusieurs interprétations coûteuses (ex. i18n complète, upgrade cassant), clarifier ou recommander avant de foncer.
- Annoncer clairement ce qui a été **vérifié** (builds, tests navigateur) et ce qui reste à la charge de l'utilisateur (redéploiement, etc.).

## Vérification

- **Builds :** `cd backend && npm run build` puis `cd frontend && npm run build`.
- **Lint « code mort » :** `npx tsc -p tsconfig.json --noUnusedLocals --noUnusedParameters --noEmit` (backend) et `npx tsc -p tsconfig.app.json --noUnusedLocals --noUnusedParameters --noEmit` (frontend).
- **Vérification navigateur** (Chromium + Playwright préinstallés) : lancer le backend en servant le frontend compilé, faire l'onboarding via l'API, injecter des données de test via `PUT /api/state`, puis piloter l'app en headless. Il n'y a **pas** de jeu de démo intégré (l'onboarding crée un foyer vierge ; le premier compte est l'unique admin).

## Déploiement (rappels)

- **Secret JWT obligatoire** : `FOYER_JWT_SECRET` (≥ 16 caractères). En production, un secret absent ou trop faible empêche le démarrage.
- **Auto-mise à jour** activée par défaut en LXC : le backend (non privilégié) dépose un fichier déclencheur nommant la version, une unité systemd `path` root exécute `self-update.sh` (télécharge ce tag, recompile, redémarre). Ce qui décide de l'offrir, c'est la **présence du helper root** sur le disque, pas une variable ; `SELF_UPDATE=false` reste l'interrupteur d'arrêt. La **disponibilité** d'une version s'affiche dans tous les cas. Le réglage `updateChannel` choisit entre releases stables et préversions.
- **Calendrier partagé** en lecture seule via flux **ICS** (`/api/calendar/feed.ics?token=…`) : événements, échéances de contrat, occurrences des créneaux d'emploi du temps **publiés à l'agenda** (`sched[].sync`, dérivées côté serveur par `publishedSlotOccurrences`), et les tâches datées sur option (`settings.icsTasks`). Pas de CalDAV.
- **Vacances scolaires** récupérées auprès de `data.education.gouv.fr` selon l'académie (mises en cache, dégradation silencieuse si pas de réseau). **Jours fériés** France métropolitaine calculés localement.
- **Autocomplétion du lieu** d'un événement : le backend relaie la **Base Adresse Nationale** (`api-adresse.data.gouv.fr`, hôte fixe, gratuit, sans clé), voir `backend/src/places.ts`. Coupable par le réglage `placeSuggest` (défaut activé) ; dégradation silencieuse (le champ reste une saisie libre).
