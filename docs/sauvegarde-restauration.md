# Sauvegarde et restauration chiffrées

Une sauvegarde de Foyer contient tout ce que le foyer a de plus sensible : les
finances, l'adresse, la composition de la famille, l'emploi du temps des
enfants, et les documents scannés. Elle mérite donc au moins autant de soin que
le serveur, et probablement plus : elle finit chez un hébergeur, sur un disque
externe, dans un tiroir.

D'où le chiffrement, sans condition.

---

## 1. Ce qu'il faut emporter

Tout tient dans `FOYER_DATA_DIR` (`/var/lib/foyer` en LXC, le volume `/data` en
Docker) :

| Chemin | Contenu |
|---|---|
| `foyer.db` | La base : comptes, document du foyer, finances, journaux d'opérations |
| `pieces/` | Les octets des pièces jointes et des documents, nommés par empreinte |
| `sauvegardes/` | Les instantanés faits depuis l'application |
| `backups/` | Les copies d'avant migration du document d'état |
| `regles-accueil.json` | Les règles de contexte de l'accueil, si vous en avez posé |

**La base seule ne suffit pas.** Elle référence les fichiers de `pieces/` par
leur empreinte : restaurer l'une sans l'autre donne une application qui affiche
des fiches sans leur contenu, et le journal de démarrage le dira.

Ce qui n'est **pas** dans la sauvegarde et qu'il faut noter à part :
`/etc/foyer/foyer.env`, qui porte le secret JWT et les clés VAPID posées à la
main. Sans le même secret, une restauration déconnecte tout le monde (ce qui
n'est pas grave, chacun se reconnecte) ; sans les mêmes clés VAPID, tous les
abonnements aux rappels sont à refaire.

---

## 2. Un prérequis

Les commandes ci-dessous utilisent `sqlite3` en ligne de commande. Il n'est
**pas** installé par défaut : l'application parle à sa base par une
bibliothèque Node, elle n'a jamais eu besoin de l'outil. Posez-le une fois.

```sh
apt-get install -y sqlite3
sqlite3 --version
```

`openssl` et `tar` sont présents sur toute installation Debian ou Ubuntu.

---

## 3. La clé de chiffrement

Une phrase de passe longue, gardée **ailleurs que sur la machine et ailleurs que
sur le support de sauvegarde**. Dans votre gestionnaire de mots de passe, et sur
un papier dans un tiroir.

```sh
# Une phrase solide, si vous n'en avez pas déjà une
openssl rand -base64 32
```

Rangez-la dans un fichier lisible par root seul, pour que le script n'ait pas à
la porter en clair dans sa ligne de commande (elle serait visible dans `ps`) :

```sh
install -m 600 /dev/null /root/.foyer-sauvegarde.cle
printf '%s' 'VOTRE_PHRASE_DE_PASSE' > /root/.foyer-sauvegarde.cle
```

> Si vous perdez cette phrase, les sauvegardes sont définitivement illisibles.
> C'est le but. Vérifiez qu'elle est bien rangée **avant** d'en dépendre.

---

## 4. Sauvegarder

`VACUUM INTO` plutôt qu'une copie de `foyer.db` : la base est en mode WAL, et la
copier pendant que le service tourne donne une archive corrompue, **en silence**.
C'est la seule façon sûre de sauvegarder à chaud.

```sh
#!/usr/bin/env bash
# /usr/local/sbin/foyer-sauvegarde.sh
set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/foyer}"
DEST="${DEST:-/var/backups/foyer}"
CLE="${CLE:-/root/.foyer-sauvegarde.cle}"
GARDE="${GARDE:-14}"          # nombre d'archives conservées

horodatage="$(date +%Y%m%d-%H%M%S)"
travail="$(mktemp -d)"
trap 'rm -rf "$travail"' EXIT
mkdir -p "$DEST"

# 1. Un instantané cohérent de la base, sans arrêter le service.
sqlite3 "${DATA_DIR}/foyer.db" "VACUUM INTO '${travail}/foyer.db'"

# 2. Les fichiers, et la configuration du service. Le fichier d'environnement
#    porte le secret JWT : il n'a rien à faire ailleurs qu'ici, chiffré.
tar -C "$DATA_DIR" -cf "${travail}/donnees.tar" \
    pieces regles-accueil.json 2>/dev/null || \
tar -C "$DATA_DIR" -cf "${travail}/donnees.tar" pieces
cp /etc/foyer/foyer.env "${travail}/foyer.env" 2>/dev/null || true

# 3. Une archive, chiffrée en AES-256 avec dérivation de clé.
archive="${DEST}/foyer-${horodatage}.tar.gz.enc"
tar -C "$travail" -czf - . \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:${CLE}" \
  > "$archive"
chmod 600 "$archive"

# 4. Une empreinte, pour détecter une archive abîmée avant d'en avoir besoin.
sha256sum "$archive" > "${archive}.sha256"

# 5. Élagage, après l'écriture : une sauvegarde qui commence par effacer
#    l'avant-dernière laisse le foyer sans rien si elle échoue.
ls -1t "${DEST}"/foyer-*.tar.gz.enc 2>/dev/null | tail -n "+$((GARDE + 1))" \
  | while read -r vieux; do rm -f "$vieux" "${vieux}.sha256"; done

echo "[foyer] sauvegarde : $(basename "$archive") ($(du -h "$archive" | cut -f1))"
```

Installation et automatisation :

```sh
install -m 700 foyer-sauvegarde.sh /usr/local/sbin/foyer-sauvegarde.sh
/usr/local/sbin/foyer-sauvegarde.sh        # une fois à la main, pour voir

cat > /etc/systemd/system/foyer-sauvegarde.service <<'EOF'
[Unit]
Description=Foyer : sauvegarde chiffrée
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/foyer-sauvegarde.sh
EOF

cat > /etc/systemd/system/foyer-sauvegarde.timer <<'EOF'
[Unit]
Description=Foyer : sauvegarde chiffrée quotidienne
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload && systemctl enable --now foyer-sauvegarde.timer
systemctl list-timers foyer-sauvegarde.timer
```

### Emporter les archives ailleurs

Une sauvegarde sur la même machine ne protège que d'une bêtise, pas d'un
incendie ni d'un chiffrement par rançongiciel. Les archives sont déjà chiffrées :
elles peuvent partir n'importe où sans que le destinataire puisse les lire.

```sh
# Vers un NAS, en poussant (le NAS n'a pas besoin d'accéder au serveur)
rsync -a --delete /var/backups/foyer/ nas.maison:/volume1/sauvegardes/foyer/
```

---

## 5. Vérifier une archive, sans rien restaurer

À faire **au moins une fois**, et de temps en temps. Une sauvegarde jamais
restaurée n'est pas une sauvegarde, c'est une intention.

```sh
ARCHIVE=/var/backups/foyer/foyer-20260904-033000.tar.gz.enc

# L'archive n'a pas été abîmée en chemin
sha256sum -c "${ARCHIVE}.sha256"

# Elle se déchiffre, et on voit ce qu'elle contient
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:/root/.foyer-sauvegarde.cle \
  -in "$ARCHIVE" | tar -tzf - | head

# La base qu'elle porte est saine
travail="$(mktemp -d)"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:/root/.foyer-sauvegarde.cle \
  -in "$ARCHIVE" | tar -C "$travail" -xzf -
sqlite3 "$travail/foyer.db" "PRAGMA integrity_check;"      # attendu : ok
sqlite3 "$travail/foyer.db" "SELECT count(*) AS comptes FROM users;"
sqlite3 "$travail/foyer.db" "SELECT count(*) AS pieces FROM hh_attachments;"
tar -tf "$travail/donnees.tar" | wc -l                     # nombre de fichiers
rm -rf "$travail"
```

Si `integrity_check` ne répond pas `ok`, l'archive est inutilisable : cherchez
pourquoi maintenant, pas le jour où vous en aurez besoin.

---

## 6. Restaurer

> Cette procédure **remplace** les données en place. Faites d'abord une
> sauvegarde de ce qui est là, même si vous le croyez perdu.

```sh
ARCHIVE=/var/backups/foyer/foyer-20260904-033000.tar.gz.enc
DATA_DIR=/var/lib/foyer

# 1. Le service s'arrête : restaurer sous une base ouverte donne une base cassée.
systemctl stop foyer

# 2. Ce qui est en place est mis de côté, pas effacé.
mv "$DATA_DIR" "${DATA_DIR}.avant-restauration-$(date +%Y%m%d-%H%M)"
mkdir -p "$DATA_DIR"

# 3. Déchiffrement et extraction
travail="$(mktemp -d)"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:/root/.foyer-sauvegarde.cle \
  -in "$ARCHIVE" | tar -C "$travail" -xzf -

# 4. La base et les fichiers reprennent leur place
cp "$travail/foyer.db" "${DATA_DIR}/foyer.db"
tar -C "$DATA_DIR" -xf "$travail/donnees.tar"

# 5. Les droits, qui ne survivent pas au voyage
chown -R foyer:foyer "$DATA_DIR"
chmod 700 "$DATA_DIR"
find "$DATA_DIR" -type d -exec chmod 700 {} +
find "$DATA_DIR" -type f -exec chmod 600 {} +

# 6. Le fichier d'environnement, SI vous restaurez sur une machine neuve.
#    Sur la machine d'origine, gardez celui qui est en place.
# cp "$travail/foyer.env" /etc/foyer/foyer.env && chmod 600 /etc/foyer/foyer.env

rm -rf "$travail"

# 7. Redémarrage, et lecture du journal : c'est là que les écarts se disent.
systemctl start foyer
journalctl -u foyer --since "2 min ago" | tail -30
```

### Ce qu'il faut lire dans le journal après une restauration

- `Fichiers : N fiche(s) sans fichier sur le disque` : la base a été restaurée
  sans `pieces/`, ou avec un `pieces/` plus ancien. Reprenez l'archive complète.
- `Fichiers : N fichier(s) sur le disque qu'aucune table ne référence` :
  l'inverse, et c'est sans gravité. Rien n'est supprimé.
- `État : migration N appliquée` : la sauvegarde venait d'une version antérieure.
  C'est normal, et une copie du document d'origine est écrite dans
  `<data>/backups` avant transformation.

Un piège à connaître, rencontré en éprouvant cette procédure : **un fichier
qu'aucune fiche ne référence est effacé au démarrage suivant**. C'est le ménage
normal de l'application (une photo de recette remplacée, un formulaire
abandonné), pas un défaut de la sauvegarde. Si vous testez la restauration avec
un fichier déposé par l'API sans l'avoir rattaché à une fiche dans
l'application, il aura disparu au redémarrage et vous conclurez à tort que
l'archive est incomplète.

### Vérifier que le foyer est revenu

```sh
curl -s localhost:8099/api/setup/status         # {"needsSetup":false}
sqlite3 /var/lib/foyer/foyer.db "SELECT email, member_id FROM users;"
```

Puis, dans l'application : ouvrez un document scanné et une photo de recette.
C'est le test qui dit vraiment si `pieces/` est revenu avec la base.

---

## 7. Le bouton de l'application

L'écran Paramètres propose une sauvegarde en un clic. Elle est utile, mais elle
ne remplace pas ce qui précède, et il faut savoir pourquoi :

- elle écrit un instantané de la **base seule**, dans `<data>/sauvegardes` ;
- elle **n'emporte ni les fichiers ni les photos** ;
- elle reste **sur la même machine**, et **n'est pas chiffrée**.

C'est un filet avant une manipulation risquée, pas une sauvegarde. Le
téléchargement d'un de ces instantanés est réservé à un administrateur et
journalisé : une base entière qui quitte la machine doit laisser une trace.
