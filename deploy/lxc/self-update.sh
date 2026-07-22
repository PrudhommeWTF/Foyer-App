#!/usr/bin/env bash
# ============================================================
# Foyer — mise à jour auto (exécutée EN ROOT par systemd).
# Déclenchée par le path-unit foyer-update.path lorsque le backend crée le
# fichier ${DATA_DIR}/.update-trigger. Ne pas lancer à la main normalement.
#
# Télécharge la dernière release/tag depuis GitHub, recompile, remplace le code
# et redémarre le service foyer. La progression est écrite dans
# ${DATA_DIR}/update-status.json (lu par l'interface).
# ============================================================
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/foyer}"
ENV_FILE="/etc/foyer/foyer.env"
# shellcheck disable=SC1090
DATA_DIR="$( ( . "$ENV_FILE" 2>/dev/null; echo "${FOYER_DATA_DIR:-/var/lib/foyer}" ) )"
REPO="${FOYER_GITHUB_REPO:-PrudhommeWTF/Foyer-App}"
SERVICE_USER="foyer"
STATUS="${DATA_DIR}/update-status.json"
LOG="${DATA_DIR}/update.log"
TMP="$(mktemp -d)"

status() {
  printf '{"state":"%s","message":"%s","ts":%s000}\n' "$1" "$2" "$(date +%s)" > "$STATUS"
  chown "${SERVICE_USER}:${SERVICE_USER}" "$STATUS" 2>/dev/null || true
}
cleanup() { rm -rf "$TMP"; rm -f "${DATA_DIR}/.update-trigger"; }
fail() { status error "$1"; echo "[$(date)] ERROR: $1" >> "$LOG"; cleanup; exit 1; }
trap 'fail "Échec de la mise à jour (voir ${LOG})"' ERR

mkdir -p "$DATA_DIR"
exec >>"$LOG" 2>&1
echo "=========================================="
echo "[$(date)] Mise à jour Foyer — début"
rm -f "${DATA_DIR}/.update-trigger"
status running "Recherche de la dernière version…"

TAG="$(curl -fsSL -H 'User-Agent: Foyer' "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep -oP '"tag_name":\s*"\K[^"]+' | head -n1 || true)"
if [ -z "$TAG" ]; then
  TAG="$(curl -fsSL -H 'User-Agent: Foyer' "https://api.github.com/repos/${REPO}/tags?per_page=100" 2>/dev/null | grep -oP '"name":\s*"\Kv?[0-9][^"]*' | sort -V | tail -n1 || true)"
fi
[ -n "$TAG" ] || fail "Impossible de déterminer la dernière version"
echo "Dernière version : $TAG"

status running "Téléchargement du code ($TAG)…"
git clone --depth 1 --branch "$TAG" "https://github.com/${REPO}.git" "$TMP/src" \
  || git clone --depth 1 "https://github.com/${REPO}.git" "$TMP/src"

export NG_CLI_ANALYTICS=false DEBIAN_FRONTEND=noninteractive
status running "Compilation du backend…"
npm --prefix "$TMP/src/backend" ci
npm --prefix "$TMP/src/backend" run build
status running "Compilation du frontend…"
npm --prefix "$TMP/src/frontend" ci
npm --prefix "$TMP/src/frontend" run build

status running "Installation…"
systemctl stop foyer || true
# Remplace le code (préserve data & node_modules ; reconstruit node_modules ensuite)
rsync -a --delete --exclude 'data' --exclude 'node_modules' "$TMP/src/backend/" "$APP_DIR/backend/"
npm --prefix "$APP_DIR/backend" ci --omit=dev
rm -rf "$APP_DIR/backend/public"
mkdir -p "$APP_DIR/backend/public"
cp -r "$TMP/src/frontend/dist/frontend/browser/." "$APP_DIR/backend/public/"
echo "${TAG#v}" > "${DATA_DIR}/version"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR" "${DATA_DIR}/version"

status running "Redémarrage du service…"
systemctl start foyer

status done "Mise à jour ${TAG} installée"
echo "[$(date)] Mise à jour terminée : $TAG"
cleanup
