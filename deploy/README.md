# Déploiement de Foyer

Deux façons d'auto-héberger Foyer.

## 🐳 Docker Compose

Voir le [README principal](../README.md#-démarrage-rapide-docker-compose).

```bash
docker compose up -d --build   # → http://localhost:8099
```

## 📦 LXC Proxmox (installation native, sans Docker)

Installation légère dans un conteneur Debian/Ubuntu : Node.js + build + service **systemd**.
Idéal sur Proxmox VE où l'on préfère souvent un LXC natif à un Docker imbriqué.

### Option A — tout automatique depuis l'hôte Proxmox

Sur l'hôte **Proxmox VE** (en root), depuis une copie de ce dépôt :

```bash
bash deploy/lxc/proxmox-create.sh
# ou en personnalisant :
CTID=131 CT_HOSTNAME=foyer CORES=2 RAM=2048 DISK=8 \
  bash deploy/lxc/proxmox-create.sh
# le stockage est auto-détecté ; forcez-le au besoin avec STORAGE=<nom>
# (ex. STORAGE=local-zfs). Liste des stockages : `pvesm status`.
```

Le script crée un conteneur Debian 12 non privilégié, y envoie le code (copie locale — donc
compatible dépôt privé), lance l'installation et démarre le service. À la fin, l'URL et le mot
de passe root du conteneur sont affichés.

### Option B — dans un LXC existant

Dans un conteneur Debian/Ubuntu déjà créé (en root), avec une copie du dépôt :

```bash
# copiez le dépôt dans le conteneur (scp, pct push, git clone…), puis :
cd Foyer-App
bash deploy/lxc/install.sh
```

Ou en clonant directement (dépôt public, ou URL avec token) :

```bash
FOYER_REPO=https://github.com/PrudhommeWTF/Foyer-App.git FOYER_BRANCH=main \
  bash deploy/lxc/install.sh
```

### Ce que fait `install.sh`

- installe Node.js 22, `build-essential`, `python3`, `git` ;
- crée l'utilisateur système `foyer` ;
- build backend + frontend, copie l'app compilée dans `backend/public` ;
- crée `/etc/foyer/foyer.env` (secret JWT généré aléatoirement) ;
- stocke la base SQLite dans `/var/lib/foyer` ;
- installe et démarre le service systemd `foyer`.

### Exploitation

```bash
systemctl status foyer          # état
journalctl -u foyer -f          # logs
nano /etc/foyer/foyer.env       # config (puis: systemctl restart foyer)
bash deploy/lxc/update.sh       # mise à jour (rebuild + restart)
```

### Réglages

| Variable | Rôle | Défaut |
|---|---|---|
| `APP_DIR` | Dossier du code | `/opt/foyer` |
| `DATA_DIR` | Dossier des données SQLite | `/var/lib/foyer` |
| `PORT` | Port d'écoute | `8099` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Compte initial | `camille.martin@email.fr` / `foyer` |
| `FOYER_REPO` / `FOYER_BRANCH` | Source Git (si pas de copie locale) | dépôt / `main` |

> 💡 Le build Angular demande ~1,5 Go de RAM. Vous pouvez créer le LXC avec 2 Go pour le
> build puis redescendre à 512 Mo–1 Go pour le fonctionnement.
>
> 🔒 Avant exposition publique : éditez `/etc/foyer/foyer.env` (secret JWT déjà généré),
> changez le mot de passe admin, passez `FOYER_ALLOW_SIGNUP=false`, et placez un reverse-proxy
> HTTPS devant (Caddy, Nginx Proxy Manager, Traefik…).
