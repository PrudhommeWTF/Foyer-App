<!-- Fichier engendré par `cd backend && npm run docs:settings`. Ne pas modifier à la main : la CI compare. -->

# Paramètres de Foyer

Tous les réglages de l’application, leur portée, leur valeur par défaut et le module qui les
consomme. Cette page est **engendrée depuis le registre** (`backend/src/settings/registry.ts`,
copie identique dans `frontend/src/app/core/settings/registry.ts`), donc elle ne peut pas mentir.

## Les trois portées

| Portée | Où c’est écrit | Qui peut le changer |
|---|---|---|
| **Déploiement** | variables d’environnement (`/etc/foyer/foyer.env` en LXC, `docker-compose.yml` en Docker) | l’administrateur du serveur, suivi d’un redémarrage du service |
| **Foyer** | document du foyer, clé `settings` | un administrateur du foyer, depuis l’application |
| **Personnel** | document du foyer, par membre | le membre lui-même, depuis l’application |

Un réglage appartient à **une seule** portée. Quand une variable d’environnement
l’emporte sur un réglage du foyer, la colonne « Variable prioritaire » la nomme, et
l’interface grise le champ en l’expliquant.

## Foyer et affichage

Ce que voit tout le monde : identité du foyer et thème.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `dark` | Thème sombre | Personnel | oui / non | désactivé | — | Affichage | — |

- **Thème sombre** (`dark`) : Bascule l’application en couleurs sombres, sur tous vos appareils. Propre à vous : votre choix ne change rien à l’affichage des autres membres.

## Calendriers de référence

Vacances scolaires et partage de l’agenda. Plusieurs modules en dépendent.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `academie` | Académie | Foyer | liste | _(vide)_ | _(vide)_, `Aix-Marseille`, `Amiens`, `Besançon`, `Bordeaux`, `Clermont-Ferrand`, `Corse`, `Créteil`, `Dijon`, `Grenoble`, `Lille`, `Limoges`, `Lyon`, `Montpellier`, `Nancy-Metz`, `Nantes`, `Nice`, `Normandie`, `Orléans-Tours`, `Paris`, `Poitiers`, `Reims`, `Rennes`, `Strasbourg`, `Toulouse`, `Versailles` | Calendriers | — |
| `icsTasks` | Inclure les tâches datées dans le flux partagé | Foyer | oui / non | désactivé | — | Calendriers | — |

- **Académie** (`academie`) : Fixe la zone de vacances scolaires. Elle colore le calendrier, décide des créneaux « seulement en période scolaire » de l’emploi du temps, et fait passer l’accueil en rythme de vacances.
- **Inclure les tâches datées dans le flux partagé** (`icsTasks`) : Les tâches à faire qui ont une date apparaissent dans les agendas abonnés au lien ICS, préfixées « Tâche : ». Une tâche faite en disparaît ; une série n’y met que sa prochaine occurrence.

## Notifications et rappels

Ce qui vous interpelle, dans l’application et sur le téléphone.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `prefNotifs` | Alertes dans l’application | Personnel | oui / non | activé | — | Notifications | — |
| `publicUrl` | Adresse publique de Foyer | Foyer | texte | _(vide)_ | 300 caractères au maximum | Notifications | `FOYER_PUBLIC_URL` |

- **Alertes dans l’application** (`prefNotifs`) : La cloche en haut de l’écran : agenda du jour, tâches en retard, anniversaires, échéances. Propre à vous, et sans effet sur les rappels envoyés au téléphone.
- **Adresse publique de Foyer** (`publicUrl`) : L’adresse ouverte quand on touche une notification sur le téléphone, par exemple https://foyer.exemple.fr. Vide, la notification ouvre l’adresse par laquelle l’appareil s’était abonné, ce qui échoue depuis l’extérieur si c’était une adresse locale.

## Repas et cuisine

Planning des repas, suggestions et génération des courses.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `showBreakfast` | Afficher le petit-déjeuner | Foyer | oui / non | désactivé | — | Repas | — |

- **Afficher le petit-déjeuner** (`showBreakfast`) : Ajoute la ligne du matin au planning des repas, et donc à la génération des courses. Les repas déjà saisis sont conservés quand la ligne est masquée.

## Accès et comptes

Qui peut ouvrir un compte, et ce que l’application a le droit d’aller chercher dehors.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `signupAllowed` | Autoriser la création de comptes | Foyer | oui / non | activé | — | Accès | `FOYER_ALLOW_SIGNUP` |
| `recipeImport` | Importer une recette depuis une adresse web | Foyer | oui / non | activé | — | Cuisine | `FOYER_RECIPE_IMPORT` |

- **Autoriser la création de comptes** (`signupAllowed`) : Quand c’est coupé, l’écran de connexion ne propose plus de créer un compte et l’API refuse les inscriptions. À laisser coupé dès que l’application est joignable depuis Internet.
- **Importer une recette depuis une adresse web** (`recipeImport`) : La seule requête sortante de l’application, déclenchée par vous et journalisée : le carnet va lire la page d’une recette pour la recopier. Coupé, le bouton d’import disparaît du carnet.

## Serveur et déploiement

Ce que la machine impose. Non modifiable ici : ces valeurs se changent dans la configuration du service, puis redémarrage.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `envVersion` | Version installée | Déploiement | texte | _(vide)_ | 200 caractères au maximum | Exploitation | `FOYER_VERSION` |
| `envDataDir` | Dossier des données | Déploiement | texte | _(vide)_ | 200 caractères au maximum | Exploitation | `FOYER_DATA_DIR` |
| `envPort` | Port d’écoute | Déploiement | texte | `8099` | 200 caractères au maximum | Exploitation | `PORT` |
| `envJwtSecret` | Secret de signature des sessions | Déploiement | undefined | _(vide)_ | — | Accès | `FOYER_JWT_SECRET` |
| `envCorsOrigins` | Origines cross-origin autorisées | Déploiement | texte | _(vide)_ | 200 caractères au maximum | Exploitation | `FOYER_CORS_ORIGINS` |
| `envSelfUpdate` | Mise à jour automatique | Déploiement | texte | _(vide)_ | 200 caractères au maximum | Exploitation | `FOYER_SELF_UPDATE` |
| `envGithubRepo` | Dépôt consulté pour les mises à jour | Déploiement | texte | `PrudhommeWTF/Foyer-App` | 200 caractères au maximum | Exploitation | `FOYER_GITHUB_REPO` |
| `envGithubToken` | Jeton GitHub | Déploiement | undefined | _(vide)_ | — | Exploitation | `FOYER_GITHUB_TOKEN` |
| `envVapidPrivate` | Clé privée des rappels (VAPID) | Déploiement | undefined | _(vide)_ | — | Notifications | `FOYER_VAPID_PRIVATE` |

- **Version installée** (`envVersion`) : La version que ce service exécute. Injectée au build de l’image Docker, ou posée par l’installeur LXC dans /etc/foyer/foyer.env.
- **Dossier des données** (`envDataDir`) : Où vivent la base SQLite, les fichiers, les photos et les sauvegardes de migration. C’est ce dossier qu’il faut archiver pour avoir une sauvegarde complète.
- **Port d’écoute** (`envPort`) : Le port sur lequel le service répond, derrière votre reverse-proxy le cas échéant.
- **Secret de signature des sessions** (`envJwtSecret`) : Il protège tous les jetons de session : un secret faible laisse forger une session d’administrateur. Jamais affiché, seulement son état. En production, un secret absent ou trop court empêche le démarrage.
- **Origines cross-origin autorisées** (`envCorsOrigins`) : À laisser vide en mono-conteneur : l’API sert sa propre application, donc aucune requête n’est cross-origin. Ne sert qu’à un déploiement où l’application est servie par un autre hôte.
- **Mise à jour automatique** (`envSelfUpdate`) : Quand elle est active, le bouton « Mettre à jour maintenant » dépose un fichier déclencheur qu’une unité systemd root exécute. Elle ne se change pas ici : une unité systemd en dépend.
- **Dépôt consulté pour les mises à jour** (`envGithubRepo`) : Le dépôt GitHub dont les releases sont comparées à la version installée.
- **Jeton GitHub** (`envGithubToken`) : Facultatif, et seulement utile pour un dépôt privé ou pour ne pas se faire limiter par GitHub lors des vérifications de version.
- **Clé privée des rappels (VAPID)** (`envVapidPrivate`) : Sans elle, une paire est engendrée au premier démarrage et gardée en base. En changer invalide tous les appareils déjà abonnés aux rappels.

## Où c’est stocké, et comment le sauvegarder

Les réglages du foyer vivent dans le document JSON (table `household`), et le journal
des modifications dans la table `hh_settings_log` de la même base. Une archive du
dossier de données emporte donc les deux : il n’y a pas de sauvegarde séparée à penser.

**Avant toute migration**, service arrêté (la base est en WAL : copier `foyer.db` pendant
que le service tourne donne une archive corrompue) :

```bash
# LXC natif
systemctl stop foyer
install -d -m 750 /var/backups/foyer
tar czf "/var/backups/foyer/foyer-$(date +%F-%H%M).tar.gz" -C /var/lib foyer
cp /etc/foyer/foyer.env "/var/backups/foyer/foyer.env-$(date +%F-%H%M)"
systemctl start foyer && curl -fsS http://127.0.0.1:8099/api/health

# Docker
docker compose stop foyer
docker run --rm -v foyer_data:/data -v "$PWD":/sauvegarde alpine \
  tar czf "/sauvegarde/foyer-$(date +%F-%H%M).tar.gz" -C /data .
docker compose start foyer
```

Restauration et vérification : voir [README, « Sauvegarde et restauration »](../README.md#-sauvegarde-et-restauration).

Les migrations du document sont **rejouables** (chacune ne réagit qu’à l’ancienne forme)
et **réversibles** : le document d’origine est écrit sur le disque avant la première
migration en attente. Un réglage nouvellement déclaré n’a besoin d’aucune migration : il
prend sa valeur par défaut, et le document n’est réécrit que le jour où on le change.

## Emporter et remettre la configuration

Vos réglages seuls, dans un fichier JSON lisible. Ce n’est **pas** une sauvegarde des
données : c’est le filet de sécurité avant de toucher aux réglages, et ce qui évite de
tout reparamétrer de mémoire après une réinstallation.

Depuis l’application : Paramètres → Exploitation → Configuration. En ligne de commande :

```bash
# Exporter (compte administrateur)
TOKEN=$(curl -sS -X POST http://127.0.0.1:8099/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"vous@exemple.fr","password":"..."}' | jq -r .token)
curl -sS http://127.0.0.1:8099/api/settings/export \
  -H "Authorization: Bearer $TOKEN" -o foyer-reglages.json

# Réimporter
jq '{config: .}' foyer-reglages.json | curl -sS -X POST \
  http://127.0.0.1:8099/api/settings/import \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @-
```

Le fichier porte **toutes** les clés, valeurs par défaut comprises : sans cela, réimporter
ne ramènerait pas l’état d’avant. L’import est rejouable, et n’échoue jamais en bloc : une
clé disparue, une valeur hors domaine, un membre qui n’existe plus ou un réglage imposé par
l’environnement sont écartés **en le disant**, le reste passe.

## Qui peut changer quoi

Le contrôle est **côté serveur**, pas dans l’écran :

- `GET /api/settings` : tout membre connecté. Un adulte a le droit de savoir comment le foyer est réglé.
- `PATCH /api/settings` : **administrateur uniquement**, sinon `403`. Les réglages s’écrivent clé par clé, jamais par enregistrement du document entier, pour que deux administrateurs simultanés ne s’écrasent pas.
- `PUT /api/state` ignore le bloc `settings` et refuse (`403`) l’enregistrement d’un non-administrateur qui tenterait de le modifier par là.

Chaque écriture est journalisée : qui, quand, quelle clé, de quelle valeur vers quelle valeur.
Le journal se lit dans la page Paramètres, et en ligne de commande :

```bash
sqlite3 /var/lib/foyer/foyer.db \
  "SELECT at, member_id, key, before_json, after_json FROM hh_settings_log ORDER BY id DESC LIMIT 20;"
```

## Ajouter un réglage

1. Déclarer une entrée dans `backend/src/settings/registry.ts`.
2. Recopier le fichier à l’identique dans `frontend/src/app/core/settings/registry.ts`.
3. Le lire dans le code avec `setting('maCle', doc)` (côté serveur) ou `store.setting('maCle')` (côté application).
4. Régénérer cette page : `cd backend && npm run docs:settings`.

La page Paramètres n’est pas à modifier : elle est engendrée depuis le registre.
Un réglage déclaré que personne ne lit, ou une clé lue qui n’est pas déclarée, **fait échouer la CI**.
