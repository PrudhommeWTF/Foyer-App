#!/usr/bin/env bash
# ============================================================
# Foyer — désinstallation de l'installation native (LXC ou hôte).
# À lancer EN ROOT là où install.sh a été exécuté.
#
#   bash deploy/lxc/uninstall.sh              # retire le service, les fichiers, l'utilisateur
#   PURGE_NODE=true bash deploy/lxc/uninstall.sh   # retire aussi Node.js + le dépôt NodeSource
#   KEEP_DATA=true bash deploy/lxc/uninstall.sh     # conserve /var/lib/foyer (base SQLite)
#
# Variables (optionnelles) :
#   APP_DIR    dossier du code (défaut: /opt/foyer)
#   DATA_DIR   dossier des données SQLite (défaut: /var/lib/foyer)
#   KEEP_DATA  "true" pour ne PAS supprimer les données (défaut: false)
#   PURGE_NODE "true" pour désinstaller Node.js + NodeSource (défaut: false)
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/foyer}"
DATA_DIR="${DATA_DIR:-/var/lib/foyer}"
ENV_DIR="/etc/foyer"
SERVICE_USER="foyer"
KEEP_DATA="${KEEP_DATA:-false}"
PURGE_NODE="${PURGE_NODE:-false}"

log() { echo -e "\e[1;32m[foyer]\e[0m $*"; }
err() { echo -e "\e[1;31m[foyer]\e[0m $*" >&2; }

if [[ "${EUID}" -ne 0 ]]; then err "Ce script doit être lancé en root."; exit 1; fi

log "Arrêt et désactivation du service…"
systemctl disable --now foyer 2>/dev/null || true
systemctl disable --now foyer-update.path 2>/dev/null || true
rm -f /etc/systemd/system/foyer.service /etc/systemd/system/foyer-update.service /etc/systemd/system/foyer-update.path
rm -f /usr/local/sbin/foyer-self-update.sh
systemctl daemon-reload 2>/dev/null || true
systemctl reset-failed foyer 2>/dev/null || true

log "Suppression du code et de la configuration…"
rm -rf "${APP_DIR}" "${ENV_DIR}"

if [[ "${KEEP_DATA}" =~ ^(1|true|yes|on)$ ]]; then
  log "Données conservées : ${DATA_DIR}"
else
  log "Suppression des données ${DATA_DIR}…"
  rm -rf "${DATA_DIR}"
fi

if id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  log "Suppression de l'utilisateur ${SERVICE_USER}…"
  userdel "${SERVICE_USER}" 2>/dev/null || true
fi

if [[ "${PURGE_NODE}" =~ ^(1|true|yes|on)$ ]]; then
  log "Désinstallation de Node.js + dépôt NodeSource…"
  apt-get purge -y nodejs 2>/dev/null || true
  rm -f /etc/apt/sources.list.d/nodesource.list /etc/apt/keyrings/nodesource.gpg
  apt-get update -qq || true
fi

log "✅ Foyer désinstallé."
if command -v ss >/dev/null 2>&1; then
  ss -ltn 2>/dev/null | grep -q ':8099 ' && err "Attention : un service écoute encore sur 8099." || log "Port 8099 libre."
fi
