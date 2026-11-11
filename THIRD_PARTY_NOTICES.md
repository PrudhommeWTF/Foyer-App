# Code et ressources de tiers

Foyer embarque du code écrit par d'autres. Ce fichier dit lequel, sous quelle licence, et où il se trouve.

## ScratchJr (Atelier code, niveau « Petits codeurs »)

L'Atelier code est **construit à partir du code source ouvert de ScratchJr**, publié par le Massachusetts Institute of Technology sous licence BSD 3 clauses. Il est **sans lien avec la Scratch Foundation ni approbation de sa part**. Il ne s'appelle pas ScratchJr et n'en reprend ni le nom, ni le logo, ni les personnages.

- Source : <https://github.com/scratchfoundation/scratchjr>, commit `ff15b0f` (8 avril 2022), version 1.2.0.
- Emplacement : `frontend/vendor/atelier/petits/`.
- Ce qui a été changé : `frontend/vendor/atelier/petits/MODIFICATIONS.md`.
- Dans l'application servie : `atelier/petits/LICENSE.txt`, et la notice en tête de `atelier/petits/app.bundle.js`.

Les marques Scratch (le nom Scratch, le logo, le chat Scratch, Gobo, Pico, Nano, Tera et Giga) appartiennent à leurs titulaires. Aucune n'est utilisée ici.

Texte de la licence :

```
Copyright (c) 2016, Massachusetts Institute of Technology
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Ce code n'embarque plus aucune bibliothèque tierce : Snap.svg (Apache 2.0), `intl` et `intl-messageformat`, dont l'original dépendait, ont été remplacés par des fonctions du navigateur.

## Bibliothèque de Scratch (personnages et décors de l'Atelier code)

`frontend/vendor/atelier/bibliotheque/fichiers/` contient 212 personnages et 17 décors issus de la bibliothèque de Scratch (les « support materials » de <https://scratch.mit.edu>), sous licence **Creative Commons Attribution-ShareAlike 2.0** (<https://creativecommons.org/licenses/by-sa/2.0/>). Ces fichiers ne sont pas sous la licence de Foyer.

> Scratch is developed by the Lifelong Kindergarten Group at the MIT Media Lab. See http://scratch.mit.edu.

Les éléments qui sont aussi des marques (le chat Scratch, Gobo, Pico, Nano, Tera, Giga, et toute image montrant le nom ou le logo) n'ont pas été repris : voir `frontend/vendor/atelier/bibliotheque/exclusions.json`. Détail, modifications apportées et licence : `frontend/vendor/atelier/bibliotheque/LICENCE.md`, reproduit dans l'application servie (`atelier/petits/svglibrary/LICENCE.md`) et cité dans l'écran « Atelier code », rubrique « À propos ».

### Police Roboto

`frontend/vendor/atelier/petits/www/assets/fonts/` contient trois fichiers de la police Roboto (Google, licence Apache 2.0), repris du dépôt ScratchJr.

### Plan de test

`docs/atelier-plan-de-test.csv` reprend le texte de `doc/scratchjr_testplan.csv` du même dépôt, sous la même licence.
