#!/usr/bin/env bash

# Copyright (c) 2021-2026 community-scripts ORG
# Author: PrudhommeWTF
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/PrudhommeWTF/Foyer-App

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt-get install -y \
  build-essential \
  python3 \
  ca-certificates \
  git \
  rsync
msg_ok "Installed Dependencies"

NODE_VERSION="22" setup_nodejs

fetch_and_deploy_gh_release "foyer" "PrudhommeWTF/Foyer-App" "tarball" "latest" "/opt/foyer"

msg_info "Building Foyer (building from source, needs ~1.5 GB RAM)"
export NG_CLI_ANALYTICS=false
cd /opt/foyer/backend
$STD npm ci
$STD npm run build
cd /opt/foyer/frontend
$STD npm ci
$STD npm run build
rm -rf /opt/foyer/backend/public
mkdir -p /opt/foyer/backend/public
cp -r /opt/foyer/frontend/dist/frontend/browser/. /opt/foyer/backend/public/
# The frontend node_modules are not needed at runtime.
rm -rf /opt/foyer/frontend/node_modules
msg_ok "Built Foyer"

msg_info "Creating User, Config and Data Directory"
id -u foyer &>/dev/null || useradd --system --home /opt/foyer --shell /usr/sbin/nologin foyer
mkdir -p /etc/foyer /var/lib/foyer
JWT="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
DEPLOYED_VERSION="$(sed 's/^v//' ~/.foyer 2>/dev/null || echo "0.0.0")"
cat <<EOF >/etc/foyer/foyer.env
# Foyer configuration — edit then: systemctl restart foyer
PORT=8099
FOYER_DATA_DIR=/var/lib/foyer
FOYER_STATIC_DIR=/opt/foyer/backend/public
FOYER_JWT_SECRET=${JWT}
FOYER_VERSION=${DEPLOYED_VERSION}
FOYER_GITHUB_REPO=PrudhommeWTF/Foyer-App
# On first launch, the setup wizard creates the household + the admin account.
# Further access is opened from a member's card by an administrator: there is no
# open sign-up.
#
# Exposure: if a reverse-proxy runs on THIS machine, uncomment the line below so
# the service is only reachable through it and nobody can spoof X-Forwarded-For.
#   FOYER_BIND=127.0.0.1
# With no proxy in front, set FOYER_TRUST_PROXY=false instead.
# In-app one-click update (root helper triggered by systemd path).
FOYER_SELF_UPDATE=true
EOF
chmod 600 /etc/foyer/foyer.env
# The database holds the family's finances, children's agenda and address; the
# "pieces" dir holds scanned documents. Owner-only, nobody else.
chown -R foyer:foyer /opt/foyer /var/lib/foyer
chmod 700 /var/lib/foyer
msg_ok "Created User, Config and Data Directory"

msg_info "Creating Service"
cat <<EOF >/etc/systemd/system/foyer.service
[Unit]
Description=Foyer — family management application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=foyer
Group=foyer
WorkingDirectory=/opt/foyer/backend
EnvironmentFile=/etc/foyer/foyer.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/foyer/backend/dist/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
# AF_NETLINK is required: glibc uses it in getaddrinfo to pick the source
# address; without it name resolution fails silently (school holidays, version
# check, recipe import).
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
RestrictNamespaces=true
RestrictSUIDSGID=true
LockPersonality=true
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
MemoryDenyWriteExecute=false
UMask=0077
MemoryMax=1G
ReadWritePaths=/var/lib/foyer

[Install]
WantedBy=multi-user.target
EOF

# In-app one-click update: the non-privileged backend drops a trigger file, a
# root systemd path unit runs the helper (downloads the chosen release tag,
# rebuilds, restarts). The host-side `update` command (re-running this script
# from Proxmox) remains available as well.
install -m 0755 -o root -g root /opt/foyer/deploy/lxc/self-update.sh /usr/local/sbin/foyer-self-update.sh
cat <<EOF >/etc/systemd/system/foyer-update.service
[Unit]
Description=Foyer — automatic update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/foyer/foyer.env
Environment=APP_DIR=/opt/foyer
ExecStart=/usr/local/sbin/foyer-self-update.sh
EOF
cat <<EOF >/etc/systemd/system/foyer-update.path
[Unit]
Description=Foyer — watches the update trigger

[Path]
PathExists=/var/lib/foyer/.update-trigger
Unit=foyer-update.service

[Install]
WantedBy=multi-user.target
EOF
systemctl enable -q --now foyer-update.path
systemctl enable -q --now foyer
msg_ok "Created Service"

motd_ssh
customize
cleanup_lxc
