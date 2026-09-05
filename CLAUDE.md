# CLAUDE.md

Conventions durables pour travailler sur **Foyer** (application de gestion familiale auto-hébergée). À lire avant toute modification.

## Le projet en bref

- **Cible : familles françaises de métropole.** La locale (`fr-FR`), le fuseau (`Europe/Paris`) et la devise (euro) sont **fixes et codés en dur**, pas configurables. Pas d'i18n : l'interface est en français uniquement.
- **Stack :** Angular 21 (frontend) + Node/Express + TypeScript + SQLite via `better-sqlite3` (backend). Un seul conteneur : le backend sert `/api` **et** l'app compilée.
- **Déploiement :** Docker (image unique) ou LXC natif Proxmox (systemd). Voir `deploy/lxc/` et `docker-compose.yml`.

## Architecture

- **Document-store.** Tout l'état du foyer est un **unique document JSON** (`HouseholdState`) stocké dans SQLite, exposé par `GET/PUT /api/state`. Il n'y a pas de tables métier : les entités (membres, événements, tâches, courses, budget, etc.) vivent dans ce blob.
- **Le store frontend est la source de vérité métier.** Toute la logique (dérivés budget, récurrence agenda, génération de courses, notifications, etc.) est portée fidèlement dans `frontend/src/app/core/foyer.store.ts` à partir de la maquette de design (`docs/`).
- **Auth JWT** (jsonwebtoken) + mots de passe **bcrypt**. Le jeton porte une `token_version` : changer un mot de passe révoque les sessions.
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
              # shopping/ et tasks/ : sous-arbres du document écrits par opérations ciblées (ops.ts pur, repo.ts transaction + journal, routes.ts)
              # notify/ : rappels Web Push (reminders.ts pur, push.ts clés + appareils + journal, scheduler.ts, routes.ts)
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
- **Calendrier partagé** en lecture seule via flux **ICS** (`/api/calendar/feed.ics?token=…`) : événements, échéances de contrat, et les tâches datées sur option (`settings.icsTasks`). Pas de CalDAV.
- **Vacances scolaires** récupérées auprès de `data.education.gouv.fr` selon l'académie (mises en cache, dégradation silencieuse si pas de réseau). **Jours fériés** France métropolitaine calculés localement.
