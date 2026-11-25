# Atelier code

Un atelier de programmation par blocs pour les enfants : un projet est une petite histoire, des personnages sur un décor, chacun animé par des scripts faits de blocs emboîtés. Il est **construit à partir du code source ouvert de ScratchJr** (licence BSD 3 clauses), sans lien avec la Scratch Foundation ; voir [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

Les choix d'architecture et les décisions prises sont dans [`atelier-etat-des-lieux.md`](atelier-etat-des-lieux.md), la recette dans [`atelier-plan-de-test.csv`](atelier-plan-de-test.csv).

## Où en est le module

**Étape 4 sur 9 : l'Atelier marche sans réseau, et se regarde sur un téléphone.**

| Fait | Pas encore |
|---|---|
| Écran « Atelier code » dans le menu, y compris celui d'un enfant ; module activable | Décors en image et personnages à plusieurs costumes (niveau Grands codeurs) |
| 212 personnages et 17 décors, cinq projets d'exemple, dessins ajoutés par la famille | |
| Projets par membre : créer, ouvrir, renommer, dupliquer, supprimer | Créer un projet sans réseau ; « mes personnages » sans réseau |
| Hors ligne : l'Atelier s'ouvre, le projet déjà ouvert sur l'appareil se continue, tout part au retour du réseau | |
| Enregistrement automatique, avec refus d'écraser le travail d'un autre appareil | |
| Téléphone : les projets se regardent en plein écran ; écran debout : « Tourne l'iPad » | |
| Dessins gardés sur le disque, « mes personnages » retrouvés d'un projet à l'autre | Son enregistré, photo |
| Corbeille : un projet supprimé reste récupérable, puis est purgé | Vue parent (lire les projets d'un enfant, restaurer depuis l'écran), partage |
| Limites réglables : nombre de projets, espace disque | Niveau « Grands codeurs » |

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
| `atl_projects` | Un projet : membre, niveau, nom, le JSON **au format de l'éditeur, non modifié**, la vignette, `version` (compteur de concurrence), `archived_at` |
| `atl_media` | Les fichiers d'un membre (dessins SVG, vignettes PNG), par nom. Les octets sont dans `pieces/`, comme toutes les pièces jointes |
| `atl_assets` | « Mes personnages » et « mes décors » |

- **Le serveur nomme les fichiers** : l'empreinte MD5 du contenu qu'il a lui-même nettoyé, plus l'extension. Le nom proposé par l'appareil est ignoré.
- **Enregistrement avec version** : l'éditeur présente la version qu'il a lue. Si un autre appareil a enregistré entre-temps, le serveur répond 409 et l'enfant choisit (« Garder celui-ci » ou « Garder l'autre »).
- **Rien n'est supprimé par un enfant** : supprimer archive. Passé `atelierCorbeilleJours` (30 par défaut), la purge quotidienne efface le projet et les fichiers que plus rien ne cite. Module éteint, la purge ne tourne pas.
- **Qui voit quoi** : un enfant ne lit et n'écrit que ses projets et ses fichiers. Un adulte lit ceux de tous, n'écrit que les siens, et lui seul restaure. Pas d'accès par jeton d'API.

### Exploitation

Espace pris par membre, à comparer au réglage `atelierQuotaMo` :

```bash
sqlite3 /var/lib/foyer/foyer.db "SELECT member_id, COUNT(*) AS fichiers, ROUND(SUM(size)/1048576.0, 1) AS mo FROM atl_media GROUP BY member_id;"
```

Projets dans la corbeille :

```bash
sqlite3 /var/lib/foyer/foyer.db "SELECT id, member_id, name, archived_at FROM atl_projects WHERE archived_at IS NOT NULL ORDER BY archived_at;"
```

Restaurer un projet supprimé, en attendant le bouton de la vue parent (remplacer l'identifiant) :

```bash
sqlite3 /var/lib/foyer/foyer.db "UPDATE atl_projects SET archived_at = NULL WHERE id = 'IDENTIFIANT';"
```

### Sauvegarde et retour en arrière

Les tables sont nouvelles : la mise à jour ne touche à aucune donnée existante. Avant de l'installer, service arrêté :

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

`frontend/vendor/atelier/bibliotheque/` : les fichiers (`fichiers/`), le catalogue, la licence (**CC BY-SA 2.0**, pas celle de Foyer), et les deux fichiers qui pilotent la sélection :

- `exclusions.json` : ce qui n'est pas repris et pourquoi (marques, doutes, lettres, images bitmap) ;
- `noms.json` : le nom français de chaque élément retenu. Un élément sans nom fait échouer le script : rien n'entre sans avoir été regardé.

Refaire la sélection (réseau nécessaire, vers `cdn.assets.scratch.mit.edu` uniquement) :

```bash
git clone --depth 1 https://github.com/scratchfoundation/scratch-editor /tmp/scratch-editor
```

```bash
cd backend && npx tsx scripts/atelier-bibliotheque.ts --scratch /tmp/scratch-editor/packages/scratch-gui/src/lib/libraries
```

Le script télécharge, vérifie l'empreinte MD5 de chaque fichier, le nettoie et réécrit `fichiers/` et `catalogue.json`. Il ne tourne **jamais** au build ni à l'exécution : en fonctionnement, l'Atelier ne contacte aucun domaine tiers.

### Exemples

Cinq projets (`frontend/vendor/atelier/petits/www/samples/`), du plus simple au plus riche. L'enfant ne modifie jamais l'exemple : « Partir d'un exemple » lui en crée une copie.

## Niveau « Grands codeurs »

Pour les plus grands : des blocs écrits, des variables, des conditions, des costumes, des clones. Il est construit à partir de l'éditeur de Scratch (AGPL), dans `frontend/vendor/atelier/grands/` ; ses écarts avec l'original sont dans son `MODIFICATIONS.md`.

**Où il en est : l'éditeur s'ouvre, rien n'est enregistré.** En français, avec Boulon, sans compte, sans partage, sans tutoriel, sans extension qui appelle l'extérieur (restent Musique et Stylo). Il n'est pas encore proposé dans l'écran Foyer ; on l'ouvre par son adresse, `https://<ton foyer>/atelier/grands/editor.html`. Recharger la page efface le projet.

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
