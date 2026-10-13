#!/usr/bin/env bash
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Copyright (c) 2021-2026 community-scripts ORG
# Author: PrudhommeWTF
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/PrudhommeWTF/Foyer-App

APP="Foyer"
var_tags="${var_tags:-household;family}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-3072}"
var_disk="${var_disk:-7}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-yes}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -d /opt/foyer ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi
  if check_for_gh_release "foyer" "PrudhommeWTF/Foyer-App"; then
    msg_info "Stopping Service"
    systemctl stop foyer
    msg_ok "Stopped Service"

    msg_info "Updating ${APP} (building from source, needs ~1.5 GB RAM)"
    export NG_CLI_ANALYTICS=false
    CLEAN_INSTALL=1 fetch_and_deploy_gh_release "foyer" "PrudhommeWTF/Foyer-App" "tarball" "latest" "/opt/foyer"
    cd /opt/foyer/backend
    $STD npm ci
    $STD npm run build
    cd /opt/foyer/frontend
    $STD npm ci
    $STD npm run build
    rm -rf /opt/foyer/backend/public
    mkdir -p /opt/foyer/backend/public
    cp -r /opt/foyer/frontend/dist/frontend/browser/. /opt/foyer/backend/public/
    rm -rf /opt/foyer/frontend/node_modules
    # Record the deployed release in the env file so the app reports the right
    # version. fetch_and_deploy_gh_release wrote the tag to ~/.foyer.
    local deployed
    deployed="$(sed 's/^v//' ~/.foyer 2>/dev/null || echo "")"
    if [[ -n "$deployed" ]]; then
      sed -i "s|^FOYER_VERSION=.*|FOYER_VERSION=${deployed}|" /etc/foyer/foyer.env
    fi
    # Keep the in-app one-click update helper in step with the shipped source.
    [[ -f /usr/local/sbin/foyer-self-update.sh && -f /opt/foyer/deploy/lxc/self-update.sh ]] &&
      install -m 0755 -o root -g root /opt/foyer/deploy/lxc/self-update.sh /usr/local/sbin/foyer-self-update.sh
    chown -R foyer:foyer /opt/foyer
    msg_ok "Updated ${APP}"

    msg_info "Starting Service"
    systemctl start foyer
    msg_ok "Started Service"
    msg_ok "Updated successfully!"
  fi
  exit
}

start
build_container
description

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}Access it using the following URL:${CL}"
echo -e "${GATEWAY}${BGN}http://${IP}:8099${CL}"
