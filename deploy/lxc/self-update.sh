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
# Le backend s'en sert déjà pour interroger GitHub ; le téléchargement l'ignorait,
# si bien qu'un dépôt privé passait la vérification puis échouait à l'installation
# sur une demande d'identifiants. Jamais journalisé : le journal remonte à
# l'interface. shellcheck disable=SC1090
GH_TOKEN="$( ( . "$ENV_FILE" 2>/dev/null; echo "${FOYER_GITHUB_TOKEN:-}" ) )"
SERVICE_USER="foyer"
STATUS="${DATA_DIR}/update-status.json"
LOG="${DATA_DIR}/update.log"
TMP="$(mktemp -d)"

# Aucune invite d'identifiants : sans terminal, git resterait bloqué à attendre
# une saisie qui ne viendra jamais. Un dépôt injoignable doit échouer tout de
# suite, et le dire.
export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/true

# L'étape en cours, nommée pour l'utilisateur, et l'état du service : un échec
# après l'arrêt du service doit le relancer, jamais laisser l'application morte.
STEP="Préparation"
STOPPED=0
LOG_START=0
[ -f "$LOG" ] && LOG_START="$(wc -l < "$LOG")"

# printf n'échappe rien : un guillemet dans un message de git ou de npm
# produirait un JSON invalide, donc une interface qui n'affiche plus rien du
# tout. Sur une ligne, sans caractère de contrôle, et tronqué AVANT l'échappement
# (couper après pourrait sectionner un « \" » et casser le JSON), puis repassé
# par iconv pour ne pas laisser un caractère accentué coupé en deux.
json() {
  printf '%s' "$1" | tr '\n\r\t' '   ' | tr -d '\000-\037' | head -c 250 \
    | iconv -c -f UTF-8 -t UTF-8 | sed 's/\\/\\\\/g; s/"/\\"/g'
}
status() {
  printf '{"state":"%s","message":"%s","ts":%s000}\n' "$1" "$(json "$2")" "$(date +%s)" > "$STATUS"
  chown "${SERVICE_USER}:${SERVICE_USER}" "$STATUS" 2>/dev/null || true
}
step() { STEP="$1"; status running "$2"; }
cleanup() { rm -rf "$TMP"; rm -f "${DATA_DIR}/.update-trigger"; }

# « Échec de la mise à jour » tout court oblige à ouvrir un terminal pour savoir
# quoi que ce soit. On remonte donc l'étape ET la dernière ligne du journal, qui
# est presque toujours le message de la commande qui a lâché.
fail() {
  trap - ERR
  local last why
  # Uniquement les lignes de CETTE exécution, et pas nos propres bannières :
  # remonter la dernière ligne de la mise à jour précédente serait un mensonge.
  last="$(tail -n "+$((LOG_START + 1))" "$LOG" 2>/dev/null \
    | grep -vE '^[[:space:]]*$|^=+$|^\[.*\] (Mise à jour|ERROR)' | tail -n1)"
  why="${1:-Échec pendant « ${STEP} »}"
  echo "[$(date)] ERROR: ${why} | ${last}"
  status error "${why} : ${last:-voir ${LOG}}"
  if [ "$STOPPED" = 1 ]; then
    echo "Redémarrage du service après échec"
    systemctl start foyer || true
  fi
  cleanup
  exit 1
}
trap fail ERR

mkdir -p "$DATA_DIR"
exec >>"$LOG" 2>&1
echo "=========================================="
echo "[$(date)] Mise à jour Foyer — début"
rm -f "${DATA_DIR}/.update-trigger"
step "Recherche de la dernière version" "Recherche de la dernière version…"

# Un coup de réseau raté ne doit pas coûter une mise à jour : curl réessaie.
auth=(); gitc=()
if [ -n "$GH_TOKEN" ]; then
  auth=(-H "Authorization: Bearer ${GH_TOKEN}")
  # En-tête plutôt qu'identifiants dans l'URL : git recopie l'URL dans ses
  # messages d'erreur, et ces messages finissent dans le journal.
  gitc=(-c "http.extraHeader=Authorization: Bearer ${GH_TOKEN}")
fi
api() {
  curl -fsSL --retry 3 --retry-delay 2 --retry-connrefused --connect-timeout 15 \
       -H 'User-Agent: Foyer' "${auth[@]}" "$1" 2>/dev/null || true
}
TAG="$(api "https://api.github.com/repos/${REPO}/releases/latest" | grep -oP '"tag_name":\s*"\K[^"]+' | head -n1 || true)"
if [ -z "$TAG" ]; then
  TAG="$(api "https://api.github.com/repos/${REPO}/tags?per_page=100" | grep -oP '"name":\s*"\Kv?[0-9][^"]*' | sort -V | tail -n1 || true)"
fi
[ -n "$TAG" ] || fail "Impossible de déterminer la dernière version (GitHub injoignable ?)"
echo "Dernière version : $TAG"

step "Téléchargement du code" "Téléchargement du code ($TAG)…"
# L'archive d'abord : un simple GET, qui ne peut pas se transformer en dialogue
# d'authentification. git clone reste en secours (dépôt sans archive, miroir).
if [ -n "$GH_TOKEN" ]; then SRC="https://api.github.com/repos/${REPO}/tarball/${TAG}"
else SRC="https://codeload.github.com/${REPO}/tar.gz/refs/tags/${TAG}"; fi
archive() {
  rm -rf "$TMP/src"; mkdir -p "$TMP/src"
  curl -fsSL --retry 3 --retry-delay 3 --retry-connrefused --connect-timeout 15 \
       -H 'User-Agent: Foyer' "${auth[@]}" "$SRC" | tar -xz -C "$TMP/src" --strip-components=1
}
clone() {
  rm -rf "$TMP/src"
  git "${gitc[@]}" clone --depth 1 --branch "$TAG" "https://github.com/${REPO}.git" "$TMP/src"
}
archive || clone || fail "Téléchargement de ${TAG} impossible"
[ -f "$TMP/src/backend/package.json" ] || fail "Archive ${TAG} incomplète"

export NG_CLI_ANALYTICS=false DEBIAN_FRONTEND=noninteractive
step "Compilation du backend" "Compilation du backend…"
npm --prefix "$TMP/src/backend" ci
npm --prefix "$TMP/src/backend" run build
step "Compilation du frontend" "Compilation du frontend…"
npm --prefix "$TMP/src/frontend" ci
npm --prefix "$TMP/src/frontend" run build

step "Installation" "Installation…"
systemctl stop foyer || true
STOPPED=1
# Remplace le code (préserve data & node_modules ; reconstruit node_modules ensuite)
rsync -a --delete --exclude 'data' --exclude 'node_modules' "$TMP/src/backend/" "$APP_DIR/backend/"
npm --prefix "$APP_DIR/backend" ci --omit=dev
rm -rf "$APP_DIR/backend/public"
mkdir -p "$APP_DIR/backend/public"
cp -r "$TMP/src/frontend/dist/frontend/browser/." "$APP_DIR/backend/public/"
# Version déployée : enregistrée dans le fichier d'environnement (relu au
# redémarrage du service). Remplace l'ancien fichier <data>/version.
if grep -q '^FOYER_VERSION=' "$ENV_FILE"; then
  sed -i "s|^FOYER_VERSION=.*|FOYER_VERSION=${TAG#v}|" "$ENV_FILE"
else
  echo "FOYER_VERSION=${TAG#v}" >> "$ENV_FILE"
fi
rm -f "${DATA_DIR}/version"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR"

step "Redémarrage du service" "Redémarrage du service…"
systemctl start foyer
STOPPED=0

status done "Mise à jour ${TAG} installée"
echo "[$(date)] Mise à jour terminée : $TAG"
cleanup
