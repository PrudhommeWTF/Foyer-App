# Foyer — scripts Proxmox VE « Community Helper-Scripts »

Ces deux fichiers rendent Foyer installable **exactement** à la manière des
[Proxmox VE Community Helper-Scripts](https://community-scripts.org/) :

```
ct/foyer.sh                 # côté hôte Proxmox : crée le conteneur, pilote le menu
install/foyer-install.sh    # dans le conteneur : dépendances, build, service
```

Ils suivent le fonctionnement documenté par le projet :

- `ct/foyer.sh` **source le moteur partagé** (`build.func`) depuis le dépôt
  `community-scripts/core` au runtime, déclare les ressources par défaut
  (`var_cpu`, `var_ram`, …), définit `update_script()`, puis appelle
  `start` / `build_container` / `description`.
- `install/foyer-install.sh` source les fonctions partagées
  (`$FUNCTIONS_FILE_PATH`, exporté par le moteur), puis enchaîne les étapes
  standard : `setting_up_container`, `network_check`, `update_os`,
  installation des dépendances, `setup_nodejs`, récupération de la **source de
  la dernière release GitHub** via `fetch_and_deploy_gh_release … tarball`,
  build Node/Angular, service systemd, puis `motd_ssh` / `customize` /
  `cleanup_lxc`.
- Les **mises à jour** passent par `update_script()` (relancer le script côté
  hôte Proxmox), avec détection de version par `check_for_gh_release`.

## ⚠️ Contrainte importante : ces scripts visent le catalogue community-scripts

Le moteur community-scripts récupère le script d'installation à une **URL figée
en dur** dans leur `build.func` :

```
https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/install/foyer-install.sh
```

Il n'existe **aucune variable** pour pointer cette URL vers ce dépôt. Autrement
dit, la commande « one-liner » standard ne fonctionnera que lorsque
`install/foyer-install.sh` sera présent **dans le dépôt community-scripts**,
c'est-à-dire après soumission et fusion par leurs mainteneurs.

- **Tant que ce n'est pas fusionné** : utilisez l'installation auto-hébergée
  décrite dans [`../README.md`](../README.md) (`deploy/lxc/`), qui reste le
  chemin pris en charge et ne dépend de personne.
- **Pour tester ces scripts avant fusion** : suivez le workflow de *fork* de
  community-scripts (forker leur dépôt, y copier ces deux fichiers, et laisser
  leur `setup-fork.sh` réécrire les URLs vers votre fork), ou lancez-les avec un
  checkout local de `community-scripts/core` via `COMMUNITY_SCRIPTS_CORE_DIR`.

## Soumission au catalogue

Les nouveaux scripts se proposent d'abord au dépôt
[`community-scripts/DevScripts`](https://github.com/community-scripts/DevScripts),
puis sont revus et fusionnés dans
[`community-scripts/ProxmoxVE`](https://github.com/community-scripts/ProxmoxVE).
Copier `ct/foyer.sh` → `ct/` et `install/foyer-install.sh` → `install/` de leur
dépôt, puis ouvrir la PR. La fiche du site (nom, logo, description, tags) se
renseigne côté site, pas par un fichier dans le dépôt.

## Ressources et particularités

| Réglage | Valeur | Raison |
|---|---|---|
| OS | Debian 13 | défaut actuel du catalogue |
| vCPU / RAM / disque | 2 / **3072 Mo** / 7 Go | le build Angular demande ~1,5 Go de RAM |
| Port | 8099 | HTTP de l'app |
| Utilisateur service | `foyer` (non privilégié) | la base porte des données sensibles |

> 💡 Les 3 Go de RAM ne servent qu'au **build** (install et mises à jour). Une
> fois en service, Foyer tient en 512 Mo–1 Go ; vous pouvez redescendre les
> ressources du conteneur ensuite. Une mise à jour (côté hôte **ou** depuis
> l'appli) recompile : repassez à ~3 Go le temps de la MAJ.

## Ce que ces scripts installent

- Node.js 22 (via `setup_nodejs`), build-essential + python3 (compilation native
  de `better-sqlite3`).
- La source de la dernière release de Foyer dans `/opt/foyer`, compilée sur place
  (app compilée servie depuis `backend/public`).
- `/etc/foyer/foyer.env` (secret JWT généré, `FOYER_VERSION` = tag déployé).
- Base SQLite dans `/var/lib/foyer` (permissions 0600, propriétaire `foyer`).
- Service systemd **durci** `foyer` (voir le fichier pour le détail du
  durcissement ; `AF_NETLINK` est requis pour la résolution DNS).
- **Mise à jour « en un clic » depuis l'appli** conservée en plus du modèle
  côté hôte : un helper root (`/usr/local/sbin/foyer-self-update.sh`) déclenché
  par une unité `path` systemd quand le backend dépose
  `/var/lib/foyer/.update-trigger`.

## Différence avec `deploy/lxc/`

`deploy/lxc/` (scripts `proxmox-create.sh` + `install.sh` + `self-update.sh` +
`update.sh` + `uninstall.sh`) est l'installation **auto-hébergée** historique,
indépendante de tout tiers, et reste le chemin pris en charge aujourd'hui.
`deploy/community-scripts/` reproduit le **fonctionnement community-scripts**
pour l'intégration à leur catalogue. Le helper de MAJ in-app
(`self-update.sh`) est partagé : les deux chemins l'installent depuis
`deploy/lxc/self-update.sh`.
