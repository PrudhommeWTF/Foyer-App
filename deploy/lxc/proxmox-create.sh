#!/usr/bin/env bash
# ============================================================
# Foyer — création d'un conteneur LXC sur un hôte Proxmox VE
# puis installation automatique de l'application.
#
# À lancer EN ROOT sur l'hôte Proxmox (PVE). Exemple :
#   bash deploy/lxc/proxmox-create.sh
#   CTID=131 HOSTNAME=foyer CORES=2 RAM=2048 DISK=8 bash deploy/lxc/proxmox-create.sh
#
# Par défaut, le script pousse la copie LOCALE du dépôt dans le conteneur
# (fonctionne même si le dépôt est privé). Pour cloner depuis Git à la place,
# définissez FOYER_REPO et laissez LOCAL_SRC vide.
#
# Variables (optionnelles) :
#   CTID        ID du conteneur (défaut: prochain ID libre)
#   HOSTNAME    nom d'hôte (défaut: foyer)
#   CORES/RAM/DISK   ressources (défaut: 2 vCPU / 2048 Mo / 8 Go)
#   BRIDGE      pont réseau (défaut: vmbr0)          NET  ip=dhcp|ip=CIDR,gw=…
#   STORAGE     stockage rootfs (défaut: local-lvm)
#   TEMPLATE_STORAGE  stockage des templates (défaut: local)
#   PASSWORD    mot de passe root du conteneur (défaut: généré)
#   LOCAL_SRC   copie locale du dépôt à déployer (défaut: racine de ce dépôt)
#   FOYER_REPO / FOYER_BRANCH   si LOCAL_SRC vide → clone Git
# ============================================================
set -euo pipefail

HOSTNAME_CT="${HOSTNAME:-foyer}"
CORES="${CORES:-2}"
RAM="${RAM:-2048}"
DISK="${DISK:-8}"
BRIDGE="${BRIDGE:-vmbr0}"
NET="${NET:-name=eth0,bridge=${BRIDGE},ip=dhcp}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
PASSWORD="${PASSWORD:-$(head -c 16 /dev/urandom | base64 | tr -d '/+=' | head -c 16)}"
FOYER_BRANCH="${FOYER_BRANCH:-main}"

log() { echo -e "\e[1;32m[foyer]\e[0m $*"; }
err() { echo -e "\e[1;31m[foyer]\e[0m $*" >&2; }

command -v pct >/dev/null || { err "pct introuvable — lancez ce script sur l'hôte Proxmox VE."; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." 2>/dev/null && pwd || true)"
LOCAL_SRC="${LOCAL_SRC-${REPO_ROOT}}"

CTID="${CTID:-$(pvesh get /cluster/nextid)}"

# --- Template Debian 12 ---------------------------------------------------
log "Vérification du template Debian 12…"
pveam update >/dev/null 2>&1 || true
TEMPLATE="$(pveam available --section system 2>/dev/null | awk '/debian-12-standard/{print $2}' | sort -V | tail -n1)"
: "${TEMPLATE:=debian-12-standard_12.7-1_amd64.tar.zst}"
if ! pveam list "${TEMPLATE_STORAGE}" 2>/dev/null | grep -q "${TEMPLATE}"; then
  log "Téléchargement du template ${TEMPLATE}…"
  pveam download "${TEMPLATE_STORAGE}" "${TEMPLATE}"
fi

# --- Création du conteneur -----------------------------------------------
log "Création du conteneur LXC ${CTID} (${HOSTNAME_CT})…"
pct create "${CTID}" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname "${HOSTNAME_CT}" \
  --cores "${CORES}" --memory "${RAM}" --swap "${RAM}" \
  --rootfs "${STORAGE}:${DISK}" \
  --net0 "${NET}" \
  --unprivileged 1 --features nesting=1 \
  --onboot 1 --password "${PASSWORD}"

log "Démarrage du conteneur…"
pct start "${CTID}"

log "Attente du réseau…"
for _ in $(seq 1 30); do
  if pct exec "${CTID}" -- getent hosts deb.nodesource.com >/dev/null 2>&1; then break; fi
  sleep 2
done

# --- Déploiement de l'application ----------------------------------------
if [[ -n "${LOCAL_SRC}" && -d "${LOCAL_SRC}/backend" ]]; then
  log "Envoi du code local vers le conteneur…"
  pct exec "${CTID}" -- mkdir -p /root/foyer-src
  tar -C "${LOCAL_SRC}" \
      --exclude='.git' --exclude='node_modules' --exclude='frontend/dist' \
      --exclude='backend/dist' --exclude='backend/public' --exclude='data' \
      -czf - . | pct exec "${CTID}" -- tar -C /root/foyer-src -xzf -
  log "Installation dans le conteneur…"
  pct exec "${CTID}" -- bash -c "FOYER_SRC=/root/foyer-src bash /root/foyer-src/deploy/lxc/install.sh"
else
  log "Installation dans le conteneur (clone Git ${FOYER_BRANCH})…"
  pct exec "${CTID}" -- bash -c \
    "apt-get update -qq && apt-get install -y -qq git >/dev/null && \
     git clone --depth 1 --branch '${FOYER_BRANCH}' '${FOYER_REPO:-https://github.com/PrudhommeWTF/Foyer-App.git}' /root/foyer-src && \
     bash /root/foyer-src/deploy/lxc/install.sh"
fi

IP="$(pct exec "${CTID}" -- hostname -I 2>/dev/null | awk '{print $1}')"
log "✅ Terminé. Conteneur ${CTID} (${HOSTNAME_CT})."
log "   → http://${IP:-<IP>}:8099"
log "   Mot de passe root du conteneur : ${PASSWORD}"
