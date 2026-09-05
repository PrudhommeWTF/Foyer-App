# Checklist de mise en ligne

À dérouler avant d'ouvrir le domaine, puis à refaire depuis l'extérieur une fois
qu'il est ouvert. Chaque ligne se vérifie par une commande : cochez ce que vous
avez vu, pas ce que vous croyez.

Remplacez `foyer.mondomaine.fr` par votre domaine et `10.0.0.30` par l'adresse du
conteneur.

---

## 1. Avant d'ouvrir, sur la machine

### Le secret de session

```sh
grep -c '^FOYER_JWT_SECRET=.\{32,\}' /etc/foyer/foyer.env   # doit afficher 1
```

Absent ou trop court, le service refuse de démarrer en production. S'il faut en
poser un, voir `docs/exploitation-securite.md`.

### Les comptes

```sh
sqlite3 /var/lib/foyer/foyer.db \
  "SELECT id, email, member_id, created_at FROM users ORDER BY id;"
```

- [ ] Chaque compte est reconnu, et **chacun a un `member_id`**. Un compte sans
      membre n'accède à rien depuis la tranche 1, mais il n'a aucune raison
      d'exister : supprimez-le.
- [ ] Les comptes des enfants sont marqués « enfant » sur leur fiche (écran
      Famille). Sans ce marquage, ils voient les Finances et les Documents.
- [ ] Aucun mot de passe n'est réutilisé ailleurs. C'est le scénario que la
      temporisation ne voit pas passer : une connexion réussie du premier coup.
      C'est aussi celui que le second facteur couvre, ci-dessous.

### Le second facteur

```sh
sqlite3 /var/lib/foyer/foyer.db \
  "SELECT email, CASE WHEN totp_secret IS NULL THEN 'NON' ELSE 'oui' END AS second_facteur FROM users;"
```

- [ ] **Posé sur chaque compte adulte**, en commençant par les administrateurs.
      Il se pose depuis Paramètres, section « Mon compte ». Le mécanisme ne
      protège personne tant qu'il n'est activé nulle part.
- [ ] Les **codes de secours sont notés ailleurs que sur le téléphone** qui
      porte l'application. Sur papier dans un tiroir, ou dans un gestionnaire de
      mots de passe qui n'est pas sur ce téléphone.
- [ ] Vous avez **essayé un code de secours au moins une fois**, pour savoir
      qu'ils fonctionnent avant d'en avoir besoin. Il en restera neuf, et
      l'écran vous dira combien.
- [ ] Vous savez qu'un administrateur peut retirer le second facteur d'un membre
      depuis l'écran Famille, si son téléphone est perdu **et** ses codes avec.

### Les permissions et le service

```sh
stat -c '%a %U %n' /var/lib/foyer /var/lib/foyer/foyer.db   # attendu 700 et 600, foyer
systemd-analyze security foyer.service | tail -3
systemctl show foyer -p Environment | tr ' ' '\n' | grep FOYER_
```

- [ ] Le répertoire de données est en 700, la base en 600, propriété de `foyer`.
- [ ] La mise à jour en un clic est dans l'état que vous voulez. Ce n'est plus
      la variable qui décide mais la présence de
      `/usr/local/sbin/foyer-self-update.sh` : vérifiez le fichier, pas la
      déclaration (`ls -l /usr/local/sbin/foyer-self-update.sh`). Tant qu'il est
      là, un compte administrateur compromis peut faire exécuter du code en root
      sur cette machine ; la mise à jour redemande le mot de passe, ce qui ferme
      le cas du jeton dérobé mais pas celui du mot de passe connu.
      `FOYER_SELF_UPDATE=false` reste l'interrupteur d'arrêt franc.

### L'écoute réseau

```sh
ss -ltnp | grep 8099
```

- [ ] Si le proxy tourne sur cette machine : `127.0.0.1:8099`. Sinon, posez
      `FOYER_BIND=127.0.0.1` dans `/etc/foyer/foyer.env` et redémarrez.
- [ ] Si le proxy est ailleurs : le port est ouvert, mais filtré au pare-feu
      pour n'accepter que l'adresse du proxy (voir la section 7.1 du rapport
      d'audit).

Le démarrage vous avertit si les deux réglages se contredisent :

```sh
journalctl -u foyer --since "10 min ago" | grep "Sécurité :"
```

Cette ligne ne doit pas apparaître. Si elle apparaît, faites ce qu'elle dit.

---

## 2. NGINX Proxy Manager

Dans **Details** : schéma `http`, l'hôte et le port du conteneur, **Block Common
Exploits** activé, **Websockets Support** désactivé.

Dans **SSL** : certificat Let's Encrypt, **Force SSL** activé, **HTTP/2**
activé, **HSTS désactivé**. L'application émet déjà l'en-tête ; l'activer des
deux côtés le fait sortir en double, et certains clients rejettent cela.

Dans **Advanced**, le bloc complet est en section 7.2 du rapport d'audit. Les
deux lignes qui comptent le plus :

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
client_max_body_size 30m;
```

La première **écrase** l'en-tête au lieu d'y ajouter : c'est elle qui rend la
temporisation des tentatives de connexion fiable. La seconde laisse passer un
import de relevé de 25 Mo.

---

## 3. Depuis l'extérieur, une fois le domaine ouvert

À lancer depuis une connexion qui n'est pas la vôtre (partage de connexion du
téléphone, par exemple).

### L'API ne parle à personne sans jeton

```sh
for u in /api/state /api/live /api/me /api/finances/export.csv /api/files/1 \
         /api/settings /api/system/status /api/members/accounts /api/calendar/ics; do
  printf "%-32s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' https://foyer.mondomaine.fr$u)"
done
```

- [ ] **401 partout.** Les seules routes publiques sont `/api/setup/status`,
      `/api/auth/login`, `/api/setup` (qui répond 409 une fois le foyer créé) et
      `/api/calendar/feed.ics`.

### La sonde de santé n'est pas publique

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://foyer.mondomaine.fr/api/health
```

- [ ] **404**, grâce au bloc `location = /api/health` de la configuration NGINX.

### Le port du backend n'est pas joignable

```sh
curl -m 5 -sv http://VOTRE_IP_PUBLIQUE:8099/api/health    # doit échouer
nmap -Pn -p 8099 VOTRE_IP_PUBLIQUE                        # filtered ou closed
```

- [ ] Depuis Internet **et** depuis votre réseau local, seul le proxy répond.

### Les sondes de robots ne trouvent rien

```sh
for u in /.git/config /.env /wp-login.php /backup.sql /.git/HEAD; do
  printf "%-20s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' https://foyer.mondomaine.fr$u)"
done
```

- [ ] **404 partout**, et pas 200 avec la page de l'application.

### Les en-têtes de sécurité

```sh
curl -sI https://foyer.mondomaine.fr/ | grep -iE \
  'strict-transport|content-security|permissions-policy|x-frame|x-content-type|referrer'
```

- [ ] `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- [ ] `Content-Security-Policy` avec `script-src 'self'`, sans `unsafe-eval`
- [ ] `Permissions-Policy` avec `geolocation=()`, `camera=()`, `microphone=()`
- [ ] `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`
- [ ] Aucun `X-Powered-By`
- [ ] Une note correcte sur un analyseur public (securityheaders.com par exemple)

### Une pièce jointe n'est pas accessible par son URL

Copiez, depuis l'application connectée, l'adresse d'un document
(`/api/files/1`), collez-la dans une navigation privée.

- [ ] **401**, une page JSON, pas le fichier.

### L'énumération des comptes

```sh
for e in inconnu@nulle-part.example VOTRE_ADRESSE; do
  curl -s -o /dev/null -w "$e : %{time_total}s\n" \
    -X POST https://foyer.mondomaine.fr/api/auth/login \
    -H 'Content-Type: application/json' -d "{\"email\":\"$e\",\"password\":\"faux\"}"
done
```

- [ ] Les deux temps sont du même ordre de grandeur (quelques centaines de
      millisecondes, pas 2 ms contre 300 ms).
- [ ] Les deux messages sont identiques, au mot près.

### La temporisation, et la famille qui passe quand même

```sh
for i in $(seq 1 12); do
  printf "%s " "$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST https://foyer.mondomaine.fr/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"VOTRE_ADRESSE","password":"faux"}')"
done; echo
```

- [ ] La série passe de 401 à 429, avec un en-tête `Retry-After`.
- [ ] **Pendant ce temps**, depuis la maison, un autre membre du foyer se
      connecte normalement. C'est la vérification qui compte le plus : une
      protection qui enferme la famille dehors n'en est pas une.

### Le second facteur, vu de l'extérieur

```sh
curl -s -X POST https://foyer.mondomaine.fr/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"VOTRE_ADRESSE","password":"VOTRE_MOT_DE_PASSE"}'
```

- [ ] La réponse porte `"totpRequired":true` et un `challenge`, **et aucun
      `token`**. Le mot de passe seul ne doit rien ouvrir.
- [ ] Ce `challenge`, présenté comme un jeton de session, est refusé :

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://foyer.mondomaine.fr/api/state \
  -H "Authorization: Bearer LE_CHALLENGE"      # attendu 401
```

### Le flux de calendrier

- [ ] L'adresse `/api/calendar/feed.ics?token=…` fonctionne dans votre agenda.
- [ ] La même adresse **sans le jeton** renvoie 404.
- [ ] Seul un administrateur voit le lien dans Paramètres.

---

## 4. Après ouverture, les premiers jours

```sh
# Les connexions, réussies et refusées
journalctl -u foyer --since today | grep -E "Connexion (réussie|refusée)"

# Les dix adresses les plus insistantes sur le formulaire, côté proxy
awk '$7=="/api/auth/login"' /var/log/nginx/proxy-host-*_access.log \
  | awk '{print $1}' | sort | uniq -c | sort -rn | head
```

- [ ] Les connexions apparaissent bien dans le journal, avec l'adresse réelle du
      client et non celle du proxy. Si vous voyez l'adresse du proxy partout, la
      ligne `proxy_set_header X-Forwarded-For` manque côté NGINX.
- [ ] fail2ban est en place et compte (section 7.4 du rapport d'audit).
- [ ] Une sauvegarde chiffrée est passée et **a été restaurée une fois pour de
      vrai** (voir `docs/sauvegarde-restauration.md`). Une sauvegarde jamais
      restaurée n'est pas une sauvegarde.
