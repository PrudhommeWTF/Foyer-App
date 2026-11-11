# Atelier code

Un atelier de programmation par blocs pour les enfants : un projet est une petite histoire, des personnages sur un décor, chacun animé par des scripts faits de blocs emboîtés. Il est **construit à partir du code source ouvert de ScratchJr** (licence BSD 3 clauses), sans lien avec la Scratch Foundation ; voir [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

Les choix d'architecture et les décisions prises sont dans [`atelier-etat-des-lieux.md`](atelier-etat-des-lieux.md), la recette dans [`atelier-plan-de-test.csv`](atelier-plan-de-test.csv).

## Où en est le module

**Étape 1 sur 9 : l'éditeur s'ouvre et un script s'exécute. Rien n'est enregistré.**

| Fait | Pas encore |
|---|---|
| Éditeur du niveau « Petits codeurs » : palette, scripts, tous les blocs, scène, pages, grille, texte, mode présentation, annuler et rétablir | Enregistrement des projets (tout est en mémoire : **recharger la page efface le projet**) |
| Éditeur de dessin (sans la photo) | Entrée dans le menu, module activable, session enfant |
| Sons de l'interface et bloc « pop » | Son enregistré, photo |
| Mascotte Boulon, une étoile, un décor | Bibliothèque de personnages et de décors, projets d'exemple |
| | Hors ligne, iPhone, rotation, vue parent, partage |
| | Niveau « Grands codeurs » |

Tant que le module n'a pas d'entrée dans le menu, on l'ouvre par son adresse : `https://<ton foyer>/atelier/petits/editor.html`.

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

**Le pont.** L'application d'origine était une page web dans une coquille native, à qui elle demandait tout : la base, les fichiers, le son, le micro, la caméra. `src/tablet/OS.js` est la façade que l'éditeur appelle ; `src/tablet/Web.js` répond à la place du natif, avec les moyens du navigateur. À cette étape il garde projets et dessins en mémoire ; à l'étape suivante les mêmes fonctions appelleront `/api/atelier/*`.

**Pas de SQL dans le navigateur.** L'original fabriquait ses requêtes SQL côté client. Elles sont remplacées par des opérations nommées (`projectGet`, `projectSave`, `assetList`…) : c'est la liste exacte de ce que l'API devra offrir, et rien d'autre.

## Sécurité

- **En-têtes** : la page reçoit la CSP de Foyer, **inchangée** (`script-src 'self'`, pas d'`eval`, `connect-src 'self'`). Les deux `eval` de l'original sont supprimés.
- **Aucune donnée sortante** : statistiques d'usage et partage retirés du code, pas désactivés. Le bundle n'a aucune dépendance à l'exécution.
- **Le build échoue** si le résultat contient une adresse extérieure, un `eval`, du SQL, un reste de statistiques ou un SVG actif. Les contrôles sont dans `build-atelier.mjs`, testés par `build-atelier.test.mjs`.
- La page est statique et ne lit aucune donnée du foyer à cette étape : elle est servie sans session, comme la coquille de l'application.

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

Poids actuel : 244 fichiers, 6,1 Mo sur disque, dont 320 Ko de code. Ces fichiers sont **dans le dépôt git** (6,5 Mo, une fois pour toutes), ce qui alourdit d'autant un clone et une mise à jour.

## Modifier le code tiers

Règle : **adapter, pas réécrire**. Toute modification de `frontend/vendor/atelier/` porte un commentaire `Atelier:` dans le code et une ligne dans `MODIFICATIONS.md`, avec sa raison. Pas de conversion en TypeScript, pas de reformatage : un diff lisible avec l'original vaut plus qu'un code à notre goût.

## Ce que l'usage doit confirmer

Les essais ont été faits dans Chromium seulement (bureau à la souris, et tactile simulé en 1024 × 768). **Safari sur iPad et sur Mac n'a pas été essayé** : c'est le premier point à vérifier, colonnes iPad et Mac du plan de test.
