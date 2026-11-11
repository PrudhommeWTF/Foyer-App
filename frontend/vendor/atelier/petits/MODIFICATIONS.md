# Modifications apportées au code de ScratchJr

Ce dossier contient du **code tiers adapté**, pas du code Foyer : le client JavaScript de ScratchJr (`scratchfoundation/scratchjr`, commit `ff15b0f` du 8 avril 2022, version 1.2.0), copyright 2016 Massachusetts Institute of Technology, sous licence BSD 3 clauses (fichier `LICENSE` de ce dossier).

Règle : on **adapte**, on ne réécrit pas. Pas de passage en TypeScript, pas de refonte, pas de reformatage. Chaque écart avec l'original est listé ici avec sa raison, et marqué dans le code par un commentaire qui commence par `Atelier:`. Les conventions de Foyer (style, langue, lint) ne s'appliquent pas à ce dossier.

Le module ne s'appelle pas ScratchJr, n'en reprend ni le logo ni les mascottes, et n'a aucun lien avec la Scratch Foundation. Les identifiants internes du code (la classe `ScratchJr`, la clé `scratchJrVersion`) sont conservés tels quels : ils ne sont jamais affichés.

## Ce qui a été repris

| Origine | Ici | Remarque |
|---|---|---|
| `src/` | `src/` | sauf ce qui est listé plus bas |
| `editions/free/src/assets/` | `www/assets/` | `blocks`, `blockicons`, `categories`, `ui`, `paint`, `undo`, `misc`, `lib`, `fonts`, et quatre images isolées |
| `editions/free/src/css/` | `www/css/` | les huit feuilles de l'éditeur |
| `editions/free/src/sounds/`, `pop.mp3` | `www/` | sons de l'interface |
| `editions/free/src/svglibrary/` | `www/svglibrary/` | `Star.svg` et `Farm.svg`, les deux seuls éléments de bibliothèque du dépôt |
| `editions/free/src/localizations/fr.json` | `www/localizations/fr.json` | français seul |
| `settings.json`, `media.json` | `www/` | adaptés |

## Ce qui n'a pas été repris

- **Marques** : `assets/start/Cat.svg`, `assets/start/ScratchJrLogo.svg`, `assets/lobby/scratchJrlogo.svg`, `assets/start/creditsText.png`, `assets/pinfologo.png`, `assets/lobby/intro.mp4` et `poster.png`, `inapp/images/paint.png`, `interface.png`, `page.png`.
- **Écrans hors de l'éditeur** : `src/lobby/` (accueil, exemples, réglages), `src/entry/index.js`, `home.js`, `gettingstarted.js`, `inapp.js`, les pages HTML correspondantes, `inapp/`, `assets/start/`, `assets/lobby/` (sauf `pmask.png`, un masque neutre utilisé par l'éditeur), les feuilles `start.css`, `lobby.css`, `thumbs.css`, `gs.css`. La bibliothèque de projets est un écran de Foyer ; l'aide sera refaite.
- **Ponts natifs** : `src/tablet/iOS.js`, `src/tablet/Android.js`, et tout le code natif (`ios/`, `android/`).
- **Outillage** : `webpack.config.js`, Babel 6, eslint 1 et les autres dépendances de développement. Le bundle est construit par esbuild (`frontend/scripts/build-atelier.mjs`).
- **Les 21 autres langues**, et dans `fr.json` les messages des écrans non repris, ceux qui nomment la marque, et les noms des personnages de la bibliothèque des stores, absente du dépôt.
- `Thumbs.db` (fichiers Windows oubliés dans le dépôt), `src/utils/Cookie.js`, `src/utils/InitialOptions.js`.

## Ce qui a été modifié, et pourquoi

### Aucune donnée ne sort

- **Statistiques supprimées**, pas désactivées : tous les appels `OS.analyticsEvent(...)` répartis dans l'éditeur, les fonctions `analyticsEvent`, `setAnalyticsPlacePref`, `setAnalyticsPref` du pont, le questionnaire d'usage (`InitialOptions.js`) et son réglage `initialOptions`.
- **Partage supprimé** (`UI.js`) : boutons courriel et AirDrop, barrière parentale qui les protégeait, `infoDoShare`, `IO.compressProject`, `OS.createZipForProject`, `OS.sendSjrToShareDialog`, `OS.loadProjectFromSjr`, `OS.deviceName`, le réglage `shareEnabled`, les règles CSS et les trois icônes correspondantes. L'export et l'import d'un fichier reviendront plus tard, sous une autre forme.
- `css/font.css` : les adresses `fonts.gstatic.com` laissées en commentaire sont retirées (les polices sont locales), ainsi que les deux polices Verdana, que le dépôt référence sans les fournir. Le navigateur prend la Verdana du système.

### Plus de SQL côté client

L'original construisait des instructions SQL dans le navigateur et les faisait exécuter par la base native. Les 17 endroits concernés appellent maintenant des **opérations nommées** du pont :

| Opération | Remplace | Appelée depuis |
|---|---|---|
| `OS.projectGet`, `projectCreate`, `projectSave` | `select`, `insert`, `update` sur `projects` | `IO.js` |
| `OS.projectRename` | `OS.setfield` | `UI.js` |
| `OS.projectList` | `IO.query` sur `projects` | `Project.js`, `IO.js` |
| `OS.assetList`, `assetFind`, `assetAdd`, `assetRemove` | `IO.query`, `OS.stmt`, `IO.deleteobject` sur `usershapes` et `userbkgs` | `Library.js`, `Paint.js` |

Supprimés en conséquence : `OS.stmt`, `OS.query`, `OS.setfield`, `OS.database`, `IO.query`, `IO.deleteobject`, `IO.getObjectinDB`, `IO.setProjectIsGift` (le drapeau « reçu en cadeau » du partage). Les lignes rendues gardent la forme que l'éditeur savait déjà lire.

### Le pont web

- `src/tablet/Web.js` est **nouveau** (écrit pour Foyer) : le troisième pont, à la place d'`iOS.js` et d'`Android.js`. Projets, dessins et « mes personnages » passent par l'API de Foyer (`/api/atelier/*`). C'est le serveur qui nomme les fichiers : `setmedianame` ignore le nom demandé, l'éditeur utilisait déjà celui qu'on lui rend. `duplicateAsset` ne copie plus rien (la bibliothèque est servie avec l'éditeur). Un enregistrement refusé pour conflit propose le choix à l'enfant ; sans réseau, un témoin « Non enregistré » reste affiché jusqu'au prochain enregistrement réussi.
- `src/tablet/OS.js` est réécrit : même rôle de façade, mais vers `Web.js` seulement. `waitForInterface` n'attend plus rien. `hidesplash`, `registerLibraryAssets`, `getfile`, `setfile`, `parse`, `tracemedia`, `pageError` sont retirés, plus rien ne les appelant.
- `src/utils/lib.js` : `isiOS` vaut toujours vrai et `isAndroid` toujours faux. Les branches `if (isAndroid)` de l'éditeur sont laissées en place, inertes, pour ne pas toucher une cinquantaine d'endroits sans nécessité.
- Sons : joués par Web Audio (`Web.js`) derrière les mêmes fonctions `registerSound`, `playSound`, `stopSound`.
- Enregistrement et caméra : pas encore portés. `getsettings` les déclare indisponibles, l'éditeur n'affiche donc pas leurs boutons.

### Compatible avec la CSP de Foyer

- `src/utils/lib.js` : l'`eval` qui gabariait les feuilles de style est remplacé par `cssExpression`, qui ne connaît que les formes réellement utilisées (`css_vh(n)`, `css_vw(n)`, `n * scaleMultiplier`…) et lève une erreur sur toute autre.
- `src/editor/ui/UI.js` : la console de débogage par `eval`, déjà en commentaire, est retirée.
- `editor.html` : plus de script en ligne.

### Dépendances retirées

- `intl` (les navigateurs ont `Intl`) et `@babel/polyfill`.
- `intl-messageformat` : les messages n'utilisent que des `{NOM}` simples, remplacés par six lignes dans `Localization.js`. La langue est fixée au français (plus de cookie, plus de détection).
- `snapsvg` : un seul appel (`Snap.path.isPointInside` dans `Ghost.js`), remplacé par `isPointInPath` du navigateur.

Le bundle n'a donc **aucune dépendance** à l'exécution.

### Adaptations à Foyer

- `src/entry/app.js` : ne charge plus que l'éditeur. `src/entry/editor.js` : ouvert sans projet connu, l'éditeur en crée un (c'était le rôle de l'accueil).
- `ScratchJr.getGotoLink` : la maison ramène à Foyer (`../../`).
- `Library.js` : les vignettes de bibliothèque sont les SVG eux-mêmes ; l'original attendait des copies PNG (`pnglibrary/`) que le dépôt ne contient pas.
- `UI.js`, `editor.css` : le logo de la fiche du projet est retiré.
- `settings.json` : `defaultSprite` vaut `Boulon.svg`. `media.json` : la bibliothèque de départ est Boulon (trois costumes), l'étoile et la ferme.

### Hors ligne, téléphone, rotation

- `src/tablet/Offline.js` est **nouveau** (écrit pour Foyer) : la copie, dans le navigateur (IndexedDB), des projets ouverts sur l'appareil, de leurs dessins, et de ce qui n'a pas encore pu être envoyé.
- `Web.js` : un projet s'enregistre d'abord sur l'appareil, puis sur le serveur. Sans réseau il reste marqué « Non enregistré » et part au retour (relance toutes les 15 secondes tant qu'il reste quelque chose). Un dessin fait sans réseau porte un nom provisoire, remplacé dans le projet par le nom que le serveur lui donne à l'envoi.
- `lib.js`, `app.js` : les feuilles de style étaient chargées par des requêtes **synchrones**, qu'un service worker ne sert pas : l'éditeur ne pouvait pas s'ouvrir hors ligne. Elles sont chargées l'une après l'autre par `fetch`, dans le même ordre. `IO.requestSynchronous`, que plus rien n'appelait, est retiré.
- `app.js` : tenu debout, l'appareil n'affiche qu'un message (« Tourne l'iPad ») ; l'éditeur calcule sa mise en page une fois, pour un écran couché, et la page se recharge quand on le tourne.
- `editor.js` : `vue=plein` ouvre un projet pour le regarder (mode présentation d'emblée, sans retour à l'éditeur) : c'est l'ouverture sur téléphone.

### Bibliothèque

- `MediaLib.js` : la bibliothèque n'est plus un seul dossier. `MediaLib.url(md5)` dit où un fichier est servi (sept appels `MediaLib.path + md5` remplacés) ; `loadFamilyLibrary` ajoute en tête les dessins que la famille a déposés sur son serveur (`/api/atelier/bibliotheque`) ; `localizeMediaNames` garde le nom du catalogue quand les messages n'en donnent pas.
- `media.json` est complété **au build** par le catalogue de `frontend/vendor/atelier/bibliotheque/` (212 personnages et 17 décors issus de Scratch, licence CC BY-SA 2.0, qui ne font pas partie du code de ScratchJr).

## Ce qui a été ajouté

- `www/samples/` : cinq projets d'exemple écrits pour Foyer, avec leur image. L'original en livrait un seul dans le dépôt (`Star`), non repris. C'est l'écran Foyer qui les propose : l'enfant en reçoit une copie à lui.

- `www/svglibrary/Boulon.svg`, `BoulonMarche.svg`, `BoulonSaute.svg` : la mascotte de l'Atelier, dessinée pour Foyer (ce n'est pas du code tiers). En tracés seuls (`M`, `L`, `C`, `Z`), sans groupe ni transformation : l'éditeur de dessin d'origine ne relit fidèlement que cela.
- `www/editor.html` : la page de l'Atelier.
