#!/usr/bin/env bash
# Construit l'archive de release pour l'architecture de la machine courante.
#
# Usage : scripts/release/package.sh <version> <arch attendue> <dossier de sortie>
#   ex.   scripts/release/package.sh 1.17.0 x86_64 dist-release
#
# Produit foyer-app-linux-<arch>.tar.gz et son .sha256 (noms stables, sans la
# version : un lien « latest/download/… » reste valable d'une version à l'autre).
# L'archive contient un dossier foyer-app/ prêt à lancer avec Node 22 :
#   dist/ (backend), public/ (app), node_modules/ (production, module SQLite natif
#   compris), package.json (version inscrite), LICENSE, foyer.env.example.
#
# Pas de compilation croisée : better-sqlite3 est natif, l'archive se construit
# sur l'architecture qu'elle vise, et le script refuse toute autre.
set -euo pipefail

VERSION="${1:?usage: package.sh <version> <arch> <outdir>}"
ARCH="${2:?usage: package.sh <version> <arch> <outdir>}"
OUT="${3:?usage: package.sh <version> <arch> <outdir>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

case "$(uname -m)" in
  x86_64) HOST=x86_64 ;;
  aarch64|arm64) HOST=arm64 ;;
  *) HOST="$(uname -m)" ;;
esac
[[ "$HOST" == "$ARCH" ]] || { echo "Machine $HOST, archive $ARCH demandée : pas de compilation croisée." >&2; exit 1; }

export NG_CLI_ANALYTICS=false
NAME="foyer-app-linux-${ARCH}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/foyer-app"
mkdir -p "$APP"

npm --prefix "$ROOT/backend" ci
npm --prefix "$ROOT/backend" run build
npm --prefix "$ROOT/frontend" ci
npm --prefix "$ROOT/frontend" run build

cp -r "$ROOT/backend/dist" "$APP/dist"
# Les fichiers de configuration livrés (catalogue d'Entretien, barème des Tables),
# lus depuis dist/ en ../config : sans eux, le service démarre sur ses valeurs de secours.
cp -r "$ROOT/backend/config" "$APP/config"
cp -r "$ROOT/frontend/dist/frontend/browser" "$APP/public"
cp "$ROOT/backend/package.json" "$ROOT/backend/package-lock.json" "$APP/"
cp "$ROOT/LICENSE" "$APP/LICENSE"
cp "$ROOT/deploy/foyer.env.example" "$APP/foyer.env.example"
# Dépendances de production installées à neuf ici, sur cette machine : le module
# SQLite natif est celui de cette architecture.
npm --prefix "$APP" ci --omit=dev --no-audit --no-fund
npm --prefix "$APP" cache clean --force >/dev/null 2>&1 || true
# Le repli de currentVersion() quand FOYER_VERSION n'est pas posée.
(cd "$APP" && npm pkg set "version=${VERSION}")

# Archive reproductible : ordre, propriétaires et dates fixés (date du commit).
EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$ROOT" log -1 --format=%ct)}"
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@${EPOCH}" \
    -C "$STAGE" -cf - foyer-app | gzip -n -9 > "$OUT/${NAME}.tar.gz"
(cd "$OUT" && sha256sum "${NAME}.tar.gz" > "${NAME}.tar.gz.sha256")
echo "Archive : $OUT/${NAME}.tar.gz"
cat "$OUT/${NAME}.tar.gz.sha256"
