# Publier une version

Une release GitHub se publie **en poussant un tag**. Le workflow
`.github/workflows/release.yml` fait le reste, et ne publie rien si une
seule étape échoue :

1. **Contrôle du tag** (`scripts/release/check-tag.sh`) : format, ordre des versions, appartenance à `main`.
2. **Mêmes contrôles que la CI** : recherche de secrets, audit des dépendances, builds, tests, typage, code mort.
3. **Build** d'une archive par architecture, sur runner natif, dans un conteneur Debian 13 (`scripts/release/package.sh`).
4. **Essai de fumée** de chaque archive, lancée comme en production (`scripts/release/smoke.sh`) : empreinte, architecture du module SQLite, démarrage, `/api/health`, page d'accueil, onboarding (écriture réelle en base), version annoncée.
5. **Publication** : vérification des empreintes, puis création de la release avec `gh`, notes générées automatiquement.

Le même tag déclenche aussi `docker.yml`, qui publie l'image sur GHCR.

## Ce que contient une release

| Fichier | Contenu |
|---|---|
| `foyer-app-linux-x86_64.tar.gz` | Application prête à lancer, pour x86_64 |
| `foyer-app-linux-arm64.tar.gz` | Application prête à lancer, pour ARM64 |
| `*.tar.gz.sha256` | Empreinte SHA-256 de chaque archive |

Les noms ne portent pas la version : un lien
`https://github.com/<owner>/Foyer-App/releases/latest/download/foyer-app-linux-x86_64.tar.gz`
reste valable d'une version à l'autre.

Chaque archive contient un dossier `foyer-app/` :

- `dist/` : backend compilé ;
- `public/` : application web compilée ;
- `node_modules/` : dépendances de production, module SQLite natif de l'architecture compris ;
- `package.json` : la version y est inscrite, inutile de poser `FOYER_VERSION` ;
- `LICENSE`, `foyer.env.example`.

Il faut **Node.js 22** sur la machine. Le module SQLite exige glibc 2.29 ou plus récente, ce qui couvre Debian 11 et au-delà. L'archive x86_64 a été essayée sous Debian 12 et 13.

```bash
tar -xzf foyer-app-linux-x86_64.tar.gz
cp foyer-app/foyer.env.example foyer.env   # puis remplir FOYER_JWT_SECRET et FOYER_SECRET_KEY
set -a; . ./foyer.env; set +a
node foyer-app/dist/server.js
```

L'installation LXC (`deploy/lxc/`) et l'auto-mise à jour ne se servent pas de ces archives : elles téléchargent toujours le code source du tag et le compilent sur place.

## Schéma de tag

**`vX.Y.Z`** pour une version stable, **`vX.Y.Z-rc.N`** pour une préversion. Le premier tag de ce schéma est `v1.17.0`.

- La **version du projet, c'est le tag.** Les `package.json` restent à `0.0.0` : seule l'archive reçoit la version.
- La **cohérence se contrôle par l'ordre.** Le tag doit être strictement supérieur à la plus haute version déjà taguée, au sens de `semverCmp`, la comparaison même qu'utilise la page des mises à jour. Les anciens tags sans `v` (`1.16.7`…) comptent aussi.
  - Une préversion précède la version qu'elle prépare : `v1.17.0-rc.1 < v1.17.0`.
  - Un tag inférieur ne serait proposé à aucun foyer : il est refusé.
- Le commit tagué doit appartenir à `main`.
- Une **préversion** est publiée comme telle et jamais marquée « Latest ». Seuls les foyers réglés sur le canal « préversions » la voient arriver.
- Pas de métadonnées de build (`+…`) ni de tag sans `v` : le workflow ne se déclenche que sur `v*`, et le contrôle refuse le reste.

**Quand changer :**
- `Z` : correctifs ;
- `Y` : nouvelle fonctionnalité ou nouveau réglage ;
- `X` : rupture qui demande une action de l'administrateur (variable d'environnement obligatoire, migration manuelle, déploiement modifié).

## Publier

```bash
git switch main && git pull --ff-only

# Le commit doit contenir le workflow : un tag posé sur un commit qui ne l'a pas
# ne déclenche rien. Cette commande doit afficher le chemin du fichier.
git ls-tree --name-only HEAD .github/workflows/release.yml

# Facultatif mais conseillé : le même contrôle que le workflow, en local.
git tag -a v1.17.0 -m "Foyer 1.17.0"
scripts/release/check-tag.sh v1.17.0

git push origin v1.17.0
```

Le contrôle local du tag demande Node 22 et l'historique à jour (`git fetch origin --tags`).

Suivre l'exécution dans l'onglet **Actions**, workflow « Release ». La release apparaît à la fin, une fois les deux archives construites et essayées.

### Ne pas créer la release à la main

Jusqu'à `1.16.7`, les releases se créaient depuis la page GitHub. **C'est fini** : on pousse le tag, le workflow crée la release à la toute fin.

Une release créée à la main existe **avant** ses fichiers. Pendant tout le build, elle est vide, et elle est marquée « Latest ». Or tout ce qui lit `releases/latest` la voit immédiatement :
- la page des mises à jour de chaque foyer ;
- l'auto-mise à jour LXC ;
- un script qui télécharge `latest/download/…` (il échoue).

Et si le build échoue ensuite, cette release vide reste en place.

Si cela arrive quand même, le workflow ne casse pas : il téléverse les fichiers dans la release existante (`--clobber`) et la publie (ni brouillon, et `--latest` pour une stable).

### Forks

Un dépôt forké a GitHub Actions **désactivé par défaut** : l'activer dans l'onglet *Actions* du fork avant de pousser un tag, sinon rien ne se déclenche. Les runners ARM (`ubuntu-24.04-arm`) sont gratuits pour un dépôt public. Pour un dépôt privé, vérifier qu'ils sont disponibles sur le compte.

## Refaire un tag raté

Si le workflow a échoué (contrôle, test, build), corriger sur `main`, puis reposer le **même** tag sur le nouveau commit :

```bash
git push origin :refs/tags/v1.17.0   # supprime le tag distant
git tag -d v1.17.0                   # supprime le tag local
git switch main && git pull --ff-only
git tag -a v1.17.0 -m "Foyer 1.17.0"
git push origin v1.17.0
```

Si une release (même vide ou en brouillon) a été créée pour ce tag, la supprimer depuis la page GitHub **avant** de repousser le tag. Sinon elle reste rattachée à l'ancien commit.

Pour un échec passager (runner perdu, réseau), le bouton **Re-run failed jobs** suffit, sans toucher au tag. Il échouera au contrôle de l'ordre si un tag plus récent a été poussé entre-temps.

Ne jamais déplacer un tag d'une version **déjà publiée** et installée : les foyers qui l'ont ne verraient pas le changement. Publier plutôt la version suivante.

## Vérifier une release publiée

```bash
mkdir verif && cd verif
gh release download v1.17.0 --repo <owner>/Foyer-App
sha256sum -c ./*.sha256
```

Chaque ligne doit afficher `OK`. Sans `gh`, télécharger les fichiers depuis la page de la release et lancer la même commande `sha256sum -c`.

Pour rejouer l'essai de fumée sur une archive téléchargée (Linux, Node 22, `curl` et `file` installés) :

```bash
scripts/release/smoke.sh verif/foyer-app-linux-x86_64.tar.gz 1.17.0 x86_64
```
