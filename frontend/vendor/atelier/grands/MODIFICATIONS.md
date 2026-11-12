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
| `dist/` | Le résultat, commité, recopié par `npm run build` |

Règle : on **adapte**, on ne réécrit pas. Tout écart est listé ici avec sa raison, et marqué dans le code par un commentaire `Atelier (Foyer):`.

## Aucun serveur extérieur

- **Extensions** : seules Musique et Stylo restent (`extension-manager.js`, `libraries/extensions/index.jsx`). Sont retirées, code compris (`retraits.txt`) : synthèse vocale et traduction (serveurs de Scratch), reconnaissance vocale, détection de visage (elle se rabattait sur un CDN), détection vidéo (caméra, à rouvrir plus tard), et le matériel (micro:bit, LEGO, Vernier, Makey Makey).
- **Stockage** (`surcouche/…/foyer/storage.js`) : remplace celui qui parlait aux serveurs de Scratch. À cette étape le projet vit **en mémoire**, et la bibliothèque est une poignée de fichiers servis par Foyer (`dist/bibliotheque/`).
- **Hôtes par défaut vidés** : `project-fetcher-hoc.jsx` (projets, ressources), `legacy-library-asset-url.ts` (vignettes), `scratch-link-websocket.js` (matériel), `runtime.js` (liste des domaines de Scratch).
- **Tutoriels** : les 1 481 images et vidéos sont supprimées, le lecteur de vidéos en ligne (`cards.jsx`) est retiré, code compris, les boutons « Tutoriels » et « Débogage » de la barre sont retirés (`menu-bar.jsx`).
- **Liens** vers le site de Scratch ou d'autres sites, dans des fenêtres de l'éditeur (navigateur non pris en charge, WebGL, télémétrie, variables en ligne, mise à jour d'une carte) : remplacés par une ancre vide.
- **Statistiques** : `lib/analytics.js` est remplacé par un module qui ne fait rien.
- **Page de débogage** de la détection vidéo : retirée de la construction de la machine virtuelle (`scratch-vm/webpack.config.js`), avec l'extension.
- **Installation** : le script `prepare`, qui téléchargeait un micrologiciel chez Scratch, est retiré (`package.json`) ; le module qui l'attendait est un fichier vide (`generated/microbit-hex-url.cjs`).

## Pas d'`eval`

Pour vérifier un projet, `scratch-parser` fabriquait ses fonctions à l'exécution avec `new Function` : sous la CSP de Foyer, aucun projet ne se chargeait. `outils/valideurs.cjs` génère ces mêmes fonctions une fois, à la construction (`ajv-pack`), et `webpack.config.js` les substitue. Vérifié : même verdict que l'original sur un projet valide et sur un projet invalide.

D'autres bibliothèques embarquées contiennent encore `new Function` ou `eval` dans des chemins de secours. Ils ne sont pas appelés dans ce qui a été essayé ; s'ils l'étaient, le navigateur les refuserait (c'est la CSP qui garantit, pas la relecture).

## Ni nom, ni logo, ni mascotte

- **Projet par défaut** : Boulon (trois costumes, et son nom) à la place du chat ; le miaulement est retiré ; le décor vide d'origine, qui portait en commentaire l'adresse du site, est remplacé par le nôtre.
- **Bibliothèques** de personnages, costumes, décors et sons : remplacées par une liste minimale (Boulon, un décor blanc, « pop »). La bibliothèque complète arrive à l'étape suivante.
- **Images remplacées** : le logo de la barre (une maison, qui ramène à Foyer), l'icône « choisir un personnage » et « choisir un costume » (une tête de chat, devenue une tête de robot), et dix images neutralisées (logos des modes anciens, oreilles de chat, avatars, « bientôt disponible », Scratch Link).
- **Textes** (`outils/traductions.cjs`) : seuls le français et l'anglais (langue de repli de l'éditeur) sont gardés sur 82 langues. Cinq messages français qui nommaient la marque sont réécrits ; sept autres, de fonctions retirées, sont supprimés.

## Réglages de la page (`surcouche/…/foyer/index.jsx`)

Français imposé, sans menu de langue ; pas de compte, de partage, de remix, de communauté, de sac à dos ni de variables en ligne ; pas de menu Fichier ni d'enregistrement à cette étape.

## Servi sous un sous-chemin

Le module de stockage chargeait son fichier d'arrière-plan à la racine du site (`/chunks/…`). Il le charge à côté de la page (`scratch-storage/webpack.config.js`), pour que l'éditeur marche aussi quand Foyer est servi derrière un sous-chemin.

## Cible de construction

`webpack.config.js` reçoit une cible `BUILD_TYPE=foyer` : une page (`editor.html`), un fichier de code, sans carte de sources.

## Mettre à jour la version de Scratch

1. Changer `commit` et `version` dans `amont.json`.
2. Lancer `./construire.sh`. Il s'arrête si un fichier de `retraits.txt` a disparu ou si le correctif ne s'applique plus : c'est le signal qu'un écart est à revoir.
3. Relire les images de l'interface (une marque peut être réapparue) et relancer `npm run build` dans `frontend/` : il échoue si le résultat cite un hôte inconnu.
