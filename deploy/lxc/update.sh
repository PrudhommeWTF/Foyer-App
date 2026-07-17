#!/usr/bin/env bash
# Met à jour Foyer installé nativement dans un LXC : rebuild + redémarrage.
# À lancer EN ROOT dans le conteneur. Utilise le même mécanisme que install.sh.
#   • depuis un checkout local : lancez-le depuis la copie du dépôt (git pull d'abord) ;
#   • depuis Git : définissez FOYER_BRANCH si besoin, le dépôt sous APP_DIR sera mis à jour.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/foyer}"
DATA_DIR="${DATA_DIR:-/var/lib/foyer}"
SERVICE_USER="foyer"
log() { echo -e "\e[1;32m[foyer]\e[0m $*"; }

if [[ "${EUID}" -ne 0 ]]; then echo "Lancer en root." >&2; exit 1; fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." 2>/dev/null && pwd || true)"

# Réutilise install.sh : il gère copie/pull, build et redémarrage du service.
if [[ -f "${REPO_ROOT}/deploy/lxc/install.sh" ]]; then
  log "Mise à jour depuis le checkout local ${REPO_ROOT}…"
  FOYER_SRC="${REPO_ROOT}" bash "${REPO_ROOT}/deploy/lxc/install.sh"
elif [[ -f "${APP_DIR}/deploy/lxc/install.sh" ]]; then
  log "Mise à jour depuis ${APP_DIR}…"
  bash "${APP_DIR}/deploy/lxc/install.sh"
else
  echo "install.sh introuvable." >&2; exit 1
fi
