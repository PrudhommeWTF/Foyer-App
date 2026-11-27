# Atelier code

Un atelier de programmation par blocs pour les enfants : un projet est une petite histoire, des personnages sur un décor, chacun animé par des scripts faits de blocs emboîtés. Il est **construit à partir du code source ouvert de ScratchJr** (licence BSD 3 clauses), sans lien avec la Scratch Foundation ; voir [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

Les choix d'architecture et les décisions prises sont dans [`atelier-etat-des-lieux.md`](atelier-etat-des-lieux.md), la recette dans [`atelier-plan-de-test.csv`](atelier-plan-de-test.csv).

## Où en est le module

**Les neuf étapes sont livrées.** Reste ce que seul l'usage peut confirmer (voir la fin de ce document).

| Fait | Pas encore |
|---|---|
| Écran « Atelier code » dans le menu, y compris celui d'un enfant ; module activable | Décors en image et personnages à plusieurs costumes (niveau Grands codeurs) |
| 212 personnages et 17 décors, cinq projets d'exemple, dessins ajoutés par la famille | |
| Projets par membre : créer, ouvrir, renommer, dupliquer, supprimer | Créer un projet sans réseau ; « mes personnages » sans réseau |
| Hors ligne : l'Atelier s'ouvre, le projet déjà ouvert sur l'appareil se continue, tout part au retour du réseau | |
| Enregistrement automatique, avec refus d'écraser le travail d'un autre appareil | |
| Téléphone : les projets se regardent en plein écran ; écran debout : « Tourne l'iPad » | |
| Dessins gardés sur le disque, « mes personnages » retrouvés d'un projet à l'autre | |
| Son enregistré au micro (les deux niveaux), photo dans l'éditeur de dessin (petits) | |
| Corbeille : un projet supprimé reste récupérable, puis est purgé | |
| Vue parent (un onglet par enfant, restaurer), partage entre frères et sœurs, tuile d'accueil, aide, outil pour les assistants | |
| Limites réglables : nombre de projets, espace disque | |
| Niveau « Grands codeurs » : créer, enregistrer, tenir sans réseau, importer et exporter un fichier ; 315 personnages, 82 décors, 352 sons | |
| Niveau proposé à chaque enfant, réglé par un parent ; six défis guidés pour les grands, avec l'image des blocs à chaque étape ; cinq défis en image pour les petits | |
| Détection vidéo chez les grands : un personnage réagit quand on bouge devant la caméra | |

Sur un écran étroit (téléphone), les projets s'ouvrent pour être regardés, en plein écran, téléphone couché : l'éditeur n'y est pas utilisable, et rien n'y est modifié.

## Architecture

```
frontend/vendor/atelier/petits/      code tiers adapté (voir son MODIFICATIONS.md)
  src/                               le client JavaScript d'origine, modifié a minima
  src/tablet/Web.js                  le pont web, écrit pour Foyer
  www/                               page, feuilles de style, images, sons, bibliothèque de départ
frontend/scripts/build-atelier.mjs   construction et contrôles
frontend/dist/frontend/browser/atelier/petits/   le résultat, servi par le backend
```

**Une page à part, pas un écran Angular.** L'éditeur d'origine suppose qu'il possède la page entière (styles globaux, mise à l'échelle, gestion directe du tactile). Il vit donc dans sa propre page, servie par Foyer sous la même origine, et **rien de lui n'entre dans le bundle de l'application** : ouvrir Foyer ne télécharge pas un octet de l'Atelier.

**Le pont.** L'application d'origine était une page web dans une coquille native, à qui elle demandait tout : la base, les fichiers, le son, le micro, la caméra. `src/tablet/OS.js` est la façade que l'éditeur appelle ; `src/tablet/Web.js` répond à la place du natif, avec les moyens du navigateur et l'API de Foyer (`/api/atelier/*`, cookie de session).

**La bibliothèque de projets est un écran Foyer** (`frontend/src/app/screens/atelier/`), pas celui de l'application d'origine : c'est lui qui connaît les membres, la corbeille, et demain les deux niveaux.

**Pas de SQL dans le navigateur.** L'original fabriquait ses requêtes SQL côté client. Elles sont remplacées par des opérations nommées (`projectGet`, `projectSave`, `assetList`…) : c'est la liste exacte de ce que l'API devra offrir, et rien d'autre.

## Données

Tables `atl_*` dans `foyer.db`, hors du document du foyer (`backend/src/atelier/`) :

| Table | Contenu |
|---|---|
| `atl_projects` | Un projet : membre, niveau, nom, le JSON **au format de l'éditeur, non modifié**, la vignette, `version` (compteur de concurrence), `archived_at`, `shared_at` (partagé avec la famille) |
| `atl_media` | Les fichiers d'un membre (dessins SVG, vignettes PNG), par nom. Les octets sont dans `pieces/`, comme toutes les pièces jointes |
| `atl_assets` | « Mes personnages » et « mes décors » |
| `atl_access` | Les niveaux ouverts à un enfant, réglés par un parent. Pas de ligne : les deux |

- **Le serveur nomme les fichiers** : l'empreinte MD5 du contenu qu'il a lui-même nettoyé, plus l'extension. Le nom proposé par l'appareil est ignoré.
- **Enregistrement avec version** : l'éditeur présente la version qu'il a lue. Si un autre appareil a enregistré entre-temps, le serveur répond 409 et l'enfant choisit (« Garder celui-ci » ou « Garder l'autre »).
- **Rien n'est supprimé par un enfant** : supprimer archive. Passé `atelierCorbeilleJours` (30 par défaut), la purge quotidienne efface le projet et les fichiers que plus rien ne cite. Module éteint, la purge ne tourne pas.
- **Qui voit quoi** : un enfant ne lit et n'écrit que ses projets et ses fichiers, plus, en lecture, les projets qu'un autre membre partage et les fichiers que ces projets citent. Un adulte lit ceux de tous, n'écrit que les siens, et lui seul restaure. Personne ne modifie le projet d'un autre. Pas d'accès par jeton d'API, sauf l'outil d'assistant décrit plus bas.

### Exploitation

Espace pris par membre, à comparer au réglage `atelierQuotaMo` :

```bash
sqlite3 /var/lib/foyer/foyer.db "SELECT member_id, COUNT(*) AS fichiers, ROUND(SUM(size)/1048576.0, 1) AS mo FROM atl_media GROUP BY member_id;"
```

Projets dans la corbeille :

```bash
sqlite3 /var/lib/foyer/foyer.db "SELECT id, member_id, name, archived_at FROM atl_projects WHERE archived_at IS NOT NULL ORDER BY archived_at;"
```

Restaurer un projet supprimé sans passer par l'écran (le bouton « Restaurer » de la vue parent fait la même chose ; remplacer l'identifiant) :

```bash
sqlite3 /var/lib/foyer/foyer.db "UPDATE atl_projects SET archived_at = NULL WHERE id = 'IDENTIFIANT';"
```

### Sauvegarde et retour en arrière

Les tables sont propres au module : la mise à jour ne touche à aucune autre donnée. La version qui apporte le partage ajoute une colonne (`atl_projects.shared_at`), sans rien réécrire. Avant de l'installer, service arrêté :

```bash
systemctl stop foyer
```

```bash
tar -C /var/lib/foyer -czf /root/foyer-avant-atelier-$(date +%F).tgz foyer.db pieces
```

```bash
systemctl start foyer
```

Pour revenir en arrière : arrêter le service, extraire l'archive dans `/var/lib/foyer`, réinstaller la version précédente, redémarrer. La sauvegarde chiffrée habituelle ([`sauvegarde-restauration.md`](sauvegarde-restauration.md)) emporte déjà tout : les tables sont dans `foyer.db`, les fichiers dans `pieces/`.

## Hors ligne

Deux mécanismes, un par nature de donnée :

| Quoi | Où | Comment |
|---|---|---|
| Les fichiers de l'Atelier (code, images, sons, bibliothèque) | Cache du service worker de Foyer (`foyer-atelier-v1`) | Mis de côté en entier à la première ouverture en ligne (480 fichiers, 11,7 Mo). Servis depuis le cache, rafraîchis en arrière-plan |
| Les projets et les dessins de l'enfant | IndexedDB du navigateur (`foyer-atelier`) | Copie de ce qui a été ouvert sur cet appareil, et file de ce qui reste à envoyer |

Ce que cela donne à l'usage :

- **L'Atelier s'ouvre sans réseau** dès qu'il a été ouvert une fois en ligne sur l'appareil.
- **Un projet déjà ouvert sur l'appareil se continue** sans réseau, dessins compris. Le témoin « Non enregistré » reste affiché ; au retour du réseau tout part seul, une seule fois, y compris après fermeture et réouverture.
- **L'écran Foyer**, sans réseau, ne peut pas lister les projets : il propose de continuer le dernier ouvert sur l'appareil.
- **Une mise à jour de Foyer ne change rien sous les doigts de l'enfant** : la page ouverte garde ce qu'elle a chargé, la nouvelle version sert à l'ouverture suivante.

Limites, à connaître :

- Sans réseau, on ne **crée** pas de projet et on n'ouvre pas un projet **jamais ouvert sur cet appareil**.
- Un dessin fait sans réseau entre dans le projet, mais pas dans « mes personnages ».
- La copie locale vit dans le navigateur : la supprimer (réglages de Safari, « Effacer historique et données ») **perd ce qui n'était pas encore envoyé**. Ce qui est enregistré sur le serveur ne risque rien.
- Si le même projet a été modifié ailleurs entre-temps, rien n'est écrasé : au prochain enregistrement, l'enfant choisit laquelle des deux versions garder.

Pour repartir d'un état propre sur un appareil qui se comporte mal (dans la console du navigateur, sur une page de Foyer) :

```js
indexedDB.deleteDatabase('foyer-atelier'); caches.delete('foyer-atelier-v1');
```

## Bibliothèque

Trois sources, dans l'ordre où l'enfant les voit :

1. **Ce qu'il a dessiné** (« mes personnages », par membre).
2. **Ce que la famille a ajouté** sur son serveur, sans reconstruire l'application.
3. **La bibliothèque livrée** : Boulon, puis 212 personnages et 17 décors issus de Scratch, rangés par thème (animaux, personnes, fantastique, nourriture, musique, sport, objets).

Ces trois sources sont celles des Petits codeurs. Les Grands codeurs ont la bibliothèque livrée entière (voir plus bas) ; « mes personnages » et les ajouts de la famille ne leur sont pas encore proposés.

### Ajouter un personnage ou un décor

Déposer un fichier SVG dans le dossier de données, puis redémarrer le service :

```bash
cp MonDessin.svg /var/lib/foyer/atelier/bibliotheque/personnages/
```

```bash
systemctl restart foyer
```

- Les décors vont dans `decors/` (format 480 × 360).
- Le nom du fichier devient le nom affiché.
- Le fichier doit porter `width` et `height`, ou une `viewBox`.
- Il est **nettoyé** comme le dessin d'un enfant avant d'être servi ; un fichier refusé est nommé dans le journal (`journalctl -u foyer | grep Atelier`) et n'empêche rien.
- `LICENCES.md`, créé dans ce dossier au premier démarrage, est à tenir à la main : d'où vient chaque dessin, sous quelle licence.
- Pour un dessin que l'éditeur de dessin doit pouvoir modifier fidèlement, préférer des tracés simples (`path`) : il ne relit pas bien les rectangles arrondis.

### La bibliothèque issue de Scratch

`frontend/vendor/atelier/bibliotheque/` (50 Mo) : les fichiers des deux niveaux (`fichiers/`), le catalogue des petits (`catalogue.json`), les listes des grands (`grands/*.json`, au format de leur éditeur), la licence (**CC BY-SA 2.0**, pas celle de Foyer), et les deux fichiers qui pilotent la sélection :

- `exclusions.json` : ce qui n'est pas repris et pourquoi (marques, doutes, photographies de personnes réelles ; et pour les petits seulement, lettres et images bitmap) ;
- `noms.json` : le nom français de chaque élément retenu (personnage, `decor:…`, `son:…`). Un élément sans nom fait échouer le script, deux éléments du même nom aussi : rien n'entre sans avoir été regardé.

| | Petits codeurs | Grands codeurs |
|---|---|---|
| Personnages | 212, premier costume, vectoriels | 315, tous leurs costumes (775), images comprises |
| Lettres et chiffres | non | oui (88) |
| Décors | 17, vectoriels | 82, photos comprises |
| Sons | ceux de l'éditeur | 352 |

Refaire la sélection (réseau nécessaire, vers `cdn.assets.scratch.mit.edu` uniquement) :

```bash
git clone --depth 1 https://github.com/scratchfoundation/scratch-editor /tmp/scratch-editor
```

```bash
cd backend && npx tsx scripts/atelier-bibliotheque.ts --scratch /tmp/scratch-editor/packages/scratch-gui/src/lib/libraries
```

Le script télécharge, vérifie l'empreinte MD5 de chaque fichier, nettoie les SVG et réécrit `fichiers/`, `catalogue.json` et `grands/*.json`. Les listes des grands sont lues **à la construction de leur éditeur** : après un changement de sélection, relancer aussi `frontend/vendor/atelier/grands/construire.sh`. Il ne tourne **jamais** au build ni à l'exécution : en fonctionnement, l'Atelier ne contacte aucun domaine tiers.

### Exemples

Cinq projets (`frontend/vendor/atelier/petits/www/samples/`), du plus simple au plus riche. L'enfant ne modifie jamais l'exemple : « Partir d'un exemple » lui en crée une copie.

## Niveau « Grands codeurs »

Pour les plus grands : des blocs écrits, des variables, des conditions, des costumes, des clones. Il est construit à partir de l'éditeur de Scratch (AGPL), dans `frontend/vendor/atelier/grands/` ; ses écarts avec l'original sont dans son `MODIFICATIONS.md`.

**Où il en est.** L'écran Atelier propose les deux niveaux à « Nouveau projet », et ouvre chaque projet dans son éditeur. En français, avec Boulon, sans compte, sans partage, sans tutoriel, sans extension qui appelle l'extérieur (restent Musique et Stylo).

**Sa bibliothèque** : Boulon, puis 315 personnages avec tous leurs costumes, 82 décors et 352 sons, noms en français. Ses fichiers sont servis par Foyer (`atelier/grands/bibliotheque/`) ; un projet ne fait que les citer, ils ne comptent pas dans la place de l'enfant. Sans réseau, seuls les éléments déjà vus sur l'appareil sont disponibles : les 50 Mo ne sont pas téléchargés d'avance.

**Enregistrement.** Tout seul toutes les 30 secondes, depuis le menu Fichier, et quand la page passe à l'arrière-plan. Le projet est gardé au format de l'éditeur (`atl_projects.level = 'grands'`), ses dessins, photos et sons dans `atl_media` comme ceux des petits. Un enregistrement en retard sur un autre appareil n'écrase rien : l'enfant choisit la version à garder.

**Sans réseau.** L'éditeur dit qu'il n'a pas pu enregistrer ; le projet et ses nouveaux fichiers restent sur l'appareil (IndexedDB `foyer-atelier-grands`) et repartent dès que le réseau revient, même si l'onglet a été fermé entre-temps (à la réouverture du projet). Un projet déjà ouvert sur l'appareil se rouvre sans réseau.

**Importer, exporter.** Le menu Fichier lit et écrit un fichier de projet (`.sb3`, le format de l'éditeur d'origine). Un fichier importé **remplace** le contenu du projet ouvert, après confirmation, et prend le nom du fichier. C'est aussi la sauvegarde personnelle la plus simple d'un projet.

**Limites.** Un projet pèse au plus 5 Mo, une image 2 Mo et 1 024 points de côté, un son 10 Mo (WAV ou MP3) ; au-delà le serveur refuse et l'éditeur affiche sa phrase. La place totale d'un membre est le réglage « Espace disque maximal par membre ».

**Ménage.** L'éditeur ne dit pas quand un costume ou un son n'est plus utilisé. Une fois par jour, le serveur efface les fichiers que plus aucun projet ne cite (corbeille comprise) et qui ont plus que le délai du réglage « Garder un projet supprimé pendant ».

**Sur un téléphone**, le projet s'ouvre pour être regardé : la scène seule, avec son drapeau vert.

**Il n'est pas construit sur le serveur.** Construire l'éditeur de Scratch demande 1,5 Go de dépendances et plusieurs gigaoctets de mémoire : le résultat (`grands/dist/`, 13 Mo) est commité, et `npm run build` ne fait que le recopier et le contrôler. Une mise à jour de Foyer sur le LXC ne coûte donc rien de plus.

Reconstruire, sur un poste de développement (Node 22, git, une dizaine de minutes) :

```bash
cd frontend/vendor/atelier/grands && ./construire.sh
```

Le script clone le dépôt d'origine au commit de `amont.json`, applique nos écarts, construit, et range le résultat dans `dist/`.

**Un en-tête à part pour trois fichiers.** Pour lire un dessin sans risque, l'éditeur le confie à un cadre isolé (un `iframe` bac à sable, sans origine). Foyer sert tout avec `Cross-Origin-Resource-Policy: same-origin`, ce qui refusait à ce cadre ses scripts : ceux de `atelier/grands/static/assets/*.js`, et eux seuls, partent en `cross-origin`. Ce sont des bibliothèques publiques sans rien du foyer ; la CSP ne change pas. Derrière un reverse-proxy qui réécrit les en-têtes, vérifier :

```bash
curl -sI https://<ton foyer>/atelier/grands/static/assets/$(curl -s https://<ton foyer>/atelier/grands/fichiers.json | grep -o 'runner[^"]*') | grep -i cross-origin-resource-policy
```

La réponse attendue est `cross-origin`. Sinon la zone de dessin des costumes reste vide.

**Contrôle à chaque build de Foyer** : le résultat ne doit citer aucun hôte hors d'une liste explicite d'adresses inertes (espaces de noms XML, renvois à de la documentation dans des messages d'erreur). Les serveurs de Scratch n'y figurent pas : s'il en réapparaît un, le build échoue.

## En famille

**Vue parent.** Dans l'écran Atelier d'un adulte, un onglet par autre membre : ses projets, qu'on regarde (toucher la vignette) ou dont on voit les blocs (l'œil), sans jamais rien y modifier ; ceux qu'il a supprimés, avec un bouton « Restaurer » tant que le délai de la corbeille court ; et la place qu'il occupe sur la limite du foyer. Ouvert par quelqu'un d'autre que son auteur, un éditeur n'enregistre rien.

**Partage entre frères et sœurs** (réglage « Partage entre frères et sœurs », activé par défaut). L'auteur d'un projet le marque « partagé » (le bouton aux deux silhouettes). Les autres le voient dans « Projets de la famille », le regardent, et peuvent en faire **une copie à eux** : la copie emporte les dessins et les sons du projet, qui comptent alors dans la place de celui qui copie, et ne dépend plus de l'original. L'original n'est jamais modifié par un autre. Réglage éteint, plus rien de partagé ne se voit ; rien n'est supprimé, et le partage revient tel quel si on le rallume.

**Le niveau de chaque enfant.** Dans l'onglet d'un enfant, « peut créer dans » : Petits codeurs, Grands codeurs, ou les deux (par défaut). Avec un seul niveau, « Nouveau projet » crée tout de suite, sans rien demander, et les exemples ou les défis de l'autre niveau ne lui sont pas proposés. Cela ne règle que ce qui se **crée** : les projets déjà faits dans l'autre niveau restent à lui et s'ouvrent comme avant. Le jour où Gaëtan passe aux Grands codeurs, ses histoires des Petits codeurs sont toujours là. Un projet d'un niveau ne s'ouvre pas dans l'autre éditeur : les deux formats sont différents, et rien n'est converti.

**Défis guidés** (Grands codeurs). « Relever un défi » crée un projet et l'ouvre avec ses étapes dans une carte que l'enfant déplace, réduit ou ferme : Boulon traverse la scène, dit bonjour, danse, se pilote au clavier, puis un premier jeu avec un score, et un défi avec la caméra (« Attrape Boulon avec la main » : on passe la main sur Boulon, il fait pop et s'enfuit). Ce dernier n'est proposé, dans Foyer comme dans l'éditeur, que si le réglage « caméra » de l'Atelier est allumé. La carte « Défis » de l'éditeur les liste tous. Chaque étape montre, sous son texte, l'image du script tel qu'il doit être à ce moment-là : des photos des vrais blocs, prises dans l'éditeur par un outil, jamais dessinées à la main. Pour en écrire un, voir `frontend/vendor/atelier/grands/MODIFICATIONS.md`.

**Défis en image** (Petits codeurs). À cinq ans on ne lit pas : un défi est **une image**, celle du script à refaire. « Relever un défi » crée un projet et ouvre l'éditeur avec une carte en bas à droite de la zone des scripts : le nom du défi, une phrase pour l'adulte assis à côté, et l'image des blocs à assembler. Le bouton rond la range en une étoile (pour libérer la place) et la ressort. Cinq défis, du plus simple au moins simple : Boulon avance, saute, danse (une boucle), grandit (avec un son), et ne s'arrête jamais. Rien n'est vérifié ni noté : l'enfant compare son script à l'image, et appuie sur le drapeau pour voir. La carte n'existe que le temps de cette ouverture ; rouvert depuis la liste, le projet est un projet comme un autre. Pour en écrire un, voir `frontend/vendor/atelier/petits/MODIFICATIONS.md`.

**Accueil.** Pour un enfant, la tuile de l'Atelier montre la vignette de son dernier projet et « Reprendre : son nom ». Pour un adulte (sur téléphone, où l'accueil est fait de tuiles), « Raphaël a travaillé sur 2 projets cette semaine » : seuls ceux qui ont travaillé sont nommés. Module éteint, la tuile disparaît.

**Aide.** « Comment ça marche ? », en bas de l'écran Atelier : les premiers gestes des deux niveaux, et ce que fait chaque bloc des Petits codeurs, avec son image.

**Assistants.** Un outil en lecture, `atelier_projets` (voir [`assistants.md`](assistants.md)) : les projets d'un enfant, sans leur contenu.

## Micro et caméra

**Ce qu'ils permettent.** Petits codeurs : enregistrer un son (bouton micro de la palette verte), qui devient un bloc « jouer mon son », et remplir une forme d'un dessin avec une photo (outil appareil photo de l'éditeur de dessin, caméra avant ou arrière). Grands codeurs : enregistrer un son dans l'onglet Sons, et la **détection vidéo** (voir plus bas). Sons et photos restent sur le serveur de Foyer, dans la place du membre.

**Détection vidéo** (Grands codeurs). C'est une extension de l'éditeur : bouton bleu en bas à gauche, « Détection vidéo ». Elle affiche l'image de la caméra derrière la scène et ajoute quatre blocs : « quand le mouvement de la vidéo > 10 », « mouvement de la vidéo de ce sprite », « activer la vidéo », « mettre la transparence de la vidéo à ». Un personnage peut ainsi éclater quand on le « touche » de la main. L'image de la caméra est analysée **dans la page** : elle n'est envoyée nulle part, ni à Foyer ni ailleurs, et rien n'en est enregistré (le projet ne garde que ses blocs). Le navigateur demande la permission la première fois ; la caméra s'allume à l'ajout de l'extension ou à l'ouverture d'un projet qui s'en sert, et s'éteint en quittant la page ou avec le bloc « désactiver la vidéo ». Réglage « caméra » éteint : l'extension n'est plus proposée, et un projet qui s'en servait s'ouvre et tourne, mais sans image (ses blocs de mouvement valent zéro).

**Trois réglages** (Réglages, section Atelier code) : autoriser le micro, autoriser la caméra, durée maximale d'un son chez les petits (60 secondes par défaut, environ 2,6 Mo la minute). Éteints, les boutons disparaissent, et les pages de l'Atelier n'ont plus le droit de demander : ce qui a déjà été enregistré continue de jouer.

**Pourquoi seulement ces pages.** Foyer interdit le micro et la caméra à toutes ses pages (`Permissions-Policy`). Les deux éditeurs sont des pages à part, et reçoivent seuls une exception : le micro et la caméra pour les deux, chacun selon son réglage. Vérifier :

```bash
curl -sI https://<ton foyer>/atelier/petits/editor.html | grep -i permissions-policy
```

La réponse doit contenir `camera=(self)` et `microphone=(self)` ; pour toute autre adresse de Foyer, `camera=()` et `microphone=()`. Derrière un reverse-proxy qui réécrit cet en-tête, micro et caméra ne marcheront pas.

**HTTPS obligatoire.** Un navigateur ne donne le micro ou la caméra qu'à une page servie en HTTPS (ou sur `localhost`). Sur un Foyer servi en HTTP simple, les boutons n'apparaissent pas.

**Le navigateur demande la première fois.** Si l'enfant refuse par erreur, l'Atelier lui dit de demander à un parent, et le navigateur ne redemandera pas tout seul :

- **iPad, iPhone (Safari)** : Réglages d'iOS, Apps, Safari, puis « Micro » et « Appareil photo » : choisir « Demander » ou « Autoriser ». Pour un seul site : dans Safari, le bouton à gauche de la barre d'adresse, « Réglages du site web ».
- **Foyer installé sur l'écran d'accueil (PWA)** : Réglages d'iOS, descendre jusqu'au nom de l'application, puis autoriser « Micro » et « Appareil photo ».
- **Mac (Safari)** : Safari, Réglages, Sites web, « Microphone » et « Caméra » : passer le site sur « Autoriser ».
- **Chrome** : le cadenas à gauche de l'adresse, « Paramètres du site ».

**Ce qui n'a pas été essayé** : un vrai micro et une vraie caméra. Les essais ont été faits dans Chromium avec des périphériques simulés. Safari sur iPad est le premier point à vérifier.

## Sécurité

- **En-têtes** : la page reçoit la CSP de Foyer, **inchangée** (`script-src 'self'`, pas d'`eval`, `connect-src 'self'`). Les deux `eval` de l'original sont supprimés.
- **Aucune donnée sortante** : statistiques d'usage et partage retirés du code, pas désactivés. Le bundle n'a aucune dépendance à l'exécution.
- **Le build échoue** si le résultat contient une adresse extérieure, un `eval`, du SQL, un reste de statistiques ou un SVG actif. Les contrôles sont dans `build-atelier.mjs`, testés par `build-atelier.test.mjs`.
- **SVG nettoyés** : un dessin reçu est reconstruit à partir d'une liste blanche (ni script, ni gestionnaire d'événement, ni lien sortant, ni `foreignObject`) et servi comme une image inerte (`nosniff`, CSP `sandbox`).
- La page de l'éditeur est statique et servie sans session, comme la coquille de l'application ; toute donnée passe par l'API, qui exige la session. Session fermée, l'éditeur renvoie à Foyer.

Vérifier sur le serveur que rien d'extérieur n'est embarqué (ne doit rien renvoyer hors notice de licence) :

```bash
grep -rIl -i -E "firebase|google-analytics|scratch\.mit\.edu" /opt/foyer/backend/public/atelier/
```

```bash
curl -sI https://<ton foyer>/atelier/petits/editor.html | grep -i -E "content-security-policy|permissions-policy"
```

## Construire

`npm run build` dans `frontend/` construit l'application puis l'Atelier. Pour l'Atelier seul, une fois l'application construite :

```bash
cd frontend && node scripts/build-atelier.mjs
```

La dernière ligne donne le nombre de fichiers et le poids. `atelier/petits/fichiers.json` en garde la liste.

Poids actuel : 480 fichiers, 11,7 Mo sur disque, dont 325 Ko de code. Ces fichiers sont **dans le dépôt git** (environ 8,5 Mo, une fois pour toutes), ce qui alourdit d'autant un clone et une mise à jour.

## Modifier le code tiers

Règle : **adapter, pas réécrire**. Toute modification de `frontend/vendor/atelier/` porte un commentaire `Atelier:` dans le code et une ligne dans `MODIFICATIONS.md`, avec sa raison. Pas de conversion en TypeScript, pas de reformatage : un diff lisible avec l'original vaut plus qu'un code à notre goût.

## Ce que l'usage doit confirmer

Les essais ont été faits dans Chromium seulement (bureau à la souris, et tactile simulé en 1024 × 768). **Safari sur iPad et sur Mac n'a pas été essayé** : c'est le premier point à vérifier, colonnes iPad et Mac du plan de test.

Dans l'ordre où cela peut gêner :

1. **Le micro et la caméra sur un vrai appareil.** Ils n'ont été essayés qu'avec des périphériques simulés. C'est ce qui diffère le plus d'un navigateur à l'autre.
2. **Le toucher sur iPad** dans les deux éditeurs : glisser un bloc, dessiner, déplacer la carte d'un défi.
3. **Le hors-ligne sur iPad**, Foyer installé sur l'écran d'accueil : ouvrir l'Atelier sans réseau, continuer un projet, retrouver le réseau.
4. **L'écoute des sons** de la bibliothèque des grands, et leurs noms français, traduits sans relecture.
5. **Un fichier de projet venu d'ailleurs** (`.sb3`) : il s'importe ; s'il utilise une extension retirée (synthèse vocale, traduction, matériel), ses blocs correspondants ne fonctionneront pas.
