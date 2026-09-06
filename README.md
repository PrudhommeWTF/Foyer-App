<div align="center">

# 🏡 Foyer

### La maison, ensemble.

**L'organisation de toute la famille au même endroit, chez vous, sans compte chez personne.**

Calendrier partagé, courses, tâches, budget, repas, recettes, documents, contacts et
emplois du temps, dans une seule application chaleureuse que vous hébergez vous-même.

<br>

![Auto-hébergé](https://img.shields.io/badge/auto--h%C3%A9berg%C3%A9-100%25-E56B4E?style=flat-square)
![Vos données](https://img.shields.io/badge/vos%20donn%C3%A9es-chez%20vous-6E9E5F?style=flat-square)
![Hors ligne](https://img.shields.io/badge/fonctionne-hors%20ligne-4E93B8?style=flat-square)
![Pensé pour la France](https://img.shields.io/badge/pens%C3%A9%20pour-la%20France%20%F0%9F%87%AB%F0%9F%87%B7-9B6FA8?style=flat-square)
![Licence MIT](https://img.shields.io/badge/licence-MIT-F0B24B?style=flat-square)

Angular 21 · Node/Express · SQLite · Docker ou LXC Proxmox

</div>

---

## Pourquoi Foyer ?

Les familles jonglent avec cinq applications qui ne se parlent pas, un agenda partagé qui
fuit vos rendez-vous chez un géant de la publicité, et une liste de courses griffonnée qui
disparaît toujours au mauvais moment. Foyer réunit tout ça dans **une seule application, que
vous installez sur votre serveur, votre NAS ou un conteneur Proxmox**.

- 🔒 **Vos données restent chez vous.** Pas de cloud, pas de pistage, pas d'abonnement. Un
  seul conteneur, une base SQLite dans un volume que vous sauvegardez comme vous voulez.
- 🇫🇷 **Pensé pour une famille française.** Euro, semaine qui commence le lundi, fuseau de
  Paris, jours fériés calculés localement et vacances scolaires selon votre académie. Rien à
  régler, tout est déjà à la bonne place, et l'interface est entièrement en français.
- 🧩 **Les modules se parlent.** Un menu de la semaine remplit la liste de courses, une
  échéance de contrat devient une tâche puis un rappel sur le téléphone, l'emploi du temps
  compte les couverts du dîner. On saisit une fois, ça circule.
- 📴 **Ça marche même sans réseau.** L'application s'ouvre hors ligne, montre le foyer tel
  qu'il était (avec la date, dite en clair) et rejoue vos coches au retour du réseau.
- 👨‍👩‍👧‍👦 **À plusieurs sans se marcher dessus.** Deux téléphones cochent la même liste en même
  temps sans que l'un écrase l'autre. Chaque membre a sa couleur, ses accès, son profil.
- 🌗 **Belle à regarder.** Thème clair ou sombre, palette terracotta et sauge, interface
  responsive du grand écran au téléphone avec barre d'onglets.

## 🚀 En trois minutes

```bash
git clone https://github.com/PrudhommeWTF/Foyer-App.git
cd Foyer-App
# secret de session obligatoire : générez-en un fort dans un fichier .env
echo "FOYER_JWT_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build
```

Ouvrez **http://localhost:8099**. Au premier démarrage, un assistant crée votre foyer, votre
compte administrateur et vos membres. Vous êtes prêt. (Détails : [Premier démarrage](#-premier-démarrage--onboarding).)

> Pas envie de compiler ? Une image multi-arch préconstruite (`amd64`, `arm64`) est publiée à
> chaque version : voir [Image préconstruite](#image-préconstruite-sans-build).

## ✨ Ce que Foyer sait faire

| Module | En bref |
|---|---|
| 🏠 **Accueil** | Le tableau de bord du jour : agenda, tâches dues aujourd'hui, dîner et couverts, courses, finances, anniversaires, échéances. Les gestes du quotidien se font ici (cocher, reporter, ajouter une ligne), avec annulation de quelques secondes. L'ordre des tuiles suit le moment de la journée et le type de jour (école, week-end, vacances). [Détails](docs/accueil-contrat-de-tuile.md) |
| 📅 **Calendrier** | Vues 3 jours, semaine et mois, récurrence, couleur par membre. Superpose tâches planifiées, jours fériés, vacances scolaires, anniversaires et échéances de contrat. Partage en lecture seule par flux **ICS** (Google Agenda, Apple Calendrier). |
| 🛒 **Courses** | Multi-listes, rayons réordonnables à l'ordre de votre magasin, coche en un tap, articles pris regroupés en bas. Génération automatique depuis le menu de la semaine, avec un rapport avant d'écrire. Export CSV. Écriture article par article : coche à plusieurs et hors ligne sans conflit. [Détails](docs/cuisine-architecture.md) |
| ✅ **Tâches** | Saisie en un champ, affectation à un, plusieurs ou aucun membre, récurrence native (à date fixe ou après réalisation), sous-tâches, modèles, listes typées (corvées, checklists) et vue « À moi ». **Rappels sur le téléphone (Web Push)**, réglés tâche par tâche. Reliée au reste : contrats, documents, courses, emploi du temps et agenda. [Détails](docs/taches.md) |
| 💰 **Finances** | Comptes multi-titulaires, opérations catégorisées, bilan mensuel et annuel, budgets de référence. **Import de relevés** (CSV, OFX, CAMT.053, xlsx) avec déduplication et rapport avant validation. Règles de catégorisation, crédits, biens et contrats avec échéances de résiliation, relevés de compteur, pistes d'économies. [Détails](docs/finances-architecture.md) |
| 🍽️ **Repas** | Déjeuner et dîner (petit-déjeuner en option) sur 3 ou 7 jours, grille sur écran, pile de jours sur téléphone. Plusieurs plats par créneau, couverts par repas, déplacement par glisser-déposer, recopie d'une période sur une autre, mise à l'agenda des repas avec invités. |
| 📖 **Recettes** | Carnet avec photos, ingrédients et étapes. **Import depuis l'adresse d'une page de recette** (Marmiton, 750g, Cuisine AZ, blogs) par lecture des données structurées. Recherche en une ligne (« courgette 20min végétarien »), notes de la famille, étiquettes, export et réimport JSON. [Détails](docs/cuisine-architecture.md) |
| 🗓️ **Emploi du temps** | La semaine type du foyer, un créneau pour un ou plusieurs membres. Copie de journée, récurrence sobre avec période de validité et filtre période scolaire/vacances. Alimente les couverts du planning repas. [Détails](docs/emploi-du-temps.md) |
| 🥗 **Contraintes alimentaires** | Allergènes (liste européenne) et aliments refusés par membre. Les recettes affichent leurs allergènes et à qui elles ne conviennent pas ; le planning signale le créneau en cause. Honnête sur ses limites : un ingrédient non reconnu n'est pas vérifié, et l'interface le dit. |
| 💬 **Messagerie · ☎️ Contacts · 📁 Documents** | Un fil de discussion familial, un carnet de contacts (urgences, santé, école) et des dossiers de documents rangés sur le disque (tous formats), avec recherche transverse. |
| ⚙️ **Paramètres** | Thème, membres et accès, rappels sur cet appareil, partage du calendrier, mises à jour. [Registre complet](docs/parametres.md) |

Chaque membre a sa couleur d'identité. Thème clair/sombre synchronisé. Interface responsive
(bureau et mobile avec barre d'onglets).

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
  (`GET/PUT /api/state`), avec authentification **JWT** (mots de passe **bcrypt**, second
  facteur **TOTP** en option). Un seul conteneur, idéal pour l'auto-hébergement.
- Le document s'écrit avec **contrôle de version** : un client annonce la version sur
  laquelle il a travaillé, le serveur refuse (409) d'écrire par-dessus plus récent et lui
  renvoie son document, le client y **rejoue** ses modifications et réessaie. À deux sur
  l'application, personne ne perd son travail parce que l'autre a enregistré une seconde plus tôt.
- Le module **Finances** fait exception : ses données vivent dans des **tables relationnelles
  dédiées** (`fin_*`, même fichier SQLite), servies par `/api/finances/*` avec des opérations
  granulaires. Milliers d'opérations, agrégats côté serveur, pas de « dernier arrivé gagne ».
  Voir [`docs/finances-architecture.md`](docs/finances-architecture.md).
- La **liste de courses** et les **tâches** restent dans le document, mais s'écrivent
  **article par article** et **tâche par tâche** (`/api/shopping/ops`, `/api/tasks/ops`) :
  `PUT /api/state` ignore ces champs et conserve ceux du serveur. Deux personnes cochent en
  même temps sans que l'une écrase l'autre, et les coches faites hors ligne sont rejouées au
  retour du réseau. Un seul sondage (`GET /api/live`) rafraîchit les deux. Voir [`docs/taches.md`](docs/taches.md).
- **Hors ligne à froid.** Un service worker garde la coquille de l'application, et le dernier
  document lu est gardé dans IndexedDB : Foyer **s'ouvre sans réseau**, montre le foyer tel
  qu'il était (avec la date, dite en clair), accepte les coches et les envoie au retour du
  réseau. Le cache ne fige pas la version : le HTML d'entrée passe par le réseau d'abord, donc
  une mise à jour est prise au premier chargement en ligne. Voir [`docs/hors-ligne.md`](docs/hors-ligne.md).
- Les **fichiers** (pièces jointes Finances, photos de recettes, documents du foyer) vivent
  sur le disque dans `<données>/pieces`, adressés par leur empreinte, jamais en base64 dans le
  document. `PUT /api/state` accepte donc au plus **4 Mo** : aucun octet de fichier n'y transite.
  Voir [`docs/cuisine-architecture.md`](docs/cuisine-architecture.md).
- Le **frontend** est une SPA. Toute la logique métier (dérivés budget, récurrence agenda,
  génération de courses) est portée fidèlement depuis la maquette de design.
- L'app utilise un `base href` **relatif** : un seul build fonctionne servi à la racine ou
  derrière un reverse-proxy sur un sous-chemin.

## 🚀 Démarrage rapide (Docker Compose)

```bash
git clone https://github.com/PrudhommeWTF/Foyer-App.git
cd Foyer-App
# secret de session obligatoire : générez-en un fort dans un fichier .env
echo "FOYER_JWT_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build
```

➡️ Ouvrez **http://localhost:8099**. **Au premier démarrage**, l'assistant de configuration
s'ouvre : il crée votre foyer, votre compte administrateur (email + mot de passe), les membres
et vos préférences. Voir [Premier démarrage](#-premier-démarrage--onboarding).

### Image préconstruite (sans build)

Une image multi-arch (`amd64`, `arm64`) est publiée par la CI. Décommentez la ligne `image:`
dans `docker-compose.yml`, ou lancez directement :

```bash
# Le port n'est publié que sur la boucle locale : mettez votre reverse-proxy devant.
# Sans proxy sur cette machine, remplacez par -p 8099:8099 ET ajoutez
# -e FOYER_TRUST_PROXY=false, sinon la temporisation des tentatives de connexion
# devient contournable.
docker run -d --name foyer -p 127.0.0.1:8099:8099 -v foyer-data:/data \
  -e FOYER_JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/prudhommewtf/foyer-app:latest
```

### Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port d'écoute | `8099` |
| `FOYER_DATA_DIR` | Dossier de la base SQLite | `./data` (ou `/data` en conteneur) |
| `FOYER_JWT_SECRET` | Secret de signature des sessions (≥ 16 caractères aléatoires), **obligatoire** : en `NODE_ENV=production`, un secret absent ou faible **empêche le démarrage** ; sinon un secret éphémère est généré (sessions perdues au redémarrage) | _(aucun)_ |
| `FOYER_CORS_ORIGINS` | Origines cross-origin autorisées (liste séparée par des virgules) ; laissez vide en mono-conteneur (l'API sert sa propre app) | _(aucune)_ |
| `FOYER_BIND` | Interface d'écoute. Posez `127.0.0.1` quand un reverse-proxy tourne sur la même machine : le service n'est alors joignable que par lui | `0.0.0.0` |
| `FOYER_TRUST_PROXY` | Combien de maillons de proxy croire pour `X-Forwarded-For`. `false` quand il n'y a aucun proxy devant : l'adresse vue est celle de la connexion, et personne ne peut se faire passer pour une autre | `1` |
| `FOYER_RECIPE_IMPORT` | Autoriser l'import d'une recette depuis une URL, seule requête sortante du module Cuisine (`true`/`false`). Réglable depuis l'application ; cette variable l'emporte quand elle est posée | _(réglage du foyer)_ |
| `FOYER_VAPID_PUBLIC` / `FOYER_VAPID_PRIVATE` | Paire de clés des rappels Web Push. Sans elles, une paire est générée au premier démarrage et gardée en base (en changer invalide tous les abonnements) | _(générées)_ |
| `FOYER_VAPID_SUBJECT` | Contact déclaré au service push (`mailto:` ou `https:`). Une adresse locale est refusée par Apple (403 `BadJwtToken`) : elle est donc écartée au démarrage, avec un message dans le journal. Sans variable, c'est l'adresse publique du foyer (Paramètres → Notifications) qui sert de contact, et à défaut le dépôt du projet | _(adresse publique du foyer)_ |
| `FOYER_PUBLIC_URL` | Adresse ouverte au tap sur une notification. Réglable depuis l'application ; cette variable l'emporte quand elle est posée | _(réglage du foyer)_ |

La liste complète des réglages, leur portée et le module qui les consomme est engendrée depuis
le registre : [`docs/parametres.md`](docs/parametres.md). Les valeurs de déploiement ci-dessus
sont aussi visibles en lecture seule dans l'application (Paramètres → Serveur et déploiement),
pour savoir ce qui s'applique sans ouvrir un terminal.

La base SQLite vit dans le volume `foyer-data` (`/data`) et **persiste** entre les redémarrages
et les mises à jour de l'image.

## 🚀 Premier démarrage / onboarding

Au tout premier lancement (base de données vide), Foyer affiche un **assistant de configuration**
en 6 étapes :

1. **Bienvenue** · 2. **Nom du foyer** · 3. **Votre profil** (prénom, rôle, couleur, **email +
mot de passe** de l'administrateur) · 4. **Membres** du foyer · 5. **Préférences** (thème clair
ou sombre) · 6. **Récapitulatif**.

À la validation, le compte administrateur et le foyer sont créés, et vous entrez directement
dans l'application. Les écrans démarrent vierges (prêts à être remplis), avec quelques réglages
par défaut (rayons de courses, une liste de courses, une liste de tâches, des catégories de
budget). Une base déjà configurée n'est jamais réinitialisée.

> 🔒 **Avant d'exposer publiquement** : définissez un `FOYER_JWT_SECRET` fort (en production,
> l'app **refuse de démarrer** sans secret solide) et changez le mot de passe admin. Il n'y a
> pas d'inscription libre : un accès s'ouvre depuis la fiche d'un membre, par un administrateur.
> Placez l'app derrière HTTPS (reverse-proxy type Caddy, Traefik, Nginx), voir
> [Derrière un reverse-proxy](#-derrière-un-reverse-proxy), et déroulez
> [la checklist de mise en ligne](docs/mise-en-ligne-checklist.md).

### 🛡️ Sécurité pensée pour l'auto-hébergement

- **En-têtes HTTP** durcis via [helmet](https://helmetjs.github.io/) (CSP,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`). La CSP autorise les polices
  Google et les images `data:`/`blob:`.
- **Limitation de débit** sur les points d'authentification (`/auth/login`, `/auth/register`,
  `/setup`) pour freiner le brute-force (30 tentatives / 15 min / IP).
- **CORS restreint** : aucune origine cross-origin par défaut (l'API sert sa propre SPA) ;
  ouvrez-en au besoin via `FOYER_CORS_ORIGINS`.
- **Secret JWT obligatoire** : un secret absent, trop court ou trop connu bloque le démarrage
  en production.
- **Révocation des sessions** : changer le mot de passe d'un membre (ou supprimer son compte)
  invalide immédiatement tous ses jetons existants.
- **Autorisations** : seul un administrateur peut ajouter ou retirer un membre ou modifier des
  droits d'administration ; un membre non-admin ne peut éditer que son propre profil. Un compte
  enfant n'entre ni dans les Finances, ni dans les Documents, ni dans les Paramètres.
- **Second facteur (TOTP)** : un code à six chiffres en plus du mot de passe, compatible avec
  toutes les applications d'authentification (Aegis, Google Authenticator, 1Password,
  Bitwarden). Facultatif, compte par compte, à poser depuis Paramètres → Mon compte. Dix codes
  de secours, et un administrateur peut retirer la protection d'un membre qui a perdu son
  téléphone. Aucun service tiers : le calcul est local.
- **Pas d'inscription libre** : un accès s'ouvre depuis la fiche d'un membre, par un administrateur.

L'audit de sécurité et les risques acceptés sont documentés dans
[`docs/audit-securite.md`](docs/audit-securite.md), [`docs/exploitation-securite.md`](docs/exploitation-securite.md)
et [`docs/risques-acceptes.md`](docs/risques-acceptes.md).

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

- **Déduplication.** Un compte synchronisé par plusieurs connexions apparaît plusieurs fois
  dans le même fichier : les copies sont fusionnées, mais deux opérations réellement identiques
  le même jour sont conservées toutes les deux.
- **Alias de comptes.** Un même compte peut apparaître sous plusieurs libellés : déclarez-les
  une fois, c'est mémorisé. Aucun compte n'est créé automatiquement.
- **Exports qui se chevauchent.** Réimporter un fichier déjà traité n'ajoute rien ; un export
  incrémental n'apporte que son delta.
- **Rapport avant écriture.** Rien n'est enregistré tant que vous n'avez pas validé, et tout
  import validé s'annule en un clic, sans requête SQL.
- **Virements internes** détectés et **proposés**, avec un niveau de confiance. Jamais fusionnés
  tout seuls : sur des données réelles, deux montants opposés sans rapport se croisent.

Le détail du fonctionnement, les règles de catégorisation, les biens et contrats, les relevés de
compteur et les pistes d'économies sont documentés dans
[`docs/finances-architecture.md`](docs/finances-architecture.md) et son cahier de recette
[`docs/finances-cahier-de-recette.md`](docs/finances-cahier-de-recette.md).

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
[`docs/sauvegarde-restauration.md`](docs/sauvegarde-restauration.md) et
[`docs/finances-architecture.md`](docs/finances-architecture.md#14-sauvegarde-et-restauration).

Le document d'état est migré au démarrage lorsque sa forme change. Une **copie du document
d'origine** est écrite dans `<données>/backups/` avant toute transformation.

## 📅 Calendrier partagé et flux ICS

- **Vacances scolaires** : choisissez l'**académie** du foyer dans *Paramètres → Général*. Les
  dates officielles sont récupérées auprès de `data.education.gouv.fr` (mises en cache).
  ⚠️ Nécessite un **accès Internet sortant** depuis le serveur ; sans accès, cette couche reste
  simplement vide (aucune erreur bloquante). Les **jours fériés** (France métropolitaine) sont
  calculés localement, sans réseau.
- **Anniversaires** : renseignez la date de naissance des membres et des contacts pour les voir
  apparaître chaque année dans le calendrier.
- **Échéances de contrat** : les dates de résiliation et de reconduction saisies dans *Finances
  → Contrats* apparaissent d'elles-mêmes dans le calendrier, sans copie périmée.
- **Partage ICS** : *Paramètres → Partage du calendrier* fournit une URL
  `…/api/calendar/feed.ics?token=…` (jeton secret) à ajouter dans Google Agenda, Apple
  Calendrier, etc., en lecture seule. Un administrateur peut régénérer le lien (invalide l'ancien).

## 🔄 Mises à jour depuis l'interface

*Paramètres → Mises à jour* affiche la version installée et **vérifie** la dernière version
publiée sur GitHub. Dépôt public, aucun token requis (sinon `FOYER_GITHUB_TOKEN`).

Sur une installation **LXC native**, le bouton **« Mettre à jour maintenant »** (télécharge,
recompile et redémarre le service) est **activé par défaut** : l'installeur met en place un
helper root déclenché par un `systemd.path`, si bien que le backend non privilégié n'a jamais
besoin de `sudo` et le durcissement du service reste intact. En Docker, l'écran rappelle
`docker compose pull`. La **disponibilité** d'une nouvelle version s'affiche dans tous les cas.

*Paramètres → Exploitation → Mises à jour* propose de suivre les **versions stables** (par
défaut) ou d'inclure les **préversions** pour essayer ce qui vient avant tout le monde.

Le fonctionnement complet de l'auto-mise à jour, sa désactivation (`SELF_UPDATE=false`), le
helper qui se met à jour lui-même et le diagnostic sont détaillés dans
[`deploy/README.md`](deploy/README.md).

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

## 🌐 Derrière un reverse-proxy

**Foyer ne fait pas de TLS.** Il écoute en clair sur `0.0.0.0:8099` ; c'est le proxy qui termine
le HTTPS et joint le conteneur en **`http://`**. Un `proxy_pass https://…` vers Foyer donne un
502 immédiat, et c'est l'erreur la plus fréquente juste après la mise en place d'un certificat.

Rien n'est à configurer côté Foyer : `trust proxy` est déjà actif, et `FOYER_CORS_ORIGINS` ne
sert pas ici (l'application et son API sont sur la même origine).

### nginx

```nginx
server {
    server_name foyer.exemple.fr;

    # /api/state accepte 4 Mo et l'envoi d'un fichier 20 Mo : la valeur par
    # défaut de 1 Mo ferait échouer le dépôt d'un scan, en 413.
    client_max_body_size 20m;

    location / {
        proxy_pass http://IP_DU_CONTENEUR:8099;   # http, jamais https
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Une mise à jour depuis l'interface télécharge, recompile et redémarre :
        # un délai court couperait la requête en plein travail.
        proxy_read_timeout 300s;
    }
}
```

Le proxy ne doit pas réécrire `Cache-Control` : Foyer distingue déjà les fichiers empreints
(gardés un an) de `index.html` (jamais gardé), et écraser cette distinction ferait réapparaître
d'anciennes versions sur les téléphones.

### Nginx Proxy Manager

Trois champs, et trois façons de se tromper :

| Champ | Valeur | Erreur classique |
|---|---|---|
| Scheme | `http` | `https` : 502 immédiat, Foyer ne fait pas de TLS |
| Forward Hostname / IP | l'IP seule, `10.0.0.42` | y recopier `http://`, que NPM ajoute lui-même |
| Forward Port | `8099` | laisser `80`, proposé par défaut |

Dans l'onglet *Advanced* : `client_max_body_size 20m;`. Le diagnostic pas à pas d'un 502 est dans
[`deploy/README.md`](deploy/README.md).

## 🧑‍💻 Développement

```bash
npm run install:all          # installe backend + frontend
npm run dev:backend          # API sur :8099 (tsx watch, rechargement)
npm run dev:frontend         # Angular sur :4200 (proxy /api → :8099)
```

- Frontend : `frontend/` (`ng serve`, composants standalone + signals).
- Backend : `backend/` (`npm run dev`).
- Build de production : `npm run build` (backend `dist/` + frontend `dist/`).
- Tests : `cd backend && npm test` (lanceur intégré à Node, aucune dépendance ajoutée).
- Détection de code mort : `cd backend && npm run typecheck`, puis
  `cd frontend && npx tsc -p tsconfig.app.json --noUnusedLocals --noUnusedParameters --noEmit`.

Les conventions de code et de contribution sont dans [`CLAUDE.md`](CLAUDE.md).

## 🎨 Design

Reconstruit fidèlement depuis le *handoff* de design (haute fidélité) : polices Bricolage
Grotesque / Nunito / Caveat, palette terracotta et sauge, thème clair/sombre, rayons et ombres
définis dans [`frontend/src/styles.scss`](frontend/src/styles.scss). La maquette de référence est
conservée dans [`docs/`](docs/).

## 📚 Documentation

| Sujet | Document |
|---|---|
| Accueil (contrat de tuile, contexte) | [`docs/accueil-contrat-de-tuile.md`](docs/accueil-contrat-de-tuile.md), [`docs/accueil-contexte.md`](docs/accueil-contexte.md) |
| Tâches (récurrence, rappels, hors ligne) | [`docs/taches.md`](docs/taches.md), [`docs/taches-notifications.md`](docs/taches-notifications.md) |
| Cuisine (recettes → repas → courses) | [`docs/cuisine-architecture.md`](docs/cuisine-architecture.md) |
| Finances (architecture et cahier de recette) | [`docs/finances-architecture.md`](docs/finances-architecture.md), [`docs/finances-cahier-de-recette.md`](docs/finances-cahier-de-recette.md) |
| Emploi du temps | [`docs/emploi-du-temps.md`](docs/emploi-du-temps.md) |
| Hors ligne | [`docs/hors-ligne.md`](docs/hors-ligne.md) |
| Paramètres (registre) | [`docs/parametres.md`](docs/parametres.md) |
| Sécurité et mise en ligne | [`docs/audit-securite.md`](docs/audit-securite.md), [`docs/mise-en-ligne-checklist.md`](docs/mise-en-ligne-checklist.md) |
| Sauvegarde et restauration | [`docs/sauvegarde-restauration.md`](docs/sauvegarde-restauration.md) |
| Déploiement et exploitation | [`deploy/README.md`](deploy/README.md) |

## 📦 CI / images

- `.github/workflows/ci.yml` : build backend + frontend, **tests** et détection de code mort à
  chaque push/PR.
- `.github/workflows/docker.yml` : publie une image **multi-arch** (`amd64`, `arm64`) sur
  `ghcr.io/<owner>/foyer-app` (tags `latest` + `sha` sur la branche par défaut ; `X.Y.Z` et
  `X.Y` sur un tag Git de version). La version affichée dans l'app provient du tag Git.

## 📝 Licence

MIT.
