# Module « École » (ÉcoleDirecte) : exploitation

Ce que le module fait aujourd'hui, comment il se connecte à ÉcoleDirecte, comment
le surveiller en shell, et quoi faire quand ça casse. Le choix de conception est
dans `docs/ecole-etat-des-lieux.md`.

**État : module complet (quatre tranches).** Comptes ÉcoleDirecte, question de sécurité,
association des élèves aux membres, connexion périodique, journal ; puis, pour
chaque élève associé, le cahier de textes (devoirs projetés en tâches), la case
« Fait » dans les deux sens, l'emploi du temps (cours dans l'Emploi du temps et
la présence aux repas), les notes et moyennes, la vie scolaire, et les
notifications, et les outils d'assistant (`ecole_*`, voir `docs/assistants.md`).
Messagerie, formulaires, porte-monnaie cantine : pas dans cette version.

---

## 0. Ce que voit la famille

| Où | Quoi |
|---|---|
| **École** (menu, section « Le foyer ») | Un onglet par enfant (un enfant ne voit que lui). Devoirs groupés par jour, demain en tête, énoncé lisible (liens gardés), badge « Interrogation », case « Fait », mention « non transmis » tant qu'ÉcoleDirecte ne l'a pas reçue, « modifié le … » quand le professeur a changé l'énoncé. « Passés » garde tout l'historique, devoirs retirés d'ÉcoleDirecte compris : la semaine écoulée dépliée, les mois plus anciens repliés sous « Plus anciens », et une recherche (matière, énoncé, professeur, sans tenir compte des accents) sur l'ensemble. |
| **Tâches** | Une liste « Devoirs de <prénom> » par élève associé, une tâche par devoir à venir, affectée à l'enfant, échéance à la date de rendu, étiquette « ÉcoleDirecte ». Pas de « + » : une tâche maison va dans une autre liste. Une interrogation porte le rappel « la veille à 18 h ». |
| **Emploi du temps** | Les cours importés, à côté des créneaux saisis à la main (le car scolaire reste), étiquetés « ÉcoleDirecte », en lecture seule, annulés barrés. |
| **Planning des repas** | La présence tient compte des cours : un demi-pensionnaire qui a cours le matin et l'après-midi n'est pas attendu à midi ; un cours annulé libère. Case « Demi-pensionnaire » par élève dans Paramètres → École. |
| **Agenda** | Un repère « Interro <matière> » au jour de l'interrogation. Les devoirs y sont déjà, comme toute tâche datée. |
| **Accueil** | Tuile École : ce qui reste pour demain par enfant, les interrogations, l'état de la synchronisation (« ÉcoleDirecte indisponible depuis … » le cas échéant). |
| **École → Notes** | Les dernières notes (nombre réglable, 15 par défaut), valeur telle que donnée (« 14,5/20 », « Abs »), non significatives barrées ; au tap : type, coefficient, moyenne, plus basse et plus haute de la classe. Les moyennes de la période en cours, moyenne générale en tête, **telles que l'établissement les calcule** : Foyer ne recalcule rien, ne classe rien, ne trace aucune courbe. |
| **École → Vie scolaire** | Absences, retards (justifiés ou non), sanctions, encouragements de l'année. |
| **Assistant** (Claude, via MCP) | « Qu'est-ce que Nolan a comme devoirs pour demain ? », « À quelle heure sort Léo jeudi ? », « Coche mes exercices de maths » : outils `ecole_*`. Un jeton d'enfant ne voit que lui. Voir `docs/assistants.md`. |
| **Téléphone** | Une nouvelle note (« Nolan : 15/20 en histoire »), une absence ou un retard (« Léo : retard enregistré aujourd'hui, non justifié »), une sanction, et, si on le demande, un nouveau devoir. Plusieurs au même passage se regroupent (« Nolan : 3 nouvelles notes »). Le soir à 17 h 30 (réglable), s'il reste des devoirs pour demain : « Nolan : 2 devoirs pour demain, dont une interrogation ». |

**Notifications : qui reçoit quoi.**

| Sorte | Adultes | L'enfant concerné | Préférence (personnelle, Paramètres → École) |
|---|---|---|---|
| Nouvelle note | oui | oui (les siennes seulement) | « Me prévenir d'une nouvelle note », activé par défaut |
| Absence, retard, sanction, encouragement | oui | non | « Me prévenir d'une absence… », activé par défaut |
| Nouveau devoir | oui | oui | « Me prévenir d'un nouveau devoir », désactivé par défaut |
| Rappel du soir | oui | oui | « Sur le téléphone : rappels de mes tâches » (section Notifications) |

Seuls les membres qui ont un compte et un téléphone abonné reçoivent quelque
chose. La **toute première lecture** des notes, de la vie scolaire et des
devoirs d'un élève est muette (sinon trente notes d'un coup) ; ensuite chaque
ligne n'est annoncée qu'une fois (`notified_at`), qu'il y ait eu des
destinataires ou non. « Suspendre les rappels » du foyer coupe aussi ces
notifications. Le rappel du soir part une fois par élève et par soir, dans les
deux heures qui suivent l'heure réglée.

**« Fait » dans les deux sens.** Cocher dans l'écran École ou dans Tâches, c'est
la même coche ; elle part à ÉcoleDirecte au passage suivant. Coché dans
ÉcoleDirecte (par l'enfant sur l'application officielle), la tâche se coche au
passage suivant. Décoché dans ÉcoleDirecte : rien ne se décoche dans Foyer, et
rien ne repart (pas de bras de fer). Un envoi qui échoue laisse la case cochée
avec « non transmis » et repart au passage suivant.

**Ce que la synchronisation ne fait jamais.** Elle ne recrée pas une tâche que
quelqu'un a supprimée. Elle retire la tâche une semaine après la date de rendu
(ou quand le devoir disparaît d'ÉcoleDirecte) : le devoir, lui, reste dans
l'écran École (onglet « Passés », sans limite de durée). Elle ne crée pas de tâche pour un devoir déjà passé.

**Requêtes par passage, par élève** : la liste du cahier de textes, le détail
des jours qui le demandent (devoir nouveau ; aujourd'hui, demain et après-demain
à chaque passage ; les autres jours toutes les 6 h), un envoi groupé des
« fait » s'il y en a, l'emploi du temps, les notes, la vie scolaire. Les notes
et la vie scolaire ne sont demandées que si l'établissement ouvre ces modules à
l'élève (liste des modules renvoyée à la connexion). Une modification d'énoncé à plus de
deux jours peut donc mettre jusqu'à 6 h à apparaître.

---

## 1. À savoir avant d'activer

- **L'API d'ÉcoleDirecte n'est pas publique.** C'est celle de l'application
  mobile et du site, documentée par la communauté (bibliothèque Python
  `ecoledirecte`, dépôt `hacf-fr/ecoledirecte_api` ; `EduWireApps/ecoledirecte-api-docs`).
  Elle change sans préavis, et son usage par un tiers n'est pas prévu par ses
  conditions. Le module est fait pour casser proprement : un échec se voit dans
  Paramètres avec la date de la dernière réussite, jamais une donnée périmée
  présentée comme fraîche.
- **Foyer détient les identifiants ÉcoleDirecte**, chiffrés en base (voir §2). Ils
  ne reviennent jamais au navigateur et ne sont jamais écrits dans le journal.
- **Risque de blocage du compte.** ÉcoleDirecte bloque un compte qui se connecte
  trop souvent « depuis un nouvel appareil » ou qui accumule les échecs. Le
  module se l'interdit :
  - une seule connexion par compte et par intervalle (30 min par défaut), un
    compte après l'autre, jamais deux échanges en parallèle ;
  - pas de connexion la nuit (22 h à 6 h) ni le dimanche avant 16 h (réglables) ;
  - l'appareil de confiance obtenu en répondant à la question de sécurité est
    gardé et renvoyé à chaque connexion : la question ne revient pas ;
  - **question de sécurité (250), identifiants refusés (505), version refusée
    (517)** : le compte se bloque et n'envoie plus rien jusqu'à votre geste ;
  - erreurs passagères (réseau, serveur en panne, 535) : au troisième échec de
    suite, pause automatique de 6 h ;
  - chaque incident prévient les administrateurs **une fois** (notification sur
    le téléphone), pas à chaque passage.
- **Désactivé, le module ne fait aucune requête.** Il l'est par défaut.
  Activation : Paramètres → Modules actifs → « École (ÉcoleDirecte) ». Le seul
  hôte contacté est `FOYER_ED_API_BASE` (`https://api.ecoledirecte.com`).

---

## 2. La clé de chiffrement `FOYER_SECRET_KEY`

Identifiant, mot de passe et appareil de confiance sont chiffrés en AES-256-GCM
avec une clé dédiée, distincte de `FOYER_JWT_SECRET` (faire tourner le secret
des sessions après un incident ne doit pas détruire ces identifiants).

**LXC** : l'installeur et la mise à jour la génèrent une fois dans
`/etc/foyer/foyer.env` si elle manque. Pour la poser à la main :

```sh
grep -q '^FOYER_SECRET_KEY=' /etc/foyer/foyer.env \
  || echo "FOYER_SECRET_KEY=$(openssl rand -base64 32)" >> /etc/foyer/foyer.env
chmod 600 /etc/foyer/foyer.env
systemctl restart foyer
```

**Docker** : dans le `.env` à côté du `docker-compose.yml`, puis recréer le conteneur.

```sh
grep -q '^FOYER_SECRET_KEY=' .env || echo "FOYER_SECRET_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d
```

| Situation | Ce qui se passe |
|---|---|
| Clé absente ou trop courte (< 32 caractères) | La section École le dit et refuse d'enregistrer un compte. Rien n'est jamais enregistré en clair. |
| Clé changée, ou base restaurée sur une machine sans la même clé | Le service démarre normalement. Les comptes passent en « Identifiants à ressaisir », aucune connexion ne part. Ressaisir les identifiants suffit, mais **la question de sécurité reviendra** (l'appareil de confiance était chiffré avec l'ancienne clé). |
| La bonne clé est remise en place | Les comptes reprennent seuls au passage suivant. |

La clé vit dans `/etc/foyer/foyer.env`, que la sauvegarde chiffrée décrite dans
`docs/sauvegarde-restauration.md` emporte déjà : restaurer cette archive
restaure aussi la clé.

---

## 3. Le flux de connexion

Tel qu'implémenté dans `backend/src/ecole/client/client.ts`, d'après la
bibliothèque `ecoledirecte` 0.4.0 :

1. `GET /v3/login.awp?gtk=1&v=<version>` : le serveur pose le cookie `GTK`.
2. `POST /v3/login.awp?v=<version>`, corps brut `data=<JSON>` avec `x-gtk: <GTK>`.
   Sans appareil connu : `identifiant`, `motdepasse`, `isReLogin: false`. Avec :
   en plus `cn`, `cv`, `uuid: ""` et `fa: [{cn, cv}]`.
3. Le jeton arrive dans l'en-tête `x-token` et repart tel quel. Un en-tête
   `2FA-Token`, s'il arrive, repart aussi.
4. Code 250 : `POST /v3/connexion/doubleauth.awp?verbe=get` donne la question et
   les propositions (base64). Foyer les affiche dans Paramètres et **attend**.
   Votre réponse part par `?verbe=post` (`data={"choix": "<base64>"}`) et rend
   `cn` / `cv`, l'appareil de confiance, chiffré en base aussitôt.

| Code | Sens | Conduite |
|---|---|---|
| 200 | OK | |
| 210 | Pas de données (vacances) | Pas une erreur |
| 250 | Question de sécurité | Bloqué jusqu'à votre réponse |
| 505 | Identifiants refusés | Bloqué jusqu'à la ressaisie |
| 517 | Version d'API refusée | Bloqué jusqu'au changement de `FOYER_ED_API_VERSION` |
| 520, 525 | Jeton invalide ou expiré | Reconnexion au passage suivant |
| 535 | Établissement indisponible | Passager, compte dans les trois échecs |
| autre | | Conservé brut dans le journal, pour chercher |

---

## 4. Les états d'un compte, et quoi faire

| Affiché | Cause | Votre geste |
|---|---|---|
| Connecté | Dernière connexion réussie | Rien |
| Question de sécurité à répondre | Code 250 | Toucher la bonne réponse. Une mauvaise compte comme une tentative chez ÉcoleDirecte. |
| Identifiants refusés | Code 505 (mot de passe changé ?) | « Ressaisir les identifiants ». La question ne revient pas si l'appareil de confiance est encore valide. |
| Version d'API refusée | Code 517 | Mettre à jour `FOYER_ED_API_VERSION` (§6), redémarrer : le compte reprend seul. |
| Identifiants à ressaisir | Clé de chiffrement changée ou absente | Remettre la bonne clé, ou ressaisir les identifiants. |
| En pause automatique jusqu'à … | Trois échecs passagers de suite | Attendre, ou « Reprendre » après avoir vérifié le réseau (§5). |
| En pause | Votre bouton « Mettre en pause » | « Reprendre » |

« Synchroniser maintenant » est limité à une tentative par minute et refusé tant
qu'une question, un refus d'identifiants ou une clé perdue attend votre geste.

---

## 5. Le journal

Chaque connexion écrit une ligne avec le compte, le résultat, la durée et le
code ÉcoleDirecte. Jamais l'identifiant, le mot de passe, le jeton, `cn` ni `cv`.

```sh
# LXC
journalctl -u foyer -f | grep 'École'
journalctl -u foyer --since today | grep 'École'
# Docker
docker compose logs -f foyer | grep 'École'
```

Exemples :

```
[foyer] École : compte 1 « Collège » : connexion : Connexion réussie : 2 élèves, 1 association proposée. (412 ms, code 200)
[foyer] École : compte 1 « Collège » : Question de sécurité demandée : en attente de réponse dans Paramètres. (380 ms, code 250). Aucune nouvelle connexion avant la réponse.
[foyer] École : compte 2 « Lycée » : connexion : ÉcoleDirecte refuse l’identifiant ou le mot de passe (505). Compte bloqué jusqu’à la ressaisie des identifiants. (290 ms, code 505, HTTP 200)
[foyer] École : compte 2 « Lycée » : connexion : ÉcoleDirecte injoignable (délai dépassé). 3 échecs de suite : pause automatique de 6 h. (20003 ms, code -, HTTP -)
```

Le même journal, en plus court, est dans Paramètres → École (« Journal des
synchronisations »), et en base :

```sh
sqlite3 -readonly /var/lib/foyer/foyer.db \
  "SELECT at, account_id, ok, ed_code, duration_ms, message FROM ed_sync_log ORDER BY id DESC LIMIT 20;"
```

**Réseau** : le LXC doit joindre `api.ecoledirecte.com:443`. Test sans
identifiants : `curl -sI "https://api.ecoledirecte.com/v3/login.awp?gtk=1&v=4.102.0" | grep -i set-cookie`
doit montrer un cookie `GTK`.

---

## 6. Quand l'API change

1. **Code 517** (« ÉcoleDirecte refuse la version d'API … ») : la version
   annoncée est trop ancienne. La dernière connue est celle de la constante
   `APIVERSION` dans `src/ecoledirecte_api/const.py` du dépôt
   `hacf-fr/ecoledirecte_api`.

   ```sh
   # LXC
   sed -i '/^FOYER_ED_API_VERSION=/d' /etc/foyer/foyer.env
   echo 'FOYER_ED_API_VERSION=4.103.0' >> /etc/foyer/foyer.env   # la nouvelle version
   systemctl restart foyer
   # Docker : FOYER_ED_API_VERSION dans l'environnement du service, puis docker compose up -d
   ```

2. **Autre changement** : lancer la sonde, qui fait une vraie connexion et
   affiche chaque échange (chemin, statut, code, en-têtes reçus) :

   ```sh
   # LXC (le fichier d'environnement est lu sur l'entrée standard : il n'est lisible que par root)
   runuser -u foyer -- node /opt/foyer/backend/dist/ecole/sonde.js --env - --liste < /etc/foyer/foyer.env
   runuser -u foyer -- node /opt/foyer/backend/dist/ecole/sonde.js --env - --compte 1 < /etc/foyer/foyer.env
   # Docker
   docker compose exec foyer npm run ecole:sonde -- --compte 1
   ```

   Elle ouvre la base en lecture seule, ne répond jamais à la question de
   sécurité, et compte comme une connexion pour ÉcoleDirecte : ne pas la lancer
   en boucle.

3. **Régénérer les fixtures** des tests avec `--fixtures <dossier>` : chaque
   réponse y est écrite anonymisée (noms, identifiants, jetons, `cn` / `cv`
   remplacés). Les relire avant de les copier dans `backend/test/fixtures/ecole/`.

Tout ce qui parle à ÉcoleDirecte est dans `backend/src/ecole/client/` : c'est le
seul dossier à corriger.

---

## 7. Sauvegarde et restauration

Les tables `ed_*` sont dans `foyer.db` : la sauvegarde globale
(`docs/sauvegarde-restauration.md`) et le bouton « Sauvegarder maintenant » de
Paramètres → Exploitation les emportent. Les colonnes chiffrées y restent chiffrées.

**Avant la mise à jour qui installe ce module** (la migration crée trois tables,
elle ne modifie rien d'existant) :

```sh
# LXC : instantané à chaud (la base est en WAL, ne pas copier le fichier)
apt-get install -y sqlite3   # une fois
sqlite3 /var/lib/foyer/foyer.db "VACUUM INTO '/root/foyer-avant-ecole-$(date +%Y%m%d-%H%M).db'"
cp /etc/foyer/foyer.env /root/foyer.env.avant-ecole

# Docker : même chose dans le volume
docker compose exec foyer node -e "require('better-sqlite3')('/data/foyer.db').exec(\"VACUUM INTO '/data/foyer-avant-ecole.db'\")"
```

**Revenir en arrière** (service arrêté) :

```sh
systemctl stop foyer
cp /root/foyer-avant-ecole-AAAAMMJJ-HHMM.db /var/lib/foyer/foyer.db
rm -f /var/lib/foyer/foyer.db-wal /var/lib/foyer/foyer.db-shm
chown foyer:foyer /var/lib/foyer/foyer.db && chmod 600 /var/lib/foyer/foyer.db
systemctl start foyer
```

Une version antérieure de Foyer ignore les tables `ed_*` : revenir à l'ancien
code sans restaurer la base fonctionne aussi.

**Le module seul** (déménager, rejouer) : connecté en administrateur, le module
actif, ouvrir dans le navigateur `https://<votre foyer>/api/ecole/export.json`
télécharge un JSON des trois tables. La restauration (`POST /api/ecole/restore`
avec `confirm: "REMPLACER"`) passe par la même session : les jetons d'API sont
refusés sur ce module, qui manipule des identifiants.

Restaurée sur un serveur dont la clé `FOYER_SECRET_KEY` diffère, une sauvegarde
donne des comptes « Identifiants à ressaisir » : rien ne plante.

---

## 8. Ce qui est stocké

| Table | Contenu |
|---|---|
| `ed_accounts` | Libellé, identifiant et mot de passe **chiffrés**, appareil de confiance **chiffré**, question en attente, état, dernière réussite et dernière erreur, pause |
| `ed_students` | Élèves vus à la connexion (prénom, nom, classe, établissement, modules ÉcoleDirecte actifs), membre associé et d'où vient l'association |
| `ed_sync_log` | Une ligne par connexion, réponse à la question ou passage de données (2 000 dernières) |
| `ed_homework` | Un devoir : date de rendu, matière, professeur, énoncé (HTML nettoyé et texte), interrogation, « fait » côté ÉcoleDirecte, dernier accord, valeur locale, erreur d'envoi, tâche projetée, archivage |
| `ed_lessons` | Un cours : jour, heures, matière, professeur, salle, annulé, modifié, archivage |
| `ed_grades` | Une note : date, matière, intitulé, valeur brute (« 14,5 », « Abs ») et numérique, barème, coefficient, moyenne, plus basse et plus haute de la classe, période, non significative, annoncée le |
| `ed_averages` | Les moyennes par période et par matière (et la moyenne générale), telles que renvoyées |
| `ed_life` | Absence, retard, sanction, encouragement : date, libellé, motif, justifié, par qui, annoncé le |

Retirer un compte efface ses secrets et l'archive ; l'historique reste.
« Repartir à zéro » à la réactivation du module efface les tables `ed_*`. Les
listes « Devoirs de … » restent alors dans Tâches comme des listes ordinaires :
les supprimer à la main si on n'en veut plus.

```sh
# Ce qui reste pour demain, par élève (lecture seule)
sqlite3 -readonly /var/lib/foyer/foyer.db "
  SELECT s.ed_first_name, h.subject, h.is_test, h.done_ed, h.done_synced, h.done_error
  FROM ed_homework h JOIN ed_students s ON s.id = h.student_id
  WHERE h.due_date = date('now', '+1 day') AND h.archived_at IS NULL;"
```
