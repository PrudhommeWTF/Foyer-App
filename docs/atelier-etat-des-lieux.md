# Atelier code : état des lieux

Ce document a précédé tout code. Il dit ce qui a été **vérifié** (lu dans les sources ou essayé dans un navigateur), ce qui ne l'a pas été, et les décisions prises (en fin de document). Le fonctionnement du module est dans [`atelier.md`](atelier.md).

Sources lues : `scratchfoundation/scratchjr` (commit `ff15b0f`, 8 avril 2022, version 1.2.0) et `scratchfoundation/scratch-editor` (commit `1f42af47`, 11 novembre 2026, version 15.3.0), conditions d'utilisation de Scratch dans le source du site (`scratchfoundation/scratch-www`, `src/views/terms/terms.jsx`).

## L'essentiel

- **Le portage de ScratchJr est faisable, et c'est essayé.** Le code d'origine, construit par esbuild sans Babel ni webpack, avec un faux pont en mémoire, s'ouvre dans Chromium **sous la CSP actuelle de Foyer, sans la toucher** : un bloc glissé au doigt (iPad 1024 × 768 simulé) et à la souris (1440 × 900), drapeau vert, les personnages bougent, l'éditeur de dessin s'ouvre, aucune requête ne sort. Bundle : 474 Ko (136 Ko compressé).
- **Trois désaccords avec le brief**, détaillés plus bas : la page à part plutôt que l'iframe (point 6), le son en WAV plutôt que « tel quel » (point 1), la bibliothèque de projets tenue par l'écran Foyer plutôt que par le code d'origine (point 6).
- **Deux points non vérifiés ici**, faute d'accès : Safari (iPad, Mac) et Android, que seul ton matériel tranchera, et le poids de la bibliothèque de Scratch, dont les serveurs ne sont pas joignables depuis ma session.
- **Une clause que tu n'avais pas** : les conditions de Scratch (4.4) interdisent d'envoyer sur scratch.mit.edu un projet créé avec un éditeur modifié. Voir point 8.

## 1. Le pont web

`src/tablet/OS.js` expose 46 fonctions (tableau complet en annexe A). Répartition :

| Sort | Nombre | Lesquelles |
|---|---|---|
| Endpoint `/api/atelier/*` | 12 | `getmedia`, `setmedia`, `setmedianame`, `getmd5`, `remove`, `getfile`, `setfile`, `cleanassets`, `duplicateAsset`, `getsettings`, et les deux fonctions SQL `stmt` / `query` remplacées par des opérations nommées |
| Navigateur seul | 19 | sons (`registerSound`, `playSound`, `stopSound`, `soundDone`), enregistrement (`sndrecord`, `recordstop`, `volume`, `startplay`, `stopplay`, `recorddisappear`), caméra (`hascamera`, `startfeed`, `stopfeed`, `choosecamera`, `captureimage`, `askpermission`), `trace`, `parse`, `tracemedia` |
| Supprimées | 10 | statistiques (`analyticsEvent`, `setAnalyticsPlacePref`, `setAnalyticsPref`), `hidesplash`, `sendSjrToShareDialog`, `deviceName`, `registerLibraryAssets`, `waitForInterface`, `setfield`, `pageError` (remplacée par le journal du navigateur) |
| P3 | 2 | `createZipForProject`, `loadProjectFromSjr` (export et import de fichier) |
| Accesseurs internes | 3 | `path`, `camera`, `database` |

Points durs, dans l'ordre de difficulté réelle :

- **SQL.** 17 endroits construisent ou paramètrent du SQL côté client, dans 6 fichiers (`IO.js`, `OS.js`, `Paint.js`, `Library.js`, `Project.js`, `Home.js`), pas seulement dans `IO.js`. Ils se ramènent à 9 opérations : lire, créer, enregistrer un projet ; lister les projets ; lister, ajouter, retirer un personnage ou un décor de l'enfant ; vérifier qu'une vignette n'est plus utilisée. Aucune chaîne SQL ne franchira le réseau, et un test échouera si le bundle contient `select `, `insert into` ou `update `.
- **Noms de fichiers en MD5.** Dans l'original, c'est le natif qui calcule l'empreinte et **renvoie** le nom (`<md5>.<ext>`) : le client utilise ce qu'on lui rend. Le serveur de Foyer fait donc exactement pareil et reste seul maître du nom, sans rien croire du client. Les octets vont dans le magasin commun (`pieces/`, adressé par SHA-256, dédoublonné), le MD5 n'est que la clé d'affichage dans le JSON du projet.
- **Enregistrement du son : je déconseille « stocker tel quel ».** `MediaRecorder` donne de l'AAC sur Safari et de l'Opus sur Chrome, et la relecture d'Opus par Web Audio sur Safari n'est pas garantie selon les versions : c'est précisément le couple « enregistré sur le Mac en Chrome, rejoué sur l'iPad » qui risque de casser. L'application d'origine enregistre en WAV (PCM, `RecordSound.m`). Je propose la même chose : capture par Web Audio, encodage WAV mono 22 kHz dans le navigateur, identique partout, relu partout, sans conversion ni outil serveur. Coût : 2,6 Mo pour 60 secondes (environ 220 Ko pour un « bonjour »), compatible avec le quota de 500 Mo. Le niveau sonore affiché pendant l'enregistrement a de toute façon besoin de Web Audio.
- **Sons au démarrage automatique.** Le contexte audio est créé au premier geste (ouverture d'un projet ou drapeau vert) et reste ouvert pour la page : un changement de page par bloc joue donc ses sons. Le seul cas muet est une présentation ouverte directement par un lien sans aucun geste ; le drapeau vert y est de toute façon nécessaire.
- **Caméra.** `getUserMedia` et un `<video>` placé derrière le masque de la forme, capture sur un canvas, réduction à 1 024 px avant envoi. Faisable, mais c'est la partie la moins sûre sur Safari (P2).
- **Les deux `eval`.** Celui de `UI.js` est dans un bloc commenté : rien à faire qu'à le retirer. Celui de `lib.js` gabarie les feuilles de style ; il ne voit passer qu'une poignée de formes d'expression (`css_vh(n)`, `css_vw(n)`, `n * scaleMultiplier`…), remplacées dans l'essai par un petit analyseur de 12 lignes. L'essai tourne sous `script-src 'self'`.
- **Dépendances.** `intl` (inutile, les navigateurs l'ont) et `@babel/polyfill` sortent. `snapsvg` ne sert qu'à **un** appel (`Snap.path.isPointInside`, `Ghost.js:179`) : je le remplacerai par l'équivalent natif du navigateur si le comportement est identique, sinon il reste (Apache 2.0). `intl-messageformat` 1.x est ancien : passage à la version courante, même usage.

## 2. Ressources du dépôt ScratchJr

`editions/free/src/assets/` : 267 fichiers, 19 Mo, dont **12,3 Mo pour une seule vidéo** (`lobby/intro.mp4`).

| Sort | Quoi | Poids |
|---|---|---|
| **Réutilisable** (BSD) | `blocks/`, `blockicons/` (silhouettes neutres, pas de chat), `categories/`, `ui/`, `paint/`, `undo/`, `misc/`, `lib/`, polices Roboto, 10 sons d'interface, `pop.mp3`, `css/`, `fr.json` | 7,2 Mo sur disque, 241 fichiers, environ 3,3 Mo compressés |
| **À ne pas reprendre** (marque) | `start/Cat.svg`, `start/ScratchJrLogo.svg`, `lobby/scratchJrlogo.svg`, `start/creditsText.png`, `pinfologo.png`, `lobby/intro.mp4` et `poster.png` (vidéo de l'application), et dans l'aide `inapp/images/paint.png`, `interface.png`, `page.png` (captures montrant le chat) | écartés |
| **Sans objet** | tout `start/` (écran de démarrage natif), le reste de `lobby/` (voir point 6), `Thumbs.db` | écartés |
| **Manquant** | la bibliothèque : le dépôt n'a que `Star.svg` et `Farm.svg` ; un seul projet d'exemple (`Star`) | point 7 |

Rien de tout cela n'entre dans le bundle principal de Foyer : **0 octet ajouté** à l'application Angular. `fr.json` cite la marque sur 14 lignes, à réécrire. `css/font.css` ne cite `fonts.gstatic.com` qu'en commentaire (les polices sont locales) : commentaires retirés, pour que le test « aucun domaine externe » soit strict.

À corriger en passant : l'original demande `assets/fonts/verdana.ttf` et `verdanab.ttf`, absents du dépôt (404 dans l'essai) ; je retire la référence plutôt que d'ajouter une police propriétaire.

## 3. Format de projet

Un projet d'origine est une ligne : `name`, `version`, `mtime`, `thumbnail` (`{pagecount, md5}`) et `json`. Le `json` contient `pages` (liste), `currentPage`, puis par page : `sprites`, `layers`, `md5` du décor, `num`, et par personnage : position, échelle, position de départ (`homex`, `homey`…), `sounds`, `md5` de l'image et `scripts` (listes de `[bloc, argument, x, y]`). Les médias sont cités par leur nom de fichier (`Star.svg` pour la bibliothèque, `<md5>.svg` pour un dessin, `SND<md5>.wav` pour un son).

Stockage : `atl_projects.json` reçoit ce JSON **octet pour octet**, validé seulement en taille et en forme (types attendus, noms de médias conformes au motif, médias existants et appartenant à l'enfant ou à la bibliothèque). La vignette devient un fichier. Les tables d'origine `USERSHAPES` et `USERBKGS` deviennent `atl_assets`. Le zip `.sjr` de l'original (`data.json` plus dossiers `characters`, `backgrounds`, `sounds`, `thumbnails`) reste donc importable et exportable en P3 sans conversion.

Deux écarts par rapport à ta proposition de tables : l'identifiant de projet reste un UUID côté Foyer (l'original met un entier dans l'URL, sans conséquence), et `atl_library` sera un index en mémoire relu au démarrage (fichiers livrés plus surcharge), pas une table : rien à migrer, rien à sauvegarder.

## 4. Compatibilité : ce qui est testé et ce qui ne l'est pas

Je n'ai que Chromium. Je ne peux pas honnêtement remplir la matrice demandée ; voici son état réel.

| | Chromium bureau (souris) | Chromium tactile 1024 × 768 | Safari iPad PWA | Safari Mac | Chrome Android |
|---|---|---|---|---|---|
| Ouverture, palette, scène | **testé, bon** | **testé, bon** | non testé | non testé | non testé |
| Glisser un bloc | **testé, bon** | **testé, bon** | non testé | non testé | non testé |
| Drapeau vert, exécution | **testé, bon** | **testé, bon** | non testé | non testé | non testé |
| Éditeur de dessin (ouverture, remplissage) | non testé | **testé, bon** | non testé | non testé | non testé |
| Son, micro, caméra | non testé | non testé | non testé | non testé | non testé |

Ce que la lecture du code laisse attendre, à confirmer par l'usage dès la PR 1 :

- **Souris et tactile** : l'original décide une fois pour toutes (`isTablet = 'ontouchstart' in document`). Un iPad avec trackpad, ou un Mac à écran tactile, tombe du mauvais côté. À reprendre avec les événements de pointeur, c'est la modification la plus étendue du portage (44 usages).
- **Plein écran** : le mode présentation de l'original est une mise en page interne, pas l'API plein écran du navigateur : il marchera partout, y compris dans la PWA installée, qui est déjà sans barres.
- **Rotation** : iOS ne permet pas de verrouiller l'orientation depuis une page. « Tourne l'iPad » sera un simple écran affiché en portrait.
- **Android** : hors de ta cible (iPad, iPhone, Mac). Je propose de ne pas le promettre.

## 5. Parité fonctionnelle

Les 175 lignes de `doc/scratchjr_testplan.csv` sont classées dans [`atelier-plan-de-test.csv`](atelier-plan-de-test.csv), avec deux colonnes vides (iPad, Mac) à remplir à chaque PR. Le texte des tests est celui du dépôt ScratchJr (copyright 2016 Massachusetts Institute of Technology, licence BSD 3 clauses) ; la notice complète accompagnera le code dans `THIRD_PARTY_NOTICES.md` dès la PR 1.

| Classe | Lignes | Contenu |
|---|---|---|
| P1 | 150 | scène, barre du haut, tous les blocs sauf le son enregistré, annuler et rétablir, vignettes, bibliothèques, dessin sans photo, cinq projets d'exemple |
| P2 | 18 | son enregistré (7), photo dans le dessin (5), aide refaite (6) |
| Sans objet | 7 | vidéo de présentation (montre les marques), exemples 6 à 8 (nous en livrons cinq), deux bogues connus et une note, qui ne sont pas des tests |
| P3 | 0 | l'export et l'import ne figurent pas dans le plan d'origine : lignes à ajouter le moment venu |

## 6. Isolation, construction, hors ligne

**Je recommande une page à part, pas un iframe.** Raison technique, vérifiée dans `server.ts` : Foyer envoie `Permissions-Policy: camera=(), microphone=()` sur toutes ses pages, et un iframe ne peut pas obtenir une permission que la page qui le contient s'interdit. Or l'application Angular est une seule page, chargée une fois. Avec un iframe, il faudrait donc ouvrir caméra et micro à **tout** Foyer, à l'inverse de ce que tu demandes. Avec une page à part (`/atelier/petits/`, même origine, même cookie de session), le serveur pose sur ces seules URL leur propre `Permissions-Policy` (`camera=(self), microphone=(self)`, et encore seulement si `atelierCamera` / `atelierMicro` sont vrais) et leur propre CSP. Le reste de Foyer ne change pas d'un octet.

Autres avantages : aucune fuite de styles ni de gestion du tactile entre les deux mondes, pas d'iframe dans une PWA iOS (source connue de soucis de clavier et de hauteur d'écran), et pour le niveau 2 une séparation de programmes plus nette encore. Ce qu'on perd : le cadre Angular autour de l'éditeur. La page de l'Atelier porte donc elle-même un bouton de retour (la maison de l'original) et son témoin « non enregistré ».

**Conséquence visible à valider : la bibliothèque de projets est un écran Foyer, pas celui de l'original.** L'écran d'accueil de ScratchJr (`Home.js`, 344 lignes, cadres en bois) ne connaît ni les enfants, ni les deux niveaux, ni la corbeille, ni le partage, ni la vue parent, ni l'iPhone. Tout cela est du Foyer : l'écran Angular `atelier` liste les projets (vignettes, créer, renommer, dupliquer, supprimer, exemples) et ouvre l'éditeur dans sa page. L'éditeur, lui, reste le code d'origine, non réécrit. C'est aussi ce qui permet une seule bibliothèque pour les deux niveaux.

**Construction.** Code tiers dans `frontend/vendor/atelier/petits/` avec `LICENSE`, `MODIFICATIONS.md` ; bundle produit par esbuild (déjà présent par Angular, aucune dépendance de build ajoutée) vers `dist/…/atelier/petits/`. Babel 6, webpack 4, eslint 1 et les 17 dépendances de développement d'origine n'entrent pas.

**CSP de la page** : celle de Foyer, à l'identique. Rien à ajouter en P1. En P2, rien non plus avec le WAV par Web Audio (pas de `media-src blob:`).

**Service worker.** Le cache actuel ne convient pas tel quel : plafonné à 60 entrées, et toute navigation retombe sur `index.html`. L'Atelier aura son cache à lui (`foyer-atelier-petits-<version>`), rempli à la première ouverture à partir d'un manifeste généré au build (environ 250 fichiers, 3,3 Mo téléchargés, 7,2 Mo en cache), plus les personnages et décors **au fur et à mesure qu'ils sont utilisés**, pas toute la bibliothèque. Le service worker actuel prend la main dès son installation (`skipWaiting`) : pour ne pas changer l'Atelier sous les doigts de l'enfant, l'ancien cache versionné est conservé tant qu'une page de l'Atelier est ouverte, et la page ne se recharge jamais d'elle-même.

## 7. Bibliothèque

**Texte applicable** (conditions d'utilisation de Scratch, dernière mise à jour : avril 2016) :

> 5.2 Scratch provides support materials, including images, sounds, video, and sample code, to help users build projects. Support materials are licensed under the Creative Commons Attribution-ShareAlike 2.0 license. You may also use screenshots of Scratch under the same license. Please note that this does not apply to materials that are also trademarked by the Scratch Team or other parties as described in parts 5.4 and 5.5, below. The Creative Commons Attribution-ShareAlike 2.0 license requires you to attribute any material you use to the original author. When you use Scratch support materials, or screenshots of the Scratch website, please use the following attribution: "Scratch is developed by the Lifelong Kindergarten Group at the MIT Media Lab. See http://scratch.mit.edu."
>
> 5.4 The Scratch name, Scratch logo, Scratch Day logo, Scratch Cat, and Gobo are Trademarks owned by the Scratch Team. […]
>
> 5.5 The Scratch support materials library may contain images and sounds that are trademarked by third parties. […] You may not use these materials to label, promote, or endorse any product or service. You are solely responsible for any violation of a third party's intellectual property rights caused by your misuse of these materials.

Le 5.5 élargit ta consigne : il peut y avoir des marques **de tiers** dans la bibliothèque, pas seulement celles de Scratch.

**Comptes exacts** (`scratch-gui/src/lib/libraries/`) : 343 personnages, 915 costumes (790 SVG, 125 PNG), 85 décors (68 PNG, 17 SVG), 354 sons (WAV), soit 1 347 fichiers distincts.

**Exclusions par le nom** : 10 personnages et leurs 31 costumes (Cat, Cat 2, Cat Flying, Gobo, Nano, Pico, Pico Walking, Tera, Giga, Giga Walking), le son « Meow ». Faux positifs gardés : « Catcher » (un joueur de baseball), « Scratch Beatbox » et « Scratchy Beat » (le scratch du DJ), que je renommerai par prudence. **Le nom ne suffit pas** : la revue se fera image par image sur planches (comme pour les ressources de ScratchJr), décors compris, et le fichier `exclusions.json` versionné donnera la raison de chaque retrait.

**Poids : non mesuré.** Les fichiers ne sont connus que par leur empreinte et les serveurs de Scratch sont fermés à ma session. Ordre de grandeur attendu : quelques dizaines de Mo, dominés par les sons (qui ne servent qu'au niveau 2) et les décors bitmap.

**Rangement : je recommande un troisième dépôt public**, par exemple `PrudhommeWTF/foyer-atelier-bibliotheque`, sous CC BY-SA 2.0, qui contient le script de récupération, la liste d'exclusion, les fichiers nettoyés, l'attribution, et publie une archive versionnée. La construction de Foyer (Dockerfile et `self-update.sh`) télécharge l'archive **épinglée** et vérifie son empreinte SHA-256, exactement comme le bundle du niveau 2 : un seul mécanisme pour les deux. Avantages : le dépôt MIT ne contient aucun fichier sous ShareAlike, son historique git ne grossit pas, et la bibliothèque ne dépend plus jamais des serveurs de Scratch. Effet : l'image Docker grossit du poids de l'archive ; la construction a besoin de github.com, ce qui est déjà le cas.

**Mascotte.** Échantillon à valider : [`atelier-mascotte-echantillon.png`](atelier-mascotte-echantillon.png). Un petit robot, « Boulon », une maison sur le ventre (le foyer), trois costumes (debout, marche, saute). Dessiné pour Foyer, en formes simples que l'éditeur de dessin sait rouvrir, sans rapport avec un chat. Si le personnage ne te plaît pas, dis-le maintenant : il sera partout.

## 8. Niveau 2 (Scratch)

**Licences vérifiées** : `scratch-gui`, `scratch-vm`, `scratch-render`, `scratch-storage`, `scratch-svg-renderer`, `scratch-paint`, et en dépendances `scratch-audio`, `scratch-l10n`, `scratch-parser` sont sous AGPL-3.0-only ; `scratch-blocks` sous Apache 2.0. `scratch-render-fonts` n'affiche pas de licence dans le fichier de verrouillage : à éclaircir avant de l'embarquer.

**La séparation que tu proposes, sans trancher à ta place.**

- *Ce qui plaide pour* : le niveau 2 serait un programme distinct (son dépôt, son bundle, sa page), que Foyer se contente de servir et avec lequel il n'échange que par HTTP des projets dans un format de fichier public (`.sb3`) et des médias opaques. Livrer les deux dans la même image est ce que l'AGPL appelle un agrégat, qu'elle n'étend pas au reste. C'est la lecture habituelle, et la page à part (point 6) la renforce par rapport à l'iframe.
- *Ce qui la fragilise* : tout code partagé entre les deux côtés. Aucune ligne de Foyer ne doit entrer dans le bundle AGPL, et aucune ligne de Scratch dans Foyer : l'adaptateur de stockage vit dans le dépôt AGPL et ne connaît de Foyer que ses URL.
- *Ce que cela impose à la release* : chaque version de Foyer épingle un tag du dépôt AGPL et l'empreinte de son archive ; ce tag ne bouge jamais ; il contient tout ce qu'il faut pour reconstruire le bundle servi (sources, modifications, scripts) ; l'écran « À propos » du niveau 2 pointe vers **ce tag précis**, pas vers la branche. Une instance de Foyer en retard d'une version doit continuer d'offrir le source de la sienne.
- *L'alternative* : tout Foyer sous AGPL. Tu es seul titulaire, tu peux le faire. Plus simple techniquement, mais quiconque hébergerait un Foyer modifié pour d'autres devrait publier ses modifications, et le retour à MIT ne vaudrait que pour l'avenir.

**Ce qui se configure sans toucher leur code** (entrée `@scratch/scratch-gui/standalone`) : la langue forcée (`locale: 'fr'`) et le menu de langue masqué ; le stockage sur mesure (un objet `GUIStorage` : projets, médias, vignettes de bibliothèque, miniature) ; le projet par défaut (à ranger soi-même, donc sans le chat) ; l'absence de compte, de partage, de remix, de communauté et de sac à dos (déjà les valeurs par défaut) ; les vidéos des tutoriels (`platform="DESKTOP"`).

**Ce qui exige une modification, à tenir dans `MODIFICATIONS.md`** : le logo de la barre (la propriété `logo` existe mais n'est jamais lue) ; les boutons « Tutoriels » et « Debug » ; la liste des extensions (tableau statique) ; les quatre fichiers de bibliothèque (importés en dur, et le « personnage surprise » y pioche au hasard, chat compris) ; les tutoriels (1 481 images, beaucoup avec le chat, et deux pixels de suivi `code.org`) ; quelques icônes (`cat-ears.svg`, `aww-cat.png`…).

**Ce qui appelle l'extérieur**, à retirer du code et pas seulement du menu : `projects.` et `assets.scratch.mit.edu` (remplacés par le stockage), `cdn.assets.scratch.mit.edu` (vignettes), `synthesis-service` et `translate-service` (un `.sb3` importé qui les utilise les **recharge tout seul**, même absents du menu), `speech.scratch.mit.edu`, `device-manager.scratch.mit.edu` (matériel), `fast.wistia.com` (vidéos), `code.org`, et un point que ton brief ne citait pas : l'extension de détection de visage se rabat sur `cdn.jsdelivr.net`. Deuxième filet : `connect-src 'self'` bloque tout cela même en cas d'oubli. À noter aussi : leur script d'installation télécharge un fichier micro:bit chez Scratch au moment du build.

**CSP** : pas d'`eval` dans leurs sources. L'éditeur utilise des workers (même origine) et des cadres isolés pour mesurer les SVG ; leur code dit fonctionner sous CSP stricte, je ne l'ai pas vérifié. Je ne promets pas la CSP du niveau 2 avant de l'avoir essayée.

**Taille** : inconnue sans construire, et le dépôt n'en dit rien. Attends-toi à un ordre de grandeur de quelques dizaines de Mo, toutes langues embarquées, à réduire au français. Cache hors ligne séparé de celui du niveau 1, rempli seulement si l'enfant a ce niveau.

**iPad** : le dépôt ne déclare aucun support des tablettes. La mise en page pleine demande 1 096 px de large (un iPad en paysage en offre 1 024 à 1 366 selon le modèle) et l'éditeur de dessin 1 250 px. Safari 17.4 au minimum. C'est le principal risque du chantier B : **quel modèle d'iPad ont les garçons ?**

**Clause 4.4 des conditions de Scratch** : « You may not upload any projects that were created, by you or by anyone else, with a modified version of the Scratch editor. » Raphaël pourra ouvrir son `.sb3` dans l'éditeur du site ou dans l'application Scratch hors ligne pour le montrer, mais pas l'enregistrer ni le partager sur un compte scratch.mit.edu. Ta recette (« ouverture du fichier sur scratch.mit.edu ») reste valable telle quelle ; il faut seulement que la maîtresse le sache.

## 9. Ordre des chantiers

| | A (ScratchJr) | B (Scratch) |
|---|---|---|
| Point de départ | application native à porter, code de 2022 | application web maintenue |
| Risque technique levé | oui, par l'essai | non : build, CSP, iPad non essayés |
| Préalables | aucun | ta décision de licence, deux dépôts, la bibliothèque |
| Travail restant | étendu mais connu : pont, médias, pointeur, son, caméra, exemples, aide | moins de code à écrire, plus d'inconnues : retraits, taille, écran |
| Public | Gaëtan, et Raphaël en attendant | Raphaël |

Je ne renverse pas l'ordre : A est débloqué et dérisqué, B attend une décision qui t'appartient. Mais je propose de **l'entrelacer** : socle et A jusqu'au P1 complet (PR 1 à 4), puis B jusqu'à l'éditeur ouvert et enregistré (PR 7 et 8), puis le P2 de A (voix, photo, vue parent : PR 5 et 6), puis PR 9. Raphaël, 8 ans, est celui que le niveau 1 lassera le plus vite. Et je ferais un essai de B d'une demi-journée (construction, CSP, iPad) juste après la PR 1, pour savoir tôt si le chantier tient sur votre iPad.

Le socle (tables, fichiers, bibliothèque de projets, vue parent) est conçu pour deux éditeurs dès la PR 2 : `atl_projects.level`, le JSON opaque par niveau, les médias par empreinte.

## Sauvegarde avant migration

Les tables `atl_*` sont nouvelles : aucune donnée existante n'est modifiée, et la migration se défait par `DROP TABLE`. Avant la première version qui les crée, la procédure est celle de [`sauvegarde-restauration.md`](sauvegarde-restauration.md) ; la forme minimale, service arrêté :

```bash
systemctl stop foyer
tar -C /var/lib/foyer -czf /root/foyer-avant-atelier-$(date +%F).tgz foyer.db pieces
systemctl start foyer
```

Restauration : arrêter le service, extraire l'archive au même endroit, redémarrer. La PR 2 donnera la procédure exacte, sauvegarde de module comprise.

## Décisions prises (11 novembre 2026)

| Sujet | Décision |
|---|---|
| Isolation | **Page à part** (`/atelier/petits/`), pas d'iframe. |
| Bibliothèque de projets | **Écran Foyer** ; l'éditeur seul reste le code d'origine. |
| Son enregistré | **WAV** encodé dans le navigateur. |
| Licence du niveau 2 | **Foyer entier sous AGPL-3.0-only**, décidé le 11 novembre 2026 et appliqué aussitôt (`LICENSE`, README, métadonnées). Le code de Scratch pourra donc vivre dans ce dépôt sans frontière à surveiller, et il n'y aura ni dépôt séparé ni bundle épinglé, contrairement à ce qu'envisage le point 8. Les versions déjà publiées sous MIT le restent. |
| Mascotte | **Boulon**, validé. Redessiné en tracés seuls à la PR 1 : l'éditeur de dessin d'origine carrait ses angles arrondis. |
| Ordre | **Entrelacé** : PR 1 à 4, puis 7 et 8, puis 5 et 6, puis 9. Essai court du niveau 2 après la PR 1. |
| Tablette | iPad Pro 13 pouces (à confirmer) : 1 366 px de large en paysage, au-dessus des deux seuils de Scratch. |

**Bibliothèque de Scratch (PR 3).** Mesurée une fois l'accès ouvert : 1 347 fichiers, 54 Mo (costumes 19,6 ; décors 17,6 ; sons 17,1), toutes empreintes vérifiées. Le niveau Petits codeurs n'en reprend que le premier costume vectoriel de chaque personnage et les décors vectoriels : 212 personnages et 17 décors, 5,3 Mo, soit 1,8 Mo dans git. À ce poids, ils sont rangés **dans ce dépôt**, dans `frontend/vendor/atelier/bibliotheque/`, sous leur propre licence. La question se reposera pour le niveau Grands codeurs, qui voudra les costumes complets, les décors en image (16,5 Mo) et les sons (17 Mo).

La revue visuelle a écarté huit éléments que le nom ne signalait pas (un poney aux traits du chat avec le logo, une casquette au logo, un bus « Scratch Tours », une chambre à l'affiche « Scratch Rocks », entre autres) : voir `exclusions.json`. Seules les images retenues ont été regardées ; les autres costumes le seront avant d'entrer.

## Annexe A : les fonctions de `OS.js`

| Fonction | Devient |
|---|---|
| `path`, `camera` (lecture, écriture), `database` | accesseurs internes, conservés |
| `waitForInterface` | supprimée (le pont web est là dès le chargement) |
| `stmt`, `query` | supprimées ; opérations nommées vers `/api/atelier/projets` et `/api/atelier/medias` |
| `setfield` | supprimée ; `PATCH /api/atelier/projets/:id` (nom) |
| `cleanassets` | sans effet côté client ; le ménage est fait par le serveur |
| `getsettings` | `GET /api/atelier/contexte` (membre, niveau, micro et caméra autorisés, limites) |
| `getmedia` | `GET /api/atelier/medias/:nom` |
| `setmedia`, `setmedianame` | `POST /api/atelier/medias` ; le serveur renvoie le nom |
| `getmd5` | rendu par le serveur avec le média ; calcul local pour les seuls identifiants temporaires |
| `remove` | `DELETE /api/atelier/medias/:nom` (archive, jamais d'effacement immédiat) |
| `getfile`, `setfile` | même chemin que les médias |
| `duplicateAsset` | `POST /api/atelier/medias/:nom/copie` |
| `registerSound`, `playSound`, `stopSound`, `soundDone` | Web Audio |
| `sndrecord`, `recordstop`, `volume`, `startplay`, `stopplay`, `recorddisappear` | Web Audio et encodage WAV (P2) |
| `askpermission` | demande du navigateur au premier usage, message en cas de refus (P2) |
| `hascamera`, `startfeed`, `stopfeed`, `choosecamera`, `captureimage` | `getUserMedia`, canvas (P2) |
| `hidesplash` | supprimée |
| `trace`, `parse`, `tracemedia` | console du navigateur |
| `createZipForProject`, `loadProjectFromSjr` | P3 |
| `sendSjrToShareDialog` | supprimée (pas de partage hors du foyer) |
| `registerLibraryAssets` | supprimée (la bibliothèque est servie par Foyer) |
| `deviceName` | supprimée |
| `analyticsEvent`, `setAnalyticsPlacePref`, `setAnalyticsPref` | supprimées, avec leurs appels dans 17 fichiers |
| `pageError` | console du navigateur |
