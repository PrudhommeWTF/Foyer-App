# Publier une version

Une release GitHub se publie **en poussant un tag**. Le workflow
`.github/workflows/release.yml` fait le reste, et ne publie rien si une
seule étape échoue :

1. **Contrôle du tag** (`scripts/release/check-tag.sh`) : format, ordre des versions, appartenance à `main`.
2. **Mêmes contrôles que la CI** : recherche de secrets, audit des dépendances, builds, tests, typage, code mort.
3. **Build** d'une archive par architecture, sur runner natif, dans un conteneur Debian 13 (`scripts/release/package.sh`).
4. **Essai de fumée** de chaque archive, lancée comme en production (`scripts/release/smoke.sh`) : empreinte, architecture du module SQLite, démarrage, `/api/health`, page d'accueil, onboarding (écriture réelle en base), version annoncée.
5. **Image Docker** (job `image`, une exécution par architecture sur son runner natif, en parallèle des points 3 et 4) : `linux/amd64` et `linux/arm64` sont construites **chacune sur sa machine** (plus d'émulation QEMU), essai de fumée de chaque image (`scripts/release/smoke-image.sh`), poussée sur GHCR **par empreinte seulement**, sans étiquette.
6. **Index multi-architecture** (job `manifest`) : une fois archives et images réussies, les empreintes par architecture sont réunies en un index multi-architecture, étiqueté `1.17.0`, `1.17`, `1` et `latest`.
7. **Publication** : vérification des empreintes, puis création de la release avec `gh`, notes générées automatiquement, précédées de la commande `docker pull` et du digest de l'image.

Il n'y a pas d'autre publication d'image : ni sur `main`, ni à la main. Un test (`backend/test/release-image.test.ts`) refuse tout autre workflow qui demanderait `packages: write`.

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

## Image Docker

`ghcr.io/prudhommewtf/foyer-app`, multi-architecture (`linux/amd64`, `linux/arm64`), construite par le `Dockerfile` du dépôt avec `FOYER_VERSION` en build-arg.

| Tag Git | Étiquettes posées |
|---|---|
| `v1.17.0` (stable) | `1.17.0`, `1.17`, `1`, `latest` |
| `v1.18.0-rc.1` (préversion) | `1.18.0-rc.1`, `next` |

Une préversion ne touche jamais `latest`, ni la mineure, ni la majeure.

**Labels et annotations OCI** (`docker/metadata-action`) : `org.opencontainers.image.source` (le dépôt : c'est lui qui rattache le package au dépôt et fait apparaître l'image dans sa colonne *Packages*), `version`, `revision`, `created`, `licenses` (MIT), `title` et `description`. La description est aussi posée en annotation sur l'index multi-architecture : c'est là que la page du package la lit.

**Pourquoi l'empreinte d'abord.** Les jobs `build` et `image` tournent en parallèle. Si une image était étiquetée dans son job, un échec du build arm64 des archives laisserait `latest` sur une version sans release. Chaque job `image` pousse donc **son** image d'architecture sans étiquette (`push-by-digest=true`), invisible pour qui ne connaît pas son digest ; le job `manifest` n'assemble l'index étiqueté qu'une fois tout réussi, par `docker buildx imagetools create` (qui réunit les empreintes sans reconstruire), et vérifie que chaque étiquette pointe bien sur lui. Un échec laisse au pire des **images sans étiquette** dans le package, inoffensives (voir *Rétention*).

**Pourquoi des runners natifs.** `linux/amd64` tourne sur un runner x86, `linux/arm64` sur un runner ARM (`ubuntu-24.04-arm`), comme les archives. L'émulation QEMU précédente était fragile : son `npm ci` arm64 pouvait planter (« illegal instruction ») puis se figer, et bloquer la release jusqu'au délai du job. En natif, c'est aussi plus rapide (les deux architectures en parallèle, sans émulation).

**Droits.** `packages: write` est donné aux jobs `image` (un par architecture) et `manifest`, et à eux seuls. Le job `publish` n'a que `contents: write` ; le reste du workflow, `contents: read`.

**Cache.** Les couches sont mises en cache dans le cache GitHub Actions, une portée par architecture (`type=gha`, `scope=image-<arch>`, `mode=max`). Dans un même job, l'essai de fumée et la poussée par empreinte partagent ce cache : l'image n'est construite qu'une fois par exécution, et d'une release à l'autre seules les couches touchées sont refaites. `better-sqlite3` n'est pas recompilé : `npm ci` télécharge son binaire précompilé pour chaque architecture. Le cache GitHub est limité à 10 Go par dépôt et évince les entrées les plus anciennes.

### Essai de fumée de l'image

`scripts/release/smoke-image.sh <image> <version> [plateforme]` :

1. plateforme de l'image et labels OCI (`source`, `version`, `licenses`, `description`), label `version` égal à la version du tag ;
2. `FOYER_VERSION` inscrite dans l'image ;
3. démarrage comme `docker-compose.yml` le lance : `--read-only`, `--tmpfs /tmp`, `--cap-drop ALL`, `no-new-privileges`, port sur `127.0.0.1` ;
4. à 6. : les mêmes contrôles HTTP que pour l'archive (`scripts/release/smoke-api.sh`) : `/api/health`, page d'accueil, onboarding, version annoncée par `/api/system/version`.

Un échec arrête le job avant la connexion à GHCR : rien n'est poussé.

### Rejouer en local

Ce qu'a fait la vérification de cette mise en place (Docker 29, buildx 0.37), à reproduire avant de modifier le `Dockerfile` ou le job :

```bash
# QEMU pour arm64, une fois par machine
docker run --privileged --rm tonistiigi/binfmt --install arm64

# Builder multi-plateforme (le pilote « docker » sait charger une seule plateforme)
docker buildx create --name foyer --driver docker-container --use
docker buildx inspect --bootstrap

# amd64 chargée dans le démon, puis essai
docker buildx build --platform linux/amd64 --load -t foyer-app:smoke \
  --build-arg FOYER_VERSION=1.17.1 \
  --label org.opencontainers.image.source=https://github.com/PrudhommeWTF/Foyer-App \
  --label org.opencontainers.image.version=1.17.1 \
  --label org.opencontainers.image.licenses=MIT \
  --label "org.opencontainers.image.description=Foyer" .
scripts/release/smoke-image.sh foyer-app:smoke 1.17.1 linux/amd64

# Les deux plateformes, sans rien charger ni pousser (contrôle de build seul)
docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg FOYER_VERSION=1.17.1 --output type=image,push=false .
```

Pour essayer aussi l'arm64 sous QEMU, recharger la même image en `--platform linux/arm64 --load` (le cache rend l'opération immédiate) puis `smoke-image.sh foyer-app:smoke linux/arm64` : une douzaine de secondes.

### Rendre le package public (une fois)

Un package GHCR naît **privé**, et sa visibilité est un réglage du **package**, pas du dépôt. Tant qu'il est privé, `docker pull` sans `docker login` échoue (`unauthorized` / `denied`). Le package `foyer-app` existe déjà (créé par l'ancien `docker.yml`) ; un `docker pull` anonyme y était refusé à la mise en place de ce job, signe qu'il est privé.

1. Ouvrir `https://github.com/PrudhommeWTF?tab=packages` (ou : avatar → *Your profile* → onglet **Packages**), puis le package **foyer-app**. Accès direct : `https://github.com/users/PrudhommeWTF/packages/container/package/foyer-app`.
2. Dans la colonne de droite, tout en bas : **Package settings**.
3. Section **Danger Zone** → **Change visibility**.
4. Choisir **Public**, taper `foyer-app` pour confirmer, puis **I understand the consequences, change package visibility**.

Sur la même page **Package settings**, vérifier aussi :

- **Manage Actions access** : le dépôt `Foyer-App` doit y figurer avec le rôle **Write**, sinon le `GITHUB_TOKEN` du workflow ne peut pas pousser (`denied: permission_denied: write_package`). Il y est déjà si le package a été créé par un workflow de ce dépôt ; sinon **Add Repository** → `Foyer-App` → rôle *Write*.
- **Repository source** : doit indiquer `PrudhommeWTF/Foyer-App` (posé par le label `org.opencontainers.image.source`).

Un package public ne peut plus redevenir privé. Contrôle, depuis une machine sans session GHCR :

```bash
docker logout ghcr.io
docker pull ghcr.io/prudhommewtf/foyer-app:latest

# ou sans Docker : un jeton anonyme n'est délivré que pour un package public
curl -fsS "https://ghcr.io/token?scope=repository:prudhommewtf/foyer-app:pull&service=ghcr.io"
```

### Rétention

GHCR garde **toutes** les versions, sans limite de durée ; le stockage et le transfert d'un package public sont gratuits. Trois sortes de versions s'accumulent :

- les releases stables : à garder, quelqu'un peut avoir épinglé `1.17.0` ;
- les préversions (`1.18.0-rc.1`…), qui gardent leur numéro quand `next` avance ;
- les **versions sans étiquette** : index poussés par une exécution qui a échoué ensuite, et anciens `sha-…` / `latest` de l'ancien `docker.yml`.

Recommandation : **pas de nettoyage automatique des préversions pour l'instant.** Le volume est faible (une poignée de rc par version), un rc supprimé casse qui l'a épinglé, et rien ne coûte. Un ménage à la main de temps en temps suffit (page du package → **Package settings** → **Manage versions**, ou l'API `DELETE /user/packages/container/foyer-app/versions/<id>`). Si un nettoyage automatique devient utile, le limiter aux **versions sans étiquette de plus de 30 jours**, avec un outil qui comprend le multi-architecture (par exemple `dataaxiom/ghcr-cleanup-action`). Attention au piège : dans GHCR, les manifestes par plateforme d'une image multi-arch apparaissent eux aussi comme versions **sans étiquette** ; un `actions/delete-package-versions` avec `delete-only-untagged-versions: true` les supprimerait et casserait `latest`.

Les anciennes étiquettes `sha-…` poussées par `docker.yml` jusqu'à la 1.17.0 peuvent être supprimées à la main : plus rien ne les produit.

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

Suivre l'exécution dans l'onglet **Actions**, workflow « Release ». La release apparaît à la fin, une fois les deux archives et l'image construites et essayées ; les étiquettes de l'image juste avant.

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

Pour un échec passager (runner perdu, réseau, registre), le bouton **Re-run failed jobs** suffit, sans toucher au tag. Rejouer `image` repousse le même contenu (même empreinte si rien n'a changé, sinon une nouvelle, et seule la nouvelle sera étiquetée). Il échouera au contrôle de l'ordre si un tag plus récent a été poussé entre-temps.

Ne jamais déplacer un tag d'une version **déjà publiée** et installée : les foyers qui l'ont ne verraient pas le changement. Publier plutôt la version suivante.

## Vérifier une release publiée

Image :

```bash
docker buildx imagetools inspect ghcr.io/prudhommewtf/foyer-app:1.17.0
```

Le digest affiché (`Digest:`) doit être celui des notes de release, et les plateformes `linux/amd64` et `linux/arm64` présentes. Les entrées `unknown/unknown` sont les attestations de provenance de buildx, pas des images.

Archives :

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
