#!/usr/bin/env bash
# Construit l'éditeur du niveau « Grands codeurs » de l'Atelier code à partir du
# code source de Scratch, et range le résultat dans dist/ (commité dans Foyer).
#
# À lancer À LA MAIN, sur un poste de développement ou en CI, quand on change la
# version de Scratch épinglée (amont.json) ou l'une de nos modifications. Jamais
# sur le serveur : `npm run build` de Foyer ne fait que recopier dist/.
#
#   ./construire.sh                    clone le dépôt d'origine dans un dossier temporaire
#   ./construire.sh --source <dossier> réutilise un clone existant (remis à l'état épinglé)
#
# Besoins : git, Node 22 ou plus, environ 2 Go de disque et 6 Go de mémoire, et
# le réseau vers github.com et le registre npm. Compter une dizaine de minutes.
#
# Étapes : clone au commit épinglé, suppression des fichiers de retraits.txt,
# copie de surcouche/, application de correctifs/, installation, validateurs et
# traductions générés (outils/), construction des paquets puis de la page, tri
# du résultat. Chaque écart avec l'original est décrit dans MODIFICATIONS.md.
set -euo pipefail

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lire() { node -e "console.log(require('$ICI/amont.json')['$1'])"; }
DEPOT="$(lire depot)"; COMMIT="$(lire commit)"

SOURCE=""
if [ "${1:-}" = "--source" ]; then SOURCE="$(cd "$2" && pwd)"; fi
if [ -z "$SOURCE" ]; then
  SOURCE="$(mktemp -d)/scratch-editor"
  echo "[atelier] clone de $DEPOT dans $SOURCE"
  git clone --quiet --filter=blob:limit=2m "$DEPOT" "$SOURCE"
fi

cd "$SOURCE"
echo "[atelier] remise à l'état d'origine, commit $COMMIT"
git fetch --quiet origin "$COMMIT" 2>/dev/null || true
git checkout --quiet --force "$COMMIT"
git clean --quiet -fd -- packages
git reset --quiet --hard "$COMMIT"

echo "[atelier] retraits, surcouche, correctifs"
grep -v '^#' "$ICI/retraits.txt" | grep . | while read -r chemin; do
  [ -e "$chemin" ] || { echo "ERREUR : $chemin n'existe plus dans l'original, retraits.txt est à revoir" >&2; exit 1; }
  rm -rf "$chemin"
done
cp -r "$ICI/surcouche/." .
git apply --whitespace=nowarn "$ICI"/correctifs/*.patch

echo "[atelier] installation des dépendances"
npm ci --ignore-scripts --no-audit --no-fund
npm install --no-save --ignore-scripts --no-audit --no-fund ajv-pack@0.3.1

echo "[atelier] validateurs et traductions"
node "$ICI/outils/valideurs.cjs" "$SOURCE"
node "$ICI/outils/traductions.cjs" "$SOURCE"

export NODE_ENV=production CI=1 NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"
(cd packages/task-herder && npm run build)
for paquet in scratch-storage scratch-svg-renderer scratch-paint scratch-render scratch-vm; do
  echo "[atelier] construction de $paquet"
  (cd "packages/$paquet" && npx webpack --mode=production)
done
echo "[atelier] construction de la page"
(cd packages/scratch-gui && rm -rf dist-foyer && BUILD_TYPE=foyer npx webpack)

# Tri du résultat : la page, son code, les images des blocs, les notices des
# bibliothèques embarquées, et la petite bibliothèque de départ. Rien d'autre.
RESULTAT="packages/scratch-gui/dist-foyer"
rm -rf "$ICI/dist" && mkdir -p "$ICI/dist/static" "$ICI/dist/bibliotheque"
cp "$RESULTAT/editor.html" "$RESULTAT/atelier.js" "$RESULTAT/atelier.js.LICENSE.txt" "$ICI/dist/"
cp -r "$RESULTAT/static/blocks-media" "$ICI/dist/static/"
[ -d "$RESULTAT/static/assets" ] && cp -r "$RESULTAT/static/assets" "$ICI/dist/static/"
[ -d "$RESULTAT/chunks" ] && find "$RESULTAT/chunks" -maxdepth 1 -name 'fetch-worker*.js' -exec sh -c 'mkdir -p "$1/dist/chunks" && cp "$2" "$1/dist/chunks/"' _ "$ICI" {} \;
cp packages/scratch-gui/src/lib/default-project/*.svg packages/scratch-gui/src/lib/default-project/*.wav "$ICI/dist/bibliotheque/"
cp LICENSE "$ICI/dist/LICENSE.txt"
echo "[atelier] terminé : $(find "$ICI/dist" -type f | wc -l) fichiers, $(du -sh "$ICI/dist" | cut -f1)"
