<div align="center">

# 🏡 Foyer — la maison, ensemble

**Application de gestion familiale auto-hébergée** : calendrier partagé, listes de courses,
tâches, messagerie, contacts, documents, budget, planning des repas, carnet de recettes,
emplois du temps et gestion du foyer — le tout dans une interface chaleureuse, claire ou sombre.

Angular 21 · Node/Express · SQLite · Docker

</div>

---

## ✨ Fonctionnalités

| Module | Description |
|---|---|
| 🏠 **Accueil** | Tableau de bord du jour : agenda, tâches, dîner, budget, courses, messages. |
| 📅 **Calendrier** | Vues 3 jours / semaine / mois, récurrence, multi-jours, couleur par membre. Superpose **tâches planifiées**, **jours fériés** (FR), **vacances scolaires** (selon l'académie), **anniversaires** (membres & contacts). Partage par **flux ICS** (Google/Apple Agenda). |
| 🛒 **Courses** | Multi-listes, rayons, articles cochables, génération depuis le planning repas. |
| ✅ **Tâches** | Multi-listes, priorités, assignation à un membre, échéances, **date de planification** (visible dans le calendrier). |
| 💬 **Messagerie** | Fil de discussion familial, une bulle par membre. |
| ☎️ **Contacts** | Recherche, catégories (Urgences, Santé, École…), contacts d'urgence. |
| 📁 **Documents** | Dossiers, fichiers (upload en data-URL), recherche transverse. |
| 💰 **Budget** | Catégories, transactions, barres de progression, comparaison mois-1. |
| 🍽️ **Repas** | Grille 7 jours × 3 créneaux, recettes ou texte libre. |
| 📖 **Recettes** | Carnet avec photos, ingrédients & étapes dynamiques. |
| 🗓️ **Emploi du temps** | Créneaux par membre et par jour, typés (école, sport…). |
| ⚙️ **Paramètres** | Langue, thème, notifications, membres, export/reset des données. |

Chaque membre du foyer a sa couleur d'identité. Thème clair/sombre synchronisé. Interface
responsive (bureau + mobile avec barre d'onglets).

## 🏗️ Architecture

```
Foyer-App/
├── frontend/        # Application Angular 21 (standalone components, signals)
├── backend/         # API Express + TypeScript + SQLite (better-sqlite3)
├── deploy/lxc/      # Installeur natif LXC Proxmox (systemd) + création du conteneur
├── Dockerfile       # Image unique : l'API sert /api ET l'app compilée
└── docker-compose.yml
```

- Le **backend** stocke l'état du foyer comme un document JSON versionné en **SQLite**
  (`GET/PUT /api/state`), avec authentification **JWT** (mots de passe **bcrypt**).
  Un seul conteneur, idéal pour l'auto-hébergement.
- Le **frontend** est une SPA. Toute la logique métier (dérivés budget, récurrence agenda,
  génération de courses…) est portée fidèlement depuis la maquette de design.
- L'app utilise un `base href` **relatif** : un seul build fonctionne servi à la racine
  ou derrière un reverse-proxy sur un sous-chemin.

## 🚀 Démarrage rapide (Docker Compose)

```bash
git clone https://github.com/PrudhommeWTF/Foyer-App.git
cd Foyer-App
# secret de session obligatoire — générez-en un fort dans un fichier .env :
echo "FOYER_JWT_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build
```

➡️ Ouvrez **http://localhost:8099**. **Au premier démarrage**, l'assistant de
configuration s'ouvre : il crée votre foyer, votre compte administrateur (email +
mot de passe), les membres et vos préférences. Voir [Premier démarrage](#-premier-démarrage--onboarding).

### Image préconstruite (sans build)

Une image multi-arch (`amd64`, `arm64`) est publiée par la CI. Décommentez la ligne
`image:` dans `docker-compose.yml`, ou lancez directement :

```bash
docker run -d --name foyer -p 8099:8099 -v foyer-data:/data \
  -e FOYER_JWT_SECRET="une-chaine-aleatoire-longue" \
  ghcr.io/prudhommewtf/foyer-app:latest
```

### Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port d'écoute | `8099` |
| `FOYER_DATA_DIR` | Dossier de la base SQLite | `./data` (ou `/data` en conteneur) |
| `FOYER_JWT_SECRET` | Secret de signature des sessions (≥ 16 caractères aléatoires) — **obligatoire** : en `NODE_ENV=production`, un secret absent/faible **empêche le démarrage** ; sinon un secret éphémère est généré (sessions perdues au redémarrage) | _(aucun)_ |
| `FOYER_CORS_ORIGINS` | Origines cross-origin autorisées (liste séparée par des virgules) — laissez vide en mono-conteneur (l'API sert sa propre app) | _(aucune)_ |
| `FOYER_ALLOW_SIGNUP` | Autoriser l'inscription de comptes (`true`/`false`) | `true` |
| `FOYER_SEED_DEMO` | Précharger les **données de démo** + un compte démo au lieu de l'onboarding | `false` |
| `FOYER_ADMIN_EMAIL` / `FOYER_ADMIN_PASSWORD` | Identifiants du compte démo — **uniquement si `FOYER_SEED_DEMO=true`** | `camille.martin@email.fr` / `foyer` |

La base SQLite vit dans le volume `foyer-data` (`/data`) et **persiste** entre les
redémarrages et les mises à jour de l'image.

## 🚀 Premier démarrage / onboarding

Au tout premier lancement (base de données vide), Foyer affiche un **assistant de
configuration** en 6 étapes :

1. **Bienvenue** · 2. **Nom du foyer** · 3. **Votre profil** (prénom, rôle, couleur, **email +
mot de passe** de l'administrateur) · 4. **Membres** du foyer · 5. **Préférences**
(début de semaine, devise, thème clair/sombre) · 6. **Récapitulatif**.

À la validation, le compte administrateur et le foyer sont créés, et vous entrez
directement dans l'application. Les écrans démarrent vierges (prêts à être remplis),
avec quelques réglages par défaut (rayons de courses, une liste de courses, une liste
de tâches, des catégories de budget).

> Pour découvrir l'app avec un **jeu de données de démonstration** au lieu de l'onboarding,
> démarrez avec `FOYER_SEED_DEMO=true` (compte démo `camille.martin@email.fr` / `foyer`).
> Une base déjà configurée n'est jamais réinitialisée.

> 🔒 **Avant d'exposer publiquement** : définissez un `FOYER_JWT_SECRET` fort (en production, l'app
> **refuse de démarrer** sans secret solide), changez le mot de passe admin, puis passez
> `FOYER_ALLOW_SIGNUP=false`. Placez l'app derrière HTTPS (reverse-proxy type Caddy / Traefik / Nginx).

### 🛡️ Durcissement de sécurité

- **En-têtes HTTP** durcis via [helmet](https://helmetjs.github.io/) (CSP, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`…). La CSP autorise les polices Google et les images `data:`/`blob:`.
- **Limitation de débit** sur les points d'authentification (`/auth/login`, `/auth/register`, `/setup`)
  pour freiner le _brute-force_ (30 tentatives / 15 min / IP).
- **CORS restreint** : aucune origine cross-origin par défaut (l'API sert sa propre SPA) ; ouvrez-en
  au besoin via `FOYER_CORS_ORIGINS`. `trust proxy` est activé pour lire l'IP cliente réelle derrière
  un reverse-proxy.
- **Secret JWT obligatoire** : un secret absent, trop court ou trop connu bloque le démarrage en production.
- **Révocation des sessions** : changer le mot de passe d'un membre (ou supprimer son compte) invalide
  immédiatement tous ses jetons existants.
- **Autorisations** : seul un administrateur du foyer peut ajouter/retirer un membre ou modifier des droits
  d'administration ; un membre non-admin ne peut éditer que son propre profil.

## 📅 Calendrier avancé

- **Vacances scolaires** : choisissez l'**académie** du foyer dans *Paramètres → Général*.
  Les dates officielles sont récupérées auprès de `data.education.gouv.fr` (mises en cache).
  ⚠️ Nécessite un **accès Internet sortant** depuis le serveur ; sans accès, cette couche
  reste simplement vide (aucune erreur bloquante). Les **jours fériés** (France métropolitaine)
  sont calculés localement, sans réseau.
- **Anniversaires** : renseignez la date de naissance des membres (onboarding / gestion de la
  famille) et des contacts pour les voir apparaître chaque année dans le calendrier.
- **Partage ICS** : *Paramètres → Partage du calendrier* fournit une URL `…/api/calendar/feed.ics?token=…`
  (jeton secret) à ajouter dans Google Agenda, Apple Calendrier, etc. — événements du foyer, en
  lecture seule. Un administrateur peut régénérer le lien (invalide l'ancien).

## 🔄 Mises à jour depuis l'interface

*Paramètres → Mises à jour* affiche la version installée et **vérifie** la dernière
version publiée sur GitHub (releases, ou plus haut tag `vX.Y.Z`). Dépôt public → aucun
token requis (sinon `FOYER_GITHUB_TOKEN`).

Pour activer le **bouton « Mettre à jour maintenant »** (télécharge, recompile et
redémarre le service) sur une installation **LXC native**, installez avec l'auto-MAJ :

```bash
SELF_UPDATE=true bash deploy/lxc/install.sh          # dans le conteneur
# ou depuis l'hôte : SELF_UPDATE=true bash deploy/lxc/proxmox-create.sh
```

L'installeur met alors en place un **helper root déclenché par un `systemd.path`** : le
backend (utilisateur `foyer`, non privilégié) dépose un fichier déclencheur, et une unité
root exécute la mise à jour puis redémarre le service — **sans sudo**, le durcissement du
service reste intact. Sans `SELF_UPDATE`, l'app affiche simplement qu'une version est
disponible et rappelle la commande `bash deploy/lxc/update.sh`.

Variables : `FOYER_SELF_UPDATE` (`true`/`false`), `FOYER_GITHUB_REPO`
(défaut `PrudhommeWTF/Foyer-App`), `FOYER_GITHUB_TOKEN` (optionnel).

## 📦 Déploiement LXC Proxmox (natif, sans Docker)

Installation légère dans un conteneur Debian/Ubuntu (Node.js + build + service **systemd**),
idéale sur Proxmox VE. Tout-en-un depuis l'hôte Proxmox (en root) :

```bash
git clone https://github.com/PrudhommeWTF/Foyer-App.git
cd Foyer-App
bash deploy/lxc/proxmox-create.sh          # crée le LXC Debian 12 + installe Foyer
```

Ou dans un LXC déjà existant :

```bash
bash deploy/lxc/install.sh                 # depuis une copie du dépôt dans le conteneur
```

Exploitation : `systemctl status foyer`, `journalctl -u foyer -f`, mise à jour via
`bash deploy/lxc/update.sh`. Détails, options et bonnes pratiques dans
[`deploy/README.md`](deploy/README.md).

## 🧑‍💻 Développement

```bash
npm run install:all          # installe backend + frontend
npm run dev:backend          # API sur :8099 (ts-node-dev, rechargement)
npm run dev:frontend         # Angular sur :4200 (proxy /api → :8099)
```

- Frontend : `frontend/` — `ng serve`, composants standalone + signals.
- Backend : `backend/` — `npm run dev`.
- Build de production : `npm run build` (backend `dist/` + frontend `dist/`).

## 🎨 Design

Reconstruit fidèlement depuis le *handoff* de design (haute fidélité) : polices
Bricolage Grotesque / Nunito / Caveat, palette terracotta & sauge, thème clair/sombre,
rayons et ombres définis dans [`frontend/src/styles.scss`](frontend/src/styles.scss).
La maquette de référence est conservée dans [`docs/`](docs/).

## 📦 CI / images

- `.github/workflows/ci.yml` — build backend + frontend à chaque push/PR.
- `.github/workflows/docker.yml` — publie une image **multi-arch** (`amd64`, `arm64`) sur
  `ghcr.io/<owner>/foyer-app` (tags `latest` + `sha` sur la branche par défaut ; `X.Y.Z`
  et `X.Y` sur tag Git `vX.Y.Z`). La version affichée dans l'app provient du tag Git.

## 📝 Licence

MIT.
