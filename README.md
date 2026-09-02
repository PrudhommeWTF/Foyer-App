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
| 🏠 **Accueil** | Tableau de bord du jour : agenda, tâches, dîner, finances, courses, messages. Chaque tuile est fournie par son module et distingue quatre états : chargement, donnée, **rien à afficher** et **panne** (avec sa cause et un « Réessayer »). Une tuile en erreur n'empêche pas les autres de fonctionner, et aucune n'affiche `0` à la place d'une valeur inconnue. La journée montre aussi fériés, vacances scolaires, anniversaires et échéances ; les tâches, ce qui est dû **aujourd'hui** ; le dîner, les couverts et les **alertes alimentaires**. S'y ajoutent l'emploi du temps du jour, les **échéances de contrat** (une résiliation manquée coûte une année), les **relevés de compteur attendus** et les pistes d'économies ouvertes. Un module jamais servi propose son geste de démarrage plutôt qu'un zéro. **Les gestes du quotidien se font depuis l'accueil** : cocher, reporter à demain, créer une tâche ou un article en une ligne, remplacer le dîner, saisir un relevé ou une dépense en espèces, avec **annulation** de quelques secondes sur tout ce qui disparaît. L'ordre des tuiles suit le **moment de la journée et le type de jour** (école, week-end, vacances, férié), selon des règles tenues dans un fichier modifiable sans recompiler ; une tuile déclassée est repliée, jamais retirée, et dit pourquoi elle a bougé. Voir `docs/accueil-contrat-de-tuile.md` et `docs/accueil-contexte.md`. |
| 📅 **Calendrier** | Vues 3 jours / semaine / mois, récurrence, multi-jours, couleur par membre. Superpose **tâches planifiées**, **jours fériés** (FR), **vacances scolaires** (selon l'académie), **anniversaires** (membres & contacts) et **échéances de contrat**. Partage par **flux ICS** (Google/Apple Agenda). |
| 🛒 **Courses** | Multi-listes, rayons **réordonnables** (l'ordre des allées de votre magasin), coche **en un tap**, trois états (à prendre, dans le panier, indisponible), articles pris regroupés en bas, suggestions dès les premières lettres, génération depuis le planning repas, **export CSV** lisible par un tableur français, **tâche « faire les courses »** qui ouvre la liste et compte ce qui reste à prendre. **Écriture article par article** : deux téléphones peuvent cocher en même temps sans que l'un écrase l'autre, et les coches faites **hors ligne** repartent au retour du réseau. **Génération depuis les repas** : les ingrédients de la semaine sont lus, additionnés, mis à l'échelle des couverts et rangés par rayon, avec un **rapport affiché avant d'écrire** (à ajouter, à compléter, à retirer, écarté comme fond de placard, non reconnu). Une régénération ne défait jamais un ajout manuel ni un article déjà coché. **« J'ai déjà ça »** : un geste sur une ligne du rapport l'écarte et retient la date ; l'article revient tout seul au bout de trois semaines, et le recocher efface la note. Pas d'inventaire à tenir. |
| ✅ **Tâches** | Multi-listes, priorités, assignation à un membre, échéances, **date de planification** (visible dans le calendrier). |
| 💬 **Messagerie** | Fil de discussion familial, une bulle par membre. |
| ☎️ **Contacts** | Recherche, catégories (Urgences, Santé, École…), contacts d'urgence. |
| 📁 **Documents** | Dossiers colorés, fichiers, recherche transverse. Les **fichiers sont stockés sur le disque** (jamais dans le document d'état, qui repartait en entier à chaque enregistrement), et téléchargés avec la session : un PDF ou une image s'ouvre dans l'onglet, le reste est proposé à l'enregistrement. **Tous les formats sont acceptés**, y compris ceux que le serveur ne sait pas nommer. Supprimer une fiche rend les octets au disque tout de suite. |
| 💰 **Finances** | Comptes (courant, professionnel, épargne, **crédit**) avec **un ou plusieurs titulaires** et soldes, opérations filtrables et paginées, catégories à deux niveaux avec budget de référence, **bilan mensuel et annuel** (comparaison au mois précédent, moyenne, douze derniers mois, dépenses par catégorie), alerte de **mois incomplet**, export CSV. **Import de relevés** (CSV, OFX, CAMT.053, .xlsx) avec déduplication, rapport avant validation et annulation en un clic. **Virements internes** proposés, jamais fusionnés d'office. **Règles de catégorisation** ordonnées, avec aperçu avant application. **Crédits immobiliers et à la consommation** : quatre chiffres de l'offre de prêt suffisent, capital restant dû, échéancier, date de fin et intérêts de l'année se calculent. **Biens et contrats** avec échéances de résiliation, coût réel face au montant annoncé et **pièces jointes** (factures, attestations). **Relevés de compteur** avec consommation par jour et comparaison à l'an dernier. **Pistes d'économies** chiffrées. **Sauvegarde du module** en un fichier JSON. Données en **tables SQLite dédiées**, pas dans le document d'état. |
| 🍽️ **Repas** | Déjeuner et dîner (petit-déjeuner en option dans *Paramètres → Repas*), en **fenêtre de 3 jours ou de 7 jours**. **Grille sur grand écran, pile de jours sur téléphone** : chaque créneau est une ligne pleine largeur, rien ne défile latéralement, et la semaine s'ouvre sur le jour même. La génération des courses suit la fenêtre affichée. **Recopie d'une période sur une autre** : compléter sans rien détruire, ou remplacer, avec un rapport affiché avant écriture. **Déplacement d'un repas** : glisser-déposer sur grand écran, choix du créneau sur téléphone ; un créneau occupé échange son repas, et l'événement d'agenda suit. **Plusieurs plats par créneau** : entrée, plat, dessert se choisissent séparément, chacun étant une recette du carnet ou un texte libre. **Couverts par créneau** : les quantités de la liste de courses suivent le nombre de convives. **Repas à l'agenda** en un bouton, pour les repas avec invités : l'événement porte le menu et les couverts, se met à jour plutôt que de se dupliquer, et disparaît avec le repas. |
| 📖 **Recettes** | Carnet avec photos, ingrédients & étapes dynamiques, portions et temps de préparation/cuisson. **Import depuis l'adresse d'une page de recette** (Marmiton, 750g, Cuisine AZ, blogs…) par lecture des données structurées `schema.org/Recipe` : titre, portions, durées, ingrédients, étapes et photo remplissent le formulaire, que vous relisez avant d'enregistrer. Les **photos sont stockées sur le disque** (jamais dans le document d'état, qui repartait en entier à chaque enregistrement). **Export et réimport du carnet en JSON**, photos comprises : une recette déjà présente n'est pas dupliquée, et le rapport s'affiche avant d'ajouter quoi que ce soit. **Copie d'une recette en texte**, prête à coller dans un message. **Reprise des ingrédients non reconnus** : un écran liste les formes que le lecteur n'a rattachées à aucun article, de la plus fréquente à la plus rare, avec les recettes où elles apparaissent. Deux gestes, rattacher à un article connu ou créer l'article manquant (rayon, allergènes, fond de placard), et le **taux de rattachement bouge sous les yeux**. Rien n'est rattaché automatiquement : un rattachement faux se propagerait à tout le carnet sans que personne le remarque. |
| 🗓️ **Emploi du temps** | La semaine type du foyer. Un créneau porte **un ou plusieurs membres** : la messe du dimanche ou un trajet en voiture font une ligne, pas quatre. **Sans filtre, la vue montre tout le foyer** ; chaque créneau porte la pastille et les initiales des personnes concernées, le débordement étant compté au-delà de trois. Le filtre par membre est un affinage à sélection multiple, visible en permanence tant qu'il est actif et effaçable en un geste. Vue jour sur téléphone, semaine sur écran large, en listes triées par heure : les créneaux qui se chevauchent restent lisibles. Une suppression s'annule. Voir [`docs/emploi-du-temps.md`](docs/emploi-du-temps.md). |
| 🔎 **Retrouver une recette** | Une seule ligne : « courgette 20min végétarien 4 étoiles ». Les mots sont cherchés dans le nom, les **étiquettes** et les **ingrédients rattachés** (« pomme de terre » trouve « 4 patates »). Une durée demandée écarte les recettes qui ne disent pas la leur. **Note de la famille**, **étiquettes libres** et **date de la dernière fois** sur chaque fiche. **Import d'une recette collée en texte**, lu dans le navigateur, qui dit ce qu'il n'a pas su faire. |
| 💡 **Aide à la composition** | **Semaine type des convives** : on coche les repas qu'un membre ne prend pas à la maison, et les couverts (donc les quantités de courses) suivent, créneau par créneau. Dérogation ponctuelle en un tap dans la modale d'un repas. **Suggestions explicables** pour un créneau vide : « jamais encore faite », « pas faite depuis trois semaines », « 2 ingrédients déjà sur la liste », « prête en 15 min ». Jamais un score opaque, aucun appel à un service extérieur. **Anti-répétition sur quinze jours**, et les recettes qui ne conviennent pas à un convive attendu sont écartées, en le disant. |
| 🥗 **Contraintes alimentaires** | Allergènes (liste européenne) et aliments refusés **par membre**. Les recettes affichent leurs allergènes, dérivés du référentiel, et **à qui elles ne conviennent pas** ; le planning signale le créneau en cause. Un ingrédient que l'application n'a pas su reconnaître n'est **pas** vérifié, et l'interface le dit : l'absence d'alerte ne vaut pas garantie. |
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
- Le document s'écrit avec **contrôle de version** : un client annonce la version sur
  laquelle il a travaillé, le serveur refuse (409) d'écrire par-dessus plus récent et lui
  renvoie son document, le client y **rejoue** ses modifications et réessaie. À deux sur
  l'application, personne ne perd son travail parce que l'autre a enregistré une seconde
  plus tôt.
- Le module **Finances** fait exception : ses données vivent dans des **tables relationnelles
  dédiées** (`fin_*`, même fichier SQLite), servies par `/api/finances/*` avec des opérations
  granulaires. Milliers d'opérations, agrégats côté serveur, pas de « dernier arrivé gagne ».
  Voir [`docs/finances-architecture.md`](docs/finances-architecture.md).
- La **liste de courses** reste dans le document, mais s'écrit **article par article**
  (`/api/shopping/ops`) : `PUT /api/state` ignore ce champ et conserve celui du serveur.
  Deux personnes cochent en même temps sans que l'une écrase l'autre, et les coches faites
  hors ligne sont rejouées au retour du réseau.
- Les **fichiers** (pièces jointes Finances, photos de recettes, documents du foyer) vivent
  sur le disque dans `<données>/pieces`, adressés par leur empreinte, jamais en base64 dans
  le document. `PUT /api/state` accepte donc au plus **4 Mo** : aucun octet de fichier n'y
  transite.
  Voir [`docs/cuisine-architecture.md`](docs/cuisine-architecture.md).
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
| `FOYER_RECIPE_IMPORT` | Autoriser l'import d'une recette depuis une URL, seule requête sortante du module Cuisine (`true`/`false`) | `true` |

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
> `FOYER_ALLOW_SIGNUP=false`. Placez l'app derrière HTTPS (reverse-proxy type Caddy / Traefik / Nginx),
> voir [Derrière un reverse-proxy](#-derrière-un-reverse-proxy).

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

**Sauvegarde du seul module Finances** : l'onglet Import propose un export JSON (comptes,
opérations, contrats, règles) et sa restauration. Utile pour rejouer une manipulation qui a mal
tourné ou déménager les finances, sans toucher au reste du foyer. Ce n'est **pas** une sauvegarde
complète : les pièces jointes restent sur le disque, et la sauvegarde du fichier SQLite reste la
référence. La restauration écrase, en tout ou rien, et refuse une sauvegarde produite par une
version plus récente.

Depuis la fiche d'un contrat, le bouton **« Créer une règle pour ce contrat »** ouvre l'éditeur
pré-rempli avec le fournisseur et la fourchette de montant, ce qui suffit à distinguer deux
contrats du même assureur.

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

Les contrats se regroupent par **bien** (logement, véhicule), désignent **une ou plusieurs
personnes** du foyer (une mutuelle couvre souvent toute la famille), portent leurs **références**
(numéro de police, de client, de compteur) et se passent en « résilié » sans rien perdre de leur
historique. Supprimer un bien libère ses contrats ; supprimer un contrat détache ses opérations
sans les effacer.

**Pièces jointes.** Rangez l'échéancier, l'attestation ou le dernier avis directement sur le
contrat : PDF, JPEG, PNG, WEBP, GIF ou HEIC, 20 Mo au plus. Le type est reconnu **au contenu**,
pas à l'extension. Les fichiers sont écrits sur le disque, à côté de la base, sous leur empreinte
SHA-256 : deux fois la même facture n'occupe qu'un fichier, et une sauvegarde du répertoire de
données reste complète. Au démarrage, l'application compare la base et le disque **dans les deux
sens** et signale tout écart sans jamais rien supprimer d'elle-même.

## ⚡ Relevés de compteur

Sur un contrat de type **Énergie**, notez l'index du compteur de temps en temps. Deux relevés
suffisent : le module en tire une **consommation par jour**, la seule grandeur comparable entre
des relevés espacés différemment, et la compare à **la même période un an plus tôt**. Comparer au
mois précédent ne dirait rien d'un foyer qui se chauffe.

Index simple ou heures pleines et creuses, au choix. Si vous préférez recopier la consommation
depuis la facture, elle fait foi et aucune soustraction n'est tentée. Le montant de la période est
facultatif, il sert à calculer le prix du kWh.

Ce qui n'est pas mesurable n'est pas affiché : un index inférieur au précédent est signalé comme
un **compteur probablement remplacé**, pas comme une consommation négative.

## 💡 Pistes d'économies

Une piste est une intention chiffrée : « renégocier l'assurance habitation, 240 € par an ».
L'écran Contrats en tient la liste, sépare **ce qu'il reste à aller chercher** de **ce qui est
déjà obtenu**, et permet d'en faire une tâche en un clic. Une piste abandonnée ne compte nulle
part : un total gonflé par ce qui ne se fera jamais ne sert à rien.

Le gain reste une **estimation**. C'est le coût réel du contrat, une fois la piste appliquée, qui
dira ce qu'elle a vraiment rapporté.

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
[`docs/finances-architecture.md`](docs/finances-architecture.md#14-sauvegarde-et-restauration).

Le document d'état est migré au démarrage lorsque sa forme change. Une **copie du
document d'origine** est écrite dans `<données>/backups/` avant toute
transformation, et la procédure de retour en arrière est dans
[`docs/cuisine-architecture.md`](docs/cuisine-architecture.md#migrations-du-document-détat).

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
(défaut `PrudhommeWTF/Foyer-App`), `FOYER_GITHUB_TOKEN` (optionnel, requis pour un
dépôt privé : il sert aussi bien à la vérification qu'au téléchargement).

### Vérifier qu'une mise à jour est bien active

La version exécutée par le serveur est affichée en bas de *Paramètres*, sous
« Foyer ». Si l'écran ne correspond pas à ce que la nouvelle version annonçait,
c'est le premier endroit à regarder : le serveur n'a peut-être pas la version
qu'on croit.

```bash
# Version que le serveur exécute réellement
grep FOYER_VERSION /etc/foyer/foyer.env          # LXC
docker compose exec foyer printenv FOYER_VERSION # Docker

# Le journal de l'auto-mise à jour : le script y écrit TOUT (git, npm, builds).
# C'est ce fichier qu'il faut lire, pas journalctl, qui ne verra presque rien.
tail -60 /var/lib/foyer/update.log
```

### Le helper de mise à jour se met à jour tout seul

Le script exécuté en root vit dans `/usr/local/sbin/foyer-self-update.sh`, hors
du répertoire de l'application : une mise à jour ne recopie que le backend et
l'app compilée. Il se remplace donc lui-même à chaque mise à jour réussie, sinon
aucune correction du script ne pourrait jamais arriver sur une machine.

La version installée sert à la mise à jour **suivante** (remplacer un script
pendant qu'il s'exécute n'est pas une chose à faire à moitié : le remplacement
se fait par renommage, et le processus en cours termine avec l'ancien).

Si votre helper est antérieur à ce mécanisme, une fois suffit pour le rattraper :

```bash
curl -fsSL https://raw.githubusercontent.com/PrudhommeWTF/Foyer-App/main/deploy/lxc/self-update.sh \
     -o /tmp/foyer-self-update.sh \
  && install -m 0755 -o root -g root /tmp/foyer-self-update.sh /usr/local/sbin/foyer-self-update.sh \
  && rm -f /tmp/foyer-self-update.sh
```

Relancer `deploy/lxc/install.sh` fait la même chose, en plus long.

Les unités systemd (`foyer-update.path`, `foyer-update.service`) restent, elles,
posées à l'installation : elles ne changent pas d'une version à l'autre, et si
cela devait arriver un jour il faudra repasser par `install.sh`.

Depuis l'application, l'écran *Paramètres* affiche l'étape qui a échoué et le
message de la commande fautive (« Échec pendant « Téléchargement du code » :
fatal: could not read Username… »), et garde le bouton « Vérifier les mises à
jour » : une tentative ratée ne laisse jamais sans issue.

**Le cache du navigateur ne peut pas masquer une mise à jour.** Les fichiers dont
le nom porte une empreinte de contenu (`main-A1B2C3D4.js`) sont gardés un an, ce
qui est sans risque puisqu'un nouveau contenu arrive sous un nouveau nom ; mais
`index.html`, qui les nomme, est servi en `no-store`. Sans cette distinction, un
iPhone peut continuer d'afficher la version d'avant indéfiniment, alors que le
serveur est à jour : le symptôme est déroutant, parce qu'il n'y a rien à corriger
ni d'un côté ni de l'autre.

```bash
# La règle, telle qu'elle est réellement émise
curl -sI https://foyer.exemple/ | grep -i cache-control          # no-store
curl -sI https://foyer.exemple/main-A1B2C3D4.js | grep -i cache  # immutable
```

Si un reverse-proxy est intercalé, vérifier qu'il ne réécrit pas ces en-têtes.

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

**Foyer ne fait pas de TLS.** Il écoute en clair sur `0.0.0.0:8099` ; c'est le
proxy qui termine le HTTPS et joint le conteneur en **`http://`**. Un
`proxy_pass https://…` vers Foyer donne un 502 immédiat, et c'est l'erreur la
plus fréquente juste après la mise en place d'un certificat.

Rien n'est à configurer côté Foyer : `trust proxy` est déjà actif, et
`FOYER_CORS_ORIGINS` **ne sert pas ici** (l'application et son API sont sur la
même origine, donc CORS n'intervient pas ; cette variable est réservée aux
déploiements où l'app et l'API vivent sur deux domaines).

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

Le proxy ne doit pas réécrire `Cache-Control` : Foyer distingue déjà les fichiers
empreints (gardés un an) de `index.html` (jamais gardé), et écraser cette
distinction ferait réapparaître d'anciennes versions sur les téléphones.

### Nginx Proxy Manager

Trois champs, et trois façons de se tromper :

| Champ | Valeur | Erreur classique |
|---|---|---|
| Scheme | `http` | `https` : 502 immédiat, Foyer ne fait pas de TLS |
| Forward Hostname / IP | l'IP seule, `10.0.0.42` | y recopier `http://`, que NPM ajoute lui-même |
| Forward Port | `8099` | laisser `80`, proposé par défaut |

Dans l'onglet *Advanced* : `client_max_body_size 20m;`.

### Diagnostiquer un 502

Le 502 vient du proxy, jamais de Foyer : la requête n'atteint même pas le code
applicatif. Dans l'ordre, en s'arrêtant à la première anomalie :

```bash
# 1. Sur le conteneur Foyer : le service répond-il ?
systemctl status foyer --no-pager
ss -lptn | grep 8099                    # doit écouter sur 0.0.0.0
curl -sI http://127.0.0.1:8099/         # doit répondre 200

# 2. Depuis la machine du proxy : la joint-elle ?
curl -sI http://IP_DU_CONTENEUR:8099/

# 3. Le journal du proxy, qui donne la raison exacte
tail -30 /var/log/nginx/error.log                        # nginx installé nativement
docker exec <ID_NPM> sh -c 'tail -30 /data/logs/*error.log'   # Nginx Proxy Manager

# 4. Ce que le proxy vise réellement, à ne pas confondre avec ce qu'on croit avoir saisi
docker exec <ID_NPM> sh -c 'grep -H "proxy_pass\|server_name" /data/nginx/proxy_host/*.conf'
```

L'étape 4 est la plus utile : une IP mal saisie ressemble à une configuration
correcte tant qu'on la relit dans l'interface plutôt que dans le fichier généré.

| Message du journal | Cause |
|---|---|
| `connect() failed (111: Connection refused)` | mauvais port, ou service arrêté |
| `connect() failed (113: No route to host)` | mauvaise IP, ou pare-feu |
| `upstream timed out` | paquets filtrés en chemin |
| `SSL_do_handshake() failed` | `https` vers Foyer, qui parle en clair |
| `no live upstreams` | bloc `upstream` mal formé |

Si le proxy tourne en conteneur, vérifier aussi depuis **l'intérieur** de celui-ci
(`docker exec <ID> curl -sI http://IP:8099/`) : un hôte qui joint Foyer ne prouve
pas que son conteneur le joint aussi.

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

## 🗓️ Emploi du temps

Modèle des créneaux, récurrence retenue et son inspiration iCalendar, choix de
densité d'affichage, procédures de sauvegarde et de migration :
[`docs/emploi-du-temps.md`](docs/emploi-du-temps.md).

## 🍽️ Cuisine : recettes, repas, courses

Architecture de la chaîne recettes → planning → courses, procédures de sauvegarde,
de migration et de nettoyage des fichiers, diagnostic d'un article qui n'arrive pas
dans la liste : [`docs/cuisine-architecture.md`](docs/cuisine-architecture.md).

**Des repas à la liste de courses** : les lignes d'ingrédients sont lues
(quantité, unité, produit), rattachées à un référentiel d'environ 200 articles
français, additionnées entre recettes et mises à l'échelle des couverts. Le
rapport s'affiche avant que quoi que ce soit ne soit écrit, et chaque ligne dit de
quelle recette elle vient. Ce qui n'est pas reconnu part quand même aux courses
avec son texte d'origine : **aucune ligne n'est perdue**. Le référentiel du foyer
(*Courses → Rayon*, et les articles que vous corrigez) l'emporte toujours sur la
base intégrée.

**Import de recette** : c'est la seule requête sortante du module, déclenchée par
un geste explicite et journalisée. Le serveur refuse toute adresse pointant sur le
réseau local (y compris après redirection), borne la taille et la durée, et se
coupe entièrement avec `FOYER_RECIPE_IMPORT=false`. Aucune recherche par mots-clés
sur un site tiers : on colle le lien d'une page choisie.

## 📦 CI / images

- `.github/workflows/ci.yml` — build backend + frontend, **tests** et détection de code mort à chaque push/PR.
- `.github/workflows/docker.yml` — publie une image **multi-arch** (`amd64`, `arm64`) sur
  `ghcr.io/<owner>/foyer-app` (tags `latest` + `sha` sur la branche par défaut ; `X.Y.Z`
  et `X.Y` sur tag Git `vX.Y.Z`). La version affichée dans l'app provient du tag Git.

## 📝 Licence

MIT.
