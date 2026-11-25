# Bibliothèque de personnages, de décors et de sons de l'Atelier code

Les fichiers du dossier `fichiers/` (dessins SVG, images PNG, sons WAV) viennent de la bibliothèque de Scratch (les « support materials » de <https://scratch.mit.edu>). Ils ne sont **pas** sous la licence de Foyer.

**Licence : Creative Commons Attribution-ShareAlike 2.0** (<https://creativecommons.org/licenses/by-sa/2.0/>).

**Attribution**, dans les termes demandés par les conditions d'utilisation de Scratch :

> Scratch is developed by the Lifelong Kindergarten Group at the MIT Media Lab. See http://scratch.mit.edu.

## Ce que dit la licence, en clair

- Ces fichiers peuvent être copiés, redistribués et modifiés, y compris à des fins commerciales.
- À condition de **citer la source** (le paragraphe ci-dessus) et de redistribuer les fichiers, modifiés ou non, **sous la même licence**.
- Le partage à l'identique ne porte que sur ces fichiers et leurs adaptations. Il ne s'étend ni au code de Foyer, ni aux projets des enfants.

## Ce qui a été modifié

Chaque dessin SVG a été **nettoyé** par le script `backend/scripts/atelier-bibliotheque.ts` : prologue, commentaires et éléments hors d'une liste blanche retirés, document reconstruit. Le dessin n'est pas retouché. Les images PNG et les sons WAV sont repris tels quels. Le nom du fichier reste l'empreinte MD5 du fichier **d'origine**, pour en garder la trace. `catalogue.json` (Petits codeurs) et `grands/*.json` (Grands codeurs) donnent le nom français de chaque élément ; `noms.json` fait le lien avec son nom chez Scratch.

## Ce qui n'a pas été repris

Les conditions d'utilisation de Scratch excluent de cette licence ce qui est aussi une marque (points 5.4 et 5.5). `exclusions.json` liste ce qui a été écarté et pourquoi : les mascottes déposées (le chat Scratch, Gobo, Pico, Nano, Tera, Giga) et le miaulement du chat, les images qui montrent le nom ou le logo, et quelques cas de doute. Treize personnages qui sont des **photographies de personnes réelles** sont écartés aussi : la licence couvre l'image, pas le droit de chacun sur la sienne. La sélection a été faite par une revue visuelle de chaque image retenue.

Cette bibliothèque est distribuée sans lien avec la Scratch Foundation ni approbation de sa part.

## Ajouter ses propres dessins

Voir `docs/atelier.md`, « Ajouter un personnage ».
