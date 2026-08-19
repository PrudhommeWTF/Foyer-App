<div align="center">

# 🏡 Foyer — la maison, ensemble

**Application de gestion familiale auto-hébergée** : calendrier partagé, listes de courses,
tâches, messagerie, contacts, documents, finances, planning des repas, carnet de recettes,
emplois du temps et gestion du foyer — le tout dans une interface chaleureuse, claire ou sombre.

Angular 21 · Node/Express · SQLite · Docker

</div>

---

## ✨ Fonctionnalités

| Module | Description |
|---|---|
| 🏠 **Accueil** | Tableau de bord du jour : agenda, tâches, dîner, finances, courses, messages. |
| 📅 **Calendrier** | Vues 3 jours / semaine / mois, récurrence, multi-jours, couleur par membre. Superpose **tâches planifiées**, **jours fériés** (FR), **vacances scolaires** (selon l'académie), **anniversaires** (membres & contacts) et **échéances de contrat**. Partage par **flux ICS** (Google/Apple Agenda). |
| 🛒 **Courses** | Multi-listes, rayons, articles cochables, génération depuis le planning repas. |
| ✅ **Tâches** | Multi-listes, priorités, assignation à un membre, échéances, **date de planification** (visible dans le calendrier). |
| 💬 **Messagerie** | Fil de discussion familial, une bulle par membre. |
| ☎️ **Contacts** | Recherche, catégories (Urgences, Santé, École…), contacts d'urgence. |
| 📁 **Documents** | Dossiers, fichiers (upload en data-URL), recherche transverse. |
| 💰 **Finances** | Comptes (courant, professionnel, épargne) avec soldes, opérations filtrables et paginées, catégories à deux niveaux avec budget de référence, **bilan mensuel et annuel** (comparaison au mois précédent, moyenne, douze derniers mois, dépenses par catégorie), alerte de **mois incomplet**, export CSV. **Import de relevés** (CSV, OFX, CAMT.053, .xlsx) avec déduplication, rapport avant validation et annulation en un clic. **Virements internes** proposés, jamais fusionnés d'office. **Règles de catégorisation** ordonnées, avec aperçu avant application. **Biens et contrats** avec échéances de résiliation, coût réel face au montant annoncé et **pièces jointes** (factures, attestations). Données en **tables SQLite dédiées**, pas dans le document d'état. |
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
- Le module **Finances** fait exception : ses données vivent dans des **tables relationnelles
  dédiées** (`fin_*`, même fichier SQLite), servies par `/api/finances/*` avec des opérations
  granulaires. Milliers d'opérations, agrégats côté serveur, pas de « dernier arrivé gagne ».
  Voir [`docs/finances-architecture.md`](docs/finances-architecture.md).
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
de tâches, des catégories de budget). Une base déjà configurée n'est jamais réinitialisée.

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

## 📥 Import de relevés bancaires

Le module Finances lit les exports de votre banque ou de votre agrégateur, et absorbe leurs
défauts habituels plutôt que de vous les laisser sur les bras.

| Format | Détail |
|---|---|
| **CSV / TSV** | séparateur et colonnes reconnus automatiquement (format Bankin' et en-têtes anglais) |
| **OFX** | versions 1.x (SGML) et 2.x (XML) |
| **CAMT.053** | ISO 20022 |
| **.xlsx** | lu sans bibliothèque de tableur |
| **faux .xls** | tableau HTML ou texte tabulé déguisé, cas fréquent des agrégateurs |

Ce que l'import garantit :

- **Déduplication**. Un compte synchronisé par plusieurs connexions apparaît plusieurs fois dans
  le même fichier : les copies sont fusionnées, mais deux opérations réellement identiques le
  même jour sont conservées toutes les deux.
- **Alias de comptes**. Un même compte peut apparaître sous plusieurs libellés (changement de
  nom, seconde connexion) : déclarez-les une fois, c'est mémorisé. Aucun compte n'est créé
  automatiquement. Si le libellé du fichier porte exactement le nom d'un de vos comptes, il est
  **pré-sélectionné** dans le rapport, il ne reste qu'à confirmer.
- **Exports qui se chevauchent**. Réimporter un fichier déjà traité n'ajoute rien ; un export
  incrémental n'apporte que son delta, même si vous renommez ou recatégorisez des opérations
  entre-temps.
- **Rapport avant écriture**. Rien n'est enregistré tant que vous n'avez pas validé, et tout
  import validé s'annule en un clic, sans requête SQL.
- **Virements internes** détectés et **proposés**, avec un niveau de confiance. Jamais fusionnés
  tout seuls : sur des données réelles, deux montants opposés sans rapport se croisent.

Détail du fonctionnement et cahier de recette :
[`docs/finances-cahier-de-recette.md`](docs/finances-cahier-de-recette.md).

## 🏷️ Règles de catégorisation

Les opérations qui reviennent tous les mois se rangent toutes seules. Une règle combine des
critères (libellé, montant, sens, compte, jour du mois, date) en **toutes** ou **au moins une**,
et déclenche des actions : ranger dans une catégorie, réécrire le libellé, poser une étiquette,
marquer comme virement interne.

- **Le montant fait partie des critères**, et c'est souvent lui qui tranche : deux contrats du
  même assureur peuvent porter un libellé bancaire rigoureusement identique, seul le montant les
  distingue. Les montants se comparent en valeur absolue, en euros, des deux côtés : « entre 600
  et 700 » comme « entre -700 et -600 » attrapent le prélèvement de -635,46 €.
- **Les règles sont ordonnées**, évaluées de haut en bas ; la dernière qui décide d'un champ
  l'emporte. Une règle peut porter « arrêter là ».
- **Aperçu avant application** : le bouton « Tester » liste les lignes concernées et ce qui
  changerait, sans rien écrire.
- **Une catégorie corrigée à la main n'est jamais écrasée** par un rejeu, et le rapport dit
  combien de lignes ont été protégées. Une case à cocher permet de lever cette protection quand
  c'est voulu.
- **Supprimer une règle ne défait rien** : les opérations gardent leur catégorie, elles
  repassent simplement en classement manuel.

Les règles tournent aussi à la validation d'un import, sur les seules lignes créées.

## 📄 Biens, contrats et échéances

Un contrat explique des opérations. Déclarez-le une fois, et le module répond à deux questions
qui coûtent cher quand on les oublie.

- **Quand faut-il résilier ?** Renseignez la date de reconduction tacite et le préavis : le
  dernier jour utile pour résilier apparaît dans les échéances, avec le décompte des jours. Un
  contrat reconduit et manqué d'un jour coûte une période de plus.
- **Combien coûte-t-il vraiment ?** Rattachez ses opérations, à la main ou par une règle
  « rattacher au contrat » : le module additionne douze mois glissants et **signale** un
  prélèvement sorti de la fourchette annoncée.

Les contrats se regroupent par **bien** (logement, véhicule), portent leurs **références**
(numéro de police, de client, de compteur) et se passent en « résilié » sans rien perdre de leur
historique. Supprimer un bien libère ses contrats ; supprimer un contrat détache ses opérations
sans les effacer.

**Pièces jointes.** Rangez l'échéancier, l'attestation ou le dernier avis directement sur le
contrat : PDF, JPEG, PNG, WEBP, GIF ou HEIC, 20 Mo au plus. Le type est reconnu **au contenu**,
pas à l'extension. Les fichiers sont écrits sur le disque, à côté de la base, sous leur empreinte
SHA-256 : deux fois la même facture n'occupe qu'un fichier, et une sauvegarde du répertoire de
données reste complète. Au démarrage, l'application compare la base et le disque **dans les deux
sens** et signale tout écart sans jamais rien supprimer d'elle-même.

## 💾 Sauvegarde et restauration

La base est en mode **WAL** : copier `foyer.db` seul pendant que le service tourne donne une
sauvegarde **corrompue**. Deux méthodes sûres.

```bash
# LXC natif : arrêt bref, archive complète du dossier de données
systemctl stop foyer
tar czf /root/foyer-$(date +%F-%H%M).tar.gz -C /var/lib/foyer .
systemctl start foyer

# Docker : instantané cohérent sans arrêt de service
STAMP=$(date +%F-%H%M)
docker compose exec -T foyer node -e "
const db = require('better-sqlite3')('/data/foyer.db');
db.exec(\"VACUUM INTO '/data/foyer-$STAMP.db'\"); db.close();"
docker compose cp foyer:/data/foyer-$STAMP.db ./foyer-$STAMP.db
```

Procédures de restauration, vérification d'une sauvegarde et export CSV en ligne de commande :
[`docs/finances-architecture.md`](docs/finances-architecture.md#12-sauvegarde-et-restauration).

## 📅 Calendrier avancé

- **Vacances scolaires** : choisissez l'**académie** du foyer dans *Paramètres → Général*.
  Les dates officielles sont récupérées auprès de `data.education.gouv.fr` (mises en cache).
  ⚠️ Nécessite un **accès Internet sortant** depuis le serveur ; sans accès, cette couche
  reste simplement vide (aucune erreur bloquante). Les **jours fériés** (France métropolitaine)
  sont calculés localement, sans réseau.
- **Anniversaires** : renseignez la date de naissance des membres (onboarding / gestion de la
  famille) et des contacts pour les voir apparaître chaque année dans le calendrier.
- **Échéances de contrat** : les dates de résiliation et de reconduction saisies dans *Finances →
  Contrats* apparaissent d'elles-mêmes dans le calendrier. Elles n'y sont pas **stockées** :
  changer la date du contrat déplace le repère, sans copie périmée. Le bouton « Tâche » d'une
  échéance en fait une vraie tâche, que vous pouvez cocher et déplacer ; c'est une copie
  ponctuelle et assumée, elle ne suit pas le contrat si sa date change ensuite.
- **Partage ICS** : *Paramètres → Partage du calendrier* fournit une URL `…/api/calendar/feed.ics?token=…`
  (jeton secret) à ajouter dans Google Agenda, Apple Calendrier, etc., en lecture seule. Le flux
  porte les **événements du foyer et les échéances de contrat** à un an, avec un rappel une
  semaine avant chaque date limite de résiliation. Un administrateur peut régénérer le lien
  (invalide l'ancien).

## 🔄 Mises à jour depuis l'interface

*Paramètres → Mises à jour* affiche la version installée et **vérifie** la dernière
version publiée sur GitHub (releases, ou plus haut tag `vX.Y.Z`). Dépôt public → aucun
token requis (sinon `FOYER_GITHUB_TOKEN`).

Sur une installation **LXC native**, le **bouton « Mettre à jour maintenant »**
(télécharge, recompile et redémarre le service) est **activé par défaut**. L'installeur
met en place un **helper root déclenché par un `systemd.path`** : le backend (utilisateur
`foyer`, non privilégié) dépose un fichier déclencheur, et une unité root exécute la mise
à jour puis redémarre le service — **sans sudo**, le durcissement du service reste intact.

Pour **désactiver** l'auto-MAJ (l'app affichera simplement qu'une version est disponible
et rappellera `bash deploy/lxc/update.sh`) :

```bash
SELF_UPDATE=false bash deploy/lxc/install.sh          # dans le conteneur
# ou depuis l'hôte : SELF_UPDATE=false bash deploy/lxc/proxmox-create.sh
```

Un choix explicite est mémorisé dans `/etc/foyer/foyer.env` (`FOYER_SELF_UPDATE`) et
respecté lors des mises à jour suivantes.

Variables : `FOYER_SELF_UPDATE` (`true`/`false`, défaut `true`), `FOYER_GITHUB_REPO`
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
- Tests : `cd backend && npm test` (lanceur intégré à Node 22, aucune dépendance ajoutée).
- Détection de code mort : `cd backend && npm run typecheck`, puis
  `cd frontend && npx tsc -p tsconfig.app.json --noUnusedLocals --noUnusedParameters --noEmit`.

## 🎨 Design

Reconstruit fidèlement depuis le *handoff* de design (haute fidélité) : polices
Bricolage Grotesque / Nunito / Caveat, palette terracotta & sauge, thème clair/sombre,
rayons et ombres définis dans [`frontend/src/styles.scss`](frontend/src/styles.scss).
La maquette de référence est conservée dans [`docs/`](docs/).

## 📦 CI / images

- `.github/workflows/ci.yml` — build backend + frontend, **tests** et détection de code mort à chaque push/PR.
- `.github/workflows/docker.yml` — publie une image **multi-arch** (`amd64`, `arm64`) sur
  `ghcr.io/<owner>/foyer-app` (tags `latest` + `sha` sur la branche par défaut ; `X.Y.Z`
  et `X.Y` sur tag Git `vX.Y.Z`). La version affichée dans l'app provient du tag Git.

## 📝 Licence

MIT.
