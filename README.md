<div align="center">

# 🏡 Foyer — la maison, ensemble

**Application de gestion familiale auto-hébergée** : calendrier partagé, listes de courses,
tâches, messagerie, contacts, documents, budget, planning des repas, carnet de recettes,
emplois du temps et gestion du foyer — le tout dans une interface chaleureuse, claire ou sombre.

Angular 21 · Node/Express · SQLite · Docker · Add-on Home Assistant (ingress)

</div>

---

## ✨ Fonctionnalités

| Module | Description |
|---|---|
| 🏠 **Accueil** | Tableau de bord du jour : agenda, tâches, dîner, budget, courses, messages. |
| 📅 **Calendrier** | Vues 3 jours / semaine / mois, récurrence, événements multi-jours, couleur par membre. |
| 🛒 **Courses** | Multi-listes, rayons, articles cochables, génération depuis le planning repas. |
| ✅ **Tâches** | Multi-listes, priorités, assignation à un membre, échéances. |
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
├── homeassistant/   # Add-on Home Assistant (ingress) + dépôt d'add-ons
├── Dockerfile       # Image unique : l'API sert /api ET l'app compilée
└── docker-compose.yml
```

- Le **backend** stocke l'état du foyer comme un document JSON versionné en **SQLite**
  (`GET/PUT /api/state`), avec authentification **JWT** (mots de passe **bcrypt**).
  Un seul conteneur, idéal pour l'auto-hébergement et Home Assistant.
- Le **frontend** est une SPA. Toute la logique métier (dérivés budget, récurrence agenda,
  génération de courses…) est portée fidèlement depuis la maquette de design.
- L'app utilise un `base href` **relatif**, donc un seul build fonctionne en autonome,
  derrière un reverse-proxy, ou derrière l'**ingress** Home Assistant.

## 🚀 Démarrage rapide (self-hosted)

### Docker Compose (recommandé)

```bash
git clone https://github.com/PrudhommeWTF/Foyer-App.git
cd Foyer-App
# éditez docker-compose.yml pour changer FOYER_JWT_SECRET / identifiants
docker compose up -d --build
```

➡️ Ouvrez **http://localhost:8099**. Connexion par défaut :
`camille.martin@email.fr` / `foyer` (à changer immédiatement).

### Image préconstruite

```bash
docker run -d --name foyer -p 8099:8099 -v foyer-data:/data \
  -e FOYER_JWT_SECRET="une-chaine-aleatoire-longue" \
  -e FOYER_ADMIN_PASSWORD="votre-mot-de-passe" \
  ghcr.io/prudhommewtf/foyer-app:latest
```

### Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port d'écoute | `8099` |
| `FOYER_DATA_DIR` | Dossier de la base SQLite | `./data` (ou `/data` en conteneur) |
| `FOYER_JWT_SECRET` | Secret de signature des sessions — **à définir** | `foyer-dev-secret-change-me` |
| `FOYER_ADMIN_EMAIL` | Email du compte initial | `camille.martin@email.fr` |
| `FOYER_ADMIN_PASSWORD` | Mot de passe du compte initial | `foyer` |
| `FOYER_ALLOW_SIGNUP` | Autoriser l'inscription (`true`/`false`) | `true` |

> 🔒 **Avant d'exposer publiquement** : définissez un `FOYER_JWT_SECRET` fort, changez le mot
> de passe admin, puis passez `FOYER_ALLOW_SIGNUP=false`. Placez l'app derrière HTTPS
> (reverse-proxy type Caddy/Traefik/Nginx).

## 🏡 Intégration Home Assistant

Deux approches, selon votre installation :

### A. Add-on Home Assistant (recommandé — apparaît dans la barre latérale)

Sur Home Assistant OS / Supervised :

1. **Paramètres → Modules complémentaires → Boutique → ⋮ → Dépôts**
2. Ajoutez `https://github.com/PrudhommeWTF/Foyer-App`
3. Installez **Foyer**, configurez `jwt_secret`/identifiants, démarrez, activez la barre latérale.

Grâce à l'**ingress**, Foyer s'affiche directement dans l'interface HA, sans ouvrir de port,
et ses données persistent dans `/data`. Voir [`homeassistant/foyer/README.md`](homeassistant/foyer/README.md).

### B. Panneau iframe (toute installation HA, app hébergée à part)

Si vous hébergez déjà Foyer (Docker), ajoutez-le à la barre latérale via `configuration.yaml` :

```yaml
panel_iframe:
  foyer:
    title: "Foyer"
    icon: mdi:home-heart
    url: "http://IP_DU_SERVEUR:8099"
    require_admin: false
```

### C. À propos de HACS

HACS gère les *intégrations*, *plugins Lovelace* et *thèmes* — pas les applications web
complètes ni les add-ons. Une app plein-écran comme Foyer s'intègre donc à HA via
**l'add-on** (méthode A, distribué par ce dépôt via le mécanisme de *dépôt personnalisé*) ou
via un **panneau iframe** (méthode B). C'est l'équivalent « facilité » côté Home Assistant.

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
  `ghcr.io/<owner>/foyer-app` (tags `latest`, `1.0.0`, `sha`, et `vX.Y.Z` sur tag Git).

## 📝 Licence

MIT.
