# Niveau « Grands codeurs » : ce qui change par rapport à l'éditeur de Scratch

Ce niveau est **construit à partir du code source de l'éditeur de Scratch** (`scratchfoundation/scratch-editor`, licence AGPL-3.0-only, copyright Scratch Foundation). Il ne s'appelle pas Scratch, n'en reprend ni le logo ni les mascottes, et n'a aucun lien avec la Scratch Foundation.

Foyer ne copie pas leur code : il **épingle un commit** (`amont.json`) et ne garde ici que ses écarts, plus le résultat construit. Le code source correspondant à `dist/` est donc : le dépôt d'origine au commit épinglé, plus ce dossier. `construire.sh` les assemble.

| Élément | Rôle |
|---|---|
| `amont.json` | Le dépôt, le commit et la version d'origine |
| `retraits.txt` | Les fichiers d'origine supprimés avant la construction |
| `surcouche/` | Nos fichiers, posés à la place des leurs ou à côté |
| `correctifs/atelier.patch` | Les retouches de leurs fichiers |
| `outils/` | Ce qui est généré à la construction |
| `construire.sh` | La construction, à lancer à la main, jamais sur le serveur |
| `dist/` | Le résultat, commité, recopié par `npm run build` (avec `amont.json` et `defis.json`, que l'écran de Foyer lit) |

Règle : on **adapte**, on ne réécrit pas. Tout écart est listé ici avec sa raison, et marqué dans le code par un commentaire `Atelier (Foyer):`.

## Aucun serveur extérieur

- **Extensions** : seules Musique, Stylo et Détection vidéo restent (`extension-manager.js`, `libraries/extensions/index.jsx`). Sont retirées, code compris (`retraits.txt`) : synthèse vocale et traduction (serveurs de Scratch), reconnaissance vocale, détection de visage (elle se rabattait sur un CDN), et le matériel (micro:bit, LEGO, Vernier, Makey Makey). La détection vidéo est le code d'origine, inchangé : elle analyse l'image de la caméra dans la page et n'appelle aucun serveur.
- **Stockage** (`surcouche/…/foyer/storage.js`) : remplace celui qui parlait aux serveurs de Scratch. Les projets et leurs fichiers vivent dans Foyer (`/api/atelier`), sous la session de celui qui est connecté. Voir « Enregistrer dans Foyer » plus bas.
- **Hôtes par défaut vidés** : `project-fetcher-hoc.jsx` (projets, ressources), `legacy-library-asset-url.ts` (vignettes), `scratch-link-websocket.js` (matériel), `runtime.js` (liste des domaines de Scratch).
- **Tutoriels** : les 1 481 images et vidéos sont supprimées (remplacées par nos défis, voir plus bas), le lecteur de vidéos en ligne (`cards.jsx`) est retiré, code compris, les boutons « Tutoriels » et « Débogage » de la barre sont retirés (`menu-bar.jsx`).
- **Liens** vers le site de Scratch ou d'autres sites, dans des fenêtres de l'éditeur (navigateur non pris en charge, WebGL, télémétrie, variables en ligne, mise à jour d'une carte) : remplacés par une ancre vide.
- **Statistiques** : `lib/analytics.js` est remplacé par un module qui ne fait rien.
- **Page de débogage** de la détection vidéo : retirée de la construction de la machine virtuelle (`scratch-vm/webpack.config.js`) et supprimée (`retraits.txt`) ; l'extension, elle, est gardée.
- **Installation** : le script `prepare`, qui téléchargeait un micrologiciel chez Scratch, est retiré (`package.json`) ; le module qui l'attendait est un fichier vide (`generated/microbit-hex-url.cjs`).

## Pas d'`eval`

Pour vérifier un projet, `scratch-parser` fabriquait ses fonctions à l'exécution avec `new Function` : sous la CSP de Foyer, aucun projet ne se chargeait. `outils/valideurs.cjs` génère ces mêmes fonctions une fois, à la construction (`ajv-pack`), et `webpack.config.js` les substitue. Vérifié : même verdict que l'original sur un projet valide et sur un projet invalide.

D'autres bibliothèques embarquées contiennent encore `new Function` ou `eval` dans des chemins de secours. Ils ne sont pas appelés dans ce qui a été essayé ; s'ils l'étaient, le navigateur les refuserait (c'est la CSP qui garantit, pas la relecture).

## Ni nom, ni logo, ni mascotte

- **Projet par défaut** : Boulon (trois costumes, et son nom) à la place du chat ; le miaulement est retiré ; le décor vide d'origine, qui portait en commentaire l'adresse du site, est remplacé par le nôtre.
- **Bibliothèques** de personnages, costumes, décors et sons : remplacées par celles de Foyer. `surcouche/…/lib/libraries/*.json` porte ce que Foyer fournit (Boulon, un décor blanc, « pop ») ; `construire.sh` pose par-dessus les listes de `../bibliotheque/grands/`, produites par `backend/scripts/atelier-bibliotheque.ts` : la sélection issue de Scratch, sans ses marques ni ses photographies de personnes, noms en français. Les fichiers eux-mêmes ne sont pas dans `dist/` : `npm run build` de Foyer les pose à côté de la page.
- **Un seul stockage** (`surcouche/…/legacy-config.ts`) : des parties de l'éditeur (vignettes des bibliothèques, ajout d'un personnage) lisent leurs fichiers par une configuration de repli, dont le stockage parlait aux serveurs de Scratch quel que soit celui donné à la page. Elle est remplacée par une configuration qui porte le stockage de Foyer.
- **Images remplacées** : le logo de la barre (une maison, qui ramène à Foyer), l'icône « choisir un personnage » et « choisir un costume » (une tête de chat, devenue une tête de robot), et dix images neutralisées (logos des modes anciens, oreilles de chat, avatars, « bientôt disponible », Scratch Link).
- **Textes** (`outils/traductions.cjs`) : seuls le français et l'anglais (langue de repli de l'éditeur) sont gardés sur 82 langues. Cinq messages français qui nommaient la marque sont réécrits ; sept autres, de fonctions retirées, sont supprimés. Quatorze messages apparus dans l'éditeur depuis la dernière publication de ses traductions reçoivent leur texte français (sinon ils s'affichaient en anglais).

## Enregistrer dans Foyer

Tout est dans `surcouche/…/foyer/` (`index.jsx`, `storage.js`, `local.js`), sans retoucher le mécanisme d'enregistrement de l'éditeur : on lui fournit son stockage et ses réglages.

- **Un projet de Foyer, ou rien.** La page s'ouvre sur `editor.html?projet=<identifiant>` ; sans identifiant elle renvoie à Foyer. C'est l'écran Atelier qui crée les projets : l'entrée « Nouveau » du menu Fichier est retirée (`file-menu.jsx`), elle ouvrait un projet sans propriétaire, jamais enregistré.
- **Enregistrement automatique toutes les 30 secondes** (réglage de l'éditeur, 120 à l'origine), et quand la page passe à l'arrière-plan : un iPad qui se met en veille peut ne jamais y revenir.
- **Jamais d'écrasement silencieux.** Chaque envoi présente la version lue ; si un autre appareil a enregistré entre-temps, le serveur refuse et l'enfant choisit la version à garder.
- **Sans réseau** (`local.js`, IndexedDB) : le projet et ses nouveaux fichiers restent sur l'appareil, l'éditeur dit qu'il n'a pas pu enregistrer, et l'envoi est retenté toutes les 15 secondes. Les fichiers déjà lus sont gardés aussi, pour rouvrir le projet sans réseau.
- **Les fichiers gardent le nom que l'éditeur leur donne** (l'empreinte de ce qu'il envoie) : le serveur recalcule cette empreinte lui-même et garde le contenu nettoyé.
- **Adresses absolues.** L'éditeur lit ses fichiers depuis un script d'arrière-plan, qui résoudrait une adresse relative depuis son propre dossier.
- **Regarder** (`&vue=plein`) : la scène seule, en plein écran, sans rien enregistrer. C'est ce qu'ouvre un téléphone.
- **Import et export d'un fichier** : le menu Fichier de l'éditeur, tel quel. Un fichier importé remplace le contenu du projet ouvert et s'enregistre comme lui.

## Défis guidés

Les cartes de l'éditeur, qui portaient ses tutoriels, portent les défis de l'Atelier : cinq pour commencer, écrits pour Foyer. Chaque étape a son texte et l'image du script tel qu'il doit être à ce moment-là.

- `surcouche/…/foyer/defis.json` : les défis (nom, phrase d'accroche, étapes, et l'image de chaque étape). Une étape nomme ses blocs entre crochets, `[mouvement:avancer de 10 pas]`, affichés dans la couleur de leur famille. `construire.sh` le recopie dans `dist/` pour que l'écran de Foyer les propose.
- `surcouche/…/foyer/defis/*.png` : les images, **jamais dessinées à la main**. `outils/images-defis.cjs` écrit le script de chaque étape dans un projet, l'ouvre dans l'éditeur lui-même et photographie ses blocs : ce sont donc toujours les vrais blocs, en français, tels que l'enfant les verra. Deux étapes au même script partagent leur image ; les scripts longs sont rangés sur deux colonnes pour tenir dans la carte. `foyer/index.css` les montre à la moitié de leur taille (elles sont prises au double, pour rester nettes sur un iPad).
- `surcouche/…/lib/libraries/decks/index.jsx` en fait les cartes ; `translate-image.js` rend l'image telle quelle (il n'y a qu'une langue).
- `components/cards/cards.jsx` : une étape peut être du texte seul (l'image était obligatoire).
- `foyer/index.jsx` : `editor.html?projet=…&defi=<identifiant>` ouvre le projet avec les étapes du défi. Un identifiant inconnu est ignoré.
- `outils/traductions.cjs` : « Tutoriels » devient « Défis » dans l'en-tête des cartes et la fenêtre qui les liste.

Écrire ou changer un défi : son texte dans `defis.json`, ses scripts étape par étape dans `outils/images-defis.cjs` (une notation courte, en tête du fichier), puis, contre un Foyer de développement qui sert l'éditeur :

```bash
FOYER_URL=http://localhost:3000 FOYER_EMAIL=… FOYER_PASSWORD=… node outils/images-defis.cjs
```

et `./construire.sh`. L'outil demande Playwright et un Chromium ; il crée un projet sur ce Foyer, le temps de prendre les images, puis le supprime.

## Micro

L'enregistrement d'un son est celui de l'éditeur d'origine, inchangé. Son entrée dans le menu des sons disparaît quand le foyer a éteint le micro pour l'Atelier (`containers/sound-tab.jsx`, qui lit `micro` sur le stockage de Foyer) : la page n'a alors même plus le droit de le demander. 

## Caméra

La caméra ne sert qu'à l'extension Détection vidéo, dont le code est celui d'origine. Elle disparaît de la liste des extensions quand le foyer a éteint la caméra pour l'Atelier (`containers/extension-library.jsx`, qui lit `camera` sur le stockage de Foyer) : la page n'a alors plus le droit de la demander, et un projet qui s'en sert tourne sans image.

## Réglages de la page (`surcouche/…/foyer/index.jsx`)

Français imposé, sans menu de langue ; pas de compte, de partage, de remix, de communauté, de sac à dos ni de variables en ligne.

## Servi sous un sous-chemin

Le module de stockage chargeait son fichier d'arrière-plan à la racine du site (`/chunks/…`). Il le charge à côté de la page (`scratch-storage/webpack.config.js`), pour que l'éditeur marche aussi quand Foyer est servi derrière un sous-chemin.

## Cible de construction

`webpack.config.js` reçoit une cible `BUILD_TYPE=foyer` : une page (`editor.html`), un fichier de code, sans carte de sources.

## Mettre à jour la version de Scratch

1. Changer `commit` et `version` dans `amont.json`.
2. Lancer `./construire.sh`. Il s'arrête si un fichier de `retraits.txt` a disparu ou si le correctif ne s'applique plus : c'est le signal qu'un écart est à revoir.
3. Relire les images de l'interface (une marque peut être réapparue) et relancer `npm run build` dans `frontend/` : il échoue si le résultat cite un hôte inconnu.
