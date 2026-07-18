#!/usr/bin/env bash
# ============================================================
# Foyer — installation native dans un conteneur LXC (Debian/Ubuntu).
# À lancer EN ROOT à l'intérieur du conteneur :
#   bash deploy/lxc/install.sh
#
# Deux modes de récupération du code :
#   • depuis un checkout local  : lancez le script depuis une copie du dépôt
#                                 (recommandé, fonctionne aussi pour un dépôt privé) ;
#   • depuis Git                : définissez FOYER_REPO / FOYER_BRANCH et lancez
#                                 le script seul (dépôt public requis, ou URL avec token).
#
# Variables d'environnement (optionnelles) :
#   FOYER_REPO      URL Git (défaut: https://github.com/PrudhommeWTF/Foyer-App.git)
#   FOYER_BRANCH    branche à déployer (défaut: main)
#   FOYER_SRC       chemin d'une copie locale du dépôt (sinon auto-détecté / cloné)
#   APP_DIR         dossier d'installation du code (défaut: /opt/foyer)
#   DATA_DIR        dossier des données SQLite (défaut: /var/lib/foyer)
#   PORT            port d'écoute (défaut: 8099)
#   ADMIN_EMAIL / ADMIN_PASSWORD   compte initial
# ============================================================
set -euo pipefail

FOYER_REPO="${FOYER_REPO:-https://github.com/PrudhommeWTF/Foyer-App.git}"
FOYER_BRANCH="${FOYER_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/foyer}"
DATA_DIR="${DATA_DIR:-/var/lib/foyer}"
PORT="${PORT:-8099}"
ADMIN_EMAIL="${ADMIN_EMAIL:-camille.martin@email.fr}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-foyer}"
ENV_FILE="/etc/foyer/foyer.env"
SERVICE_USER="foyer"

# Build Angular non-interactif : ne pas demander le partage de données d'usage.
export NG_CLI_ANALYTICS=false

log() { echo -e "\e[1;32m[foyer]\e[0m $*"; }
err() { echo -e "\e[1;31m[foyer]\e[0m $*" >&2; }

if [[ "${EUID}" -ne 0 ]]; then err "Ce script doit être lancé en root."; exit 1; fi

# --- Garde-fou : refuser l'exécution sur un hôte Proxmox VE ---------------
# Ce script installe Foyer DANS un conteneur, pas sur l'hyperviseur.
if [[ -z "${ALLOW_HOST:-}" ]] && { command -v pct >/dev/null 2>&1 || [[ -d /etc/pve ]]; }; then
  err "Vous semblez être sur l'hôte Proxmox VE, pas dans un conteneur."
  err "→ Créez un LXC avec :  bash deploy/lxc/proxmox-create.sh"
  err "  (ou, si vous êtes bien dans un conteneur, forcez avec :  ALLOW_HOST=1 bash deploy/lxc/install.sh )"
  exit 1
fi

# --- Source : checkout local auto-détecté, sinon clone --------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." 2>/dev/null && pwd || true)"
if [[ -z "${FOYER_SRC:-}" ]]; then
  if [[ -d "${REPO_ROOT}/frontend" && -d "${REPO_ROOT}/backend" ]]; then
    FOYER_SRC="${REPO_ROOT}"
  fi
fi

log "Installation des dépendances système…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git rsync build-essential python3 >/dev/null

# --- Node.js 22 (via NodeSource si absent ou trop ancien) -----------------
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  log "Installation de Node.js 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
log "Node $(node -v) / npm $(npm -v)"

# --- Utilisateur de service ----------------------------------------------
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  log "Création de l'utilisateur système ${SERVICE_USER}…"
  useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

# --- Récupération du code -------------------------------------------------
mkdir -p "${APP_DIR}"
if [[ -n "${FOYER_SRC:-}" ]]; then
  log "Copie du code depuis ${FOYER_SRC}…"
  rsync -a --delete \
    --exclude '.git' --exclude 'node_modules' --exclude 'frontend/dist' \
    --exclude 'backend/dist' --exclude 'backend/public' --exclude 'data' \
    "${FOYER_SRC}/" "${APP_DIR}/"
elif [[ -d "${APP_DIR}/.git" ]]; then
  log "Mise à jour du dépôt existant (${FOYER_BRANCH})…"
  git -C "${APP_DIR}" fetch --depth 1 origin "${FOYER_BRANCH}"
  git -C "${APP_DIR}" checkout -f "${FOYER_BRANCH}"
  git -C "${APP_DIR}" reset --hard "origin/${FOYER_BRANCH}"
else
  log "Clonage de ${FOYER_REPO} (${FOYER_BRANCH})…"
  git clone --depth 1 --branch "${FOYER_BRANCH}" "${FOYER_REPO}" "${APP_DIR}"
fi

# --- Build backend + frontend --------------------------------------------
log "Build du backend…"
npm --prefix "${APP_DIR}/backend" ci
npm --prefix "${APP_DIR}/backend" run build

log "Build du frontend (peut nécessiter ~1,5 Go de RAM)…"
npm --prefix "${APP_DIR}/frontend" ci
npm --prefix "${APP_DIR}/frontend" run build

log "Déploiement de l'app compilée…"
rm -rf "${APP_DIR}/backend/public"
mkdir -p "${APP_DIR}/backend/public"
cp -r "${APP_DIR}/frontend/dist/frontend/browser/." "${APP_DIR}/backend/public/"

# On peut retirer node_modules du frontend (inutile au runtime) pour alléger.
rm -rf "${APP_DIR}/frontend/node_modules"

# --- Données & fichier d'environnement -----------------------------------
mkdir -p "${DATA_DIR}"
mkdir -p "$(dirname "${ENV_FILE}")"
if [[ ! -f "${ENV_FILE}" ]]; then
  log "Création de ${ENV_FILE} (secret JWT généré)…"
  JWT="$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 48)"
  cat > "${ENV_FILE}" <<EOF
# Configuration Foyer — éditez puis: systemctl restart foyer
PORT=${PORT}
FOYER_DATA_DIR=${DATA_DIR}
FOYER_STATIC_DIR=${APP_DIR}/backend/public
FOYER_JWT_SECRET=${JWT}
FOYER_ALLOW_SIGNUP=true
# Au 1er démarrage, l'assistant de configuration crée le foyer + le compte admin.
# Passez à "true" pour précharger le jeu de démo (compte ci-dessous) à la place.
FOYER_SEED_DEMO=${SEED_DEMO:-false}
FOYER_ADMIN_EMAIL=${ADMIN_EMAIL}
FOYER_ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF
  chmod 600 "${ENV_FILE}"
else
  log "${ENV_FILE} existe déjà — conservé."
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}" "${DATA_DIR}"

# --- Service systemd ------------------------------------------------------
log "Installation du service systemd…"
cat > /etc/systemd/system/foyer.service <<EOF
[Unit]
Description=Foyer — application de gestion familiale
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node ${APP_DIR}/backend/dist/server.js
Restart=on-failure
RestartSec=5
# Durcissement
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now foyer >/dev/null 2>&1 || systemctl restart foyer
sleep 2

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if systemctl is-active --quiet foyer; then
  log "✅ Foyer est démarré."
  log "   → http://${IP:-<IP_DU_LXC>}:${PORT}"
  if [[ "${SEED_DEMO:-false}" =~ ^(1|true|yes|on)$ ]]; then
    log "   Données de démo activées · compte : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}"
  else
    log "   Ouvrez l'URL : l'assistant de configuration crée votre foyer au 1er démarrage."
  fi
  log "   Config : ${ENV_FILE} · Logs : journalctl -u foyer -f"
else
  err "Le service n'a pas démarré. Voir : journalctl -u foyer -e"
  exit 1
fi
