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
| `pushPaused` | Suspendre tous les rappels du foyer | Foyer | oui / non | désactivé | — | Notifications | — |
| `quietFrom` | Début des heures de silence | Foyer | heure | `21:30` | HH:MM | Notifications | — |
| `quietTo` | Fin des heures de silence | Foyer | heure | `07:00` | HH:MM | Notifications | — |
| `pushReminders` | Sur le téléphone : rappels de mes tâches | Personnel | oui / non | activé | — | Tâches | — |
| `pushAssigned` | Sur le téléphone : quand on m’affecte une tâche | Personnel | oui / non | activé | — | Tâches | — |
| `notifEvents` | Dans la cloche : agenda du jour et de demain | Personnel | oui / non | activé | — | Agenda | — |
| `notifTasks` | Dans la cloche : tâches du jour et en retard | Personnel | oui / non | activé | — | Tâches | — |
| `notifBirthdays` | Dans la cloche : anniversaires | Personnel | oui / non | activé | — | Contacts | — |
| `notifFinances` | Dans la cloche : budgets et échéances de contrat | Personnel | oui / non | activé | — | Finances | — |
| `publicUrl` | Adresse publique de Foyer | Foyer | texte | _(vide)_ | 300 caractères au maximum | Notifications | `FOYER_PUBLIC_URL` |

- **Alertes dans l’application** (`prefNotifs`) : La cloche en haut de l’écran : agenda du jour, tâches en retard, anniversaires, échéances. Propre à vous, et sans effet sur les rappels envoyés au téléphone.
- **Suspendre tous les rappels du foyer** (`pushPaused`) : Coupe d’un geste les rappels envoyés aux téléphones, pour tout le monde : le temps des vacances, d’un déménagement, d’une semaine chargée. Les rappels suspendus ne sont pas rattrapés à la reprise.
- **Début des heures de silence** (`quietFrom`) : À partir de cette heure, plus aucun rappel n’arrive sur les téléphones du foyer. Un rappel qui tombe pendant est reporté à la fin du silence, jamais perdu.
- **Fin des heures de silence** (`quietTo`) : Heure à laquelle les rappels reprennent, et à laquelle arrivent ceux qui ont été reportés pendant la nuit.
- **Sur le téléphone : rappels de mes tâches** (`pushReminders`) : Le rappel réglé sur une tâche datée (à l’heure, une heure avant, la veille au soir, le matin) arrive sur vos appareils abonnés. Coupé, la tâche garde son rappel mais vous ne le recevez plus.
- **Sur le téléphone : quand on m’affecte une tâche** (`pushAssigned`) : Quelqu’un du foyer vous affecte une tâche : vous êtes prévenu tout de suite, sans attendre d’ouvrir l’application.
- **Dans la cloche : agenda du jour et de demain** (`notifEvents`) : Les événements d’aujourd’hui et de demain apparaissent dans la cloche en haut de l’écran.
- **Dans la cloche : tâches du jour et en retard** (`notifTasks`) : Les tâches datées à faire aujourd’hui et celles qui ont dépassé leur échéance apparaissent dans la cloche.
- **Dans la cloche : anniversaires** (`notifBirthdays`) : Les anniversaires des membres et des contacts, dans les sept jours qui viennent.
- **Dans la cloche : budgets et échéances de contrat** (`notifFinances`) : Les budgets dépassés, les fenêtres de résiliation qui approchent et les mois d’opérations incomplets.
- **Adresse publique de Foyer** (`publicUrl`) : L’adresse ouverte quand on touche une notification sur le téléphone, par exemple https://foyer.exemple.fr. Vide, la notification ouvre l’adresse par laquelle l’appareil s’était abonné, ce qui échoue depuis l’extérieur si c’était une adresse locale.

## Repas et cuisine

Planning des repas, suggestions et génération des courses.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `mealTimeMorning` | Heure du petit-déjeuner | Foyer | heure | `08:00` | HH:MM | Repas | — |
| `mealTimeNoon` | Heure du déjeuner | Foyer | heure | `12:30` | HH:MM | Repas | — |
| `mealTimeEvening` | Heure du dîner | Foyer | heure | `19:30` | HH:MM | Repas | — |
| `suggestRepeatDays` | Ne pas resservir un plat avant | Foyer | entier | `15` | de 1 à 90 | Cuisine | — |
| `suggestForgottenDays` | Considérer un plat comme oublié après | Foyer | entier | `21` | de 2 à 365 | Cuisine | — |
| `suggestQuickMin` | Ce qu’on appelle une recette rapide | Foyer | entier | `25` | de 5 à 180 | Cuisine | — |
| `showBreakfast` | Afficher le petit-déjeuner | Foyer | oui / non | désactivé | — | Repas | — |

- **Heure du petit-déjeuner** (`mealTimeMorning`) : Heure de référence du créneau du matin. Elle décide de l’heure de l’événement créé quand un repas part à l’agenda, et de qui est compté à table selon l’emploi du temps.
- **Heure du déjeuner** (`mealTimeNoon`) : Heure de référence du créneau du midi. Un créneau d’emploi du temps marqué « hors du foyer » qui la couvre retire la personne du décompte des couverts.
- **Heure du dîner** (`mealTimeEvening`) : Heure de référence du créneau du soir. Même rôle que les deux précédentes : l’agenda et le décompte des couverts s’y accrochent.
- **Ne pas resservir un plat avant** (`suggestRepeatDays`) : Une recette servie il y a moins de ce nombre de jours est écartée des suggestions du planning. L’écran de suggestion dit combien de recettes il a écartées pour cette raison.
- **Considérer un plat comme oublié après** (`suggestForgottenDays`) : Passé ce délai sans l’avoir servi, une recette est remise en avant dans les suggestions avec la mention « pas fait depuis longtemps ».
- **Ce qu’on appelle une recette rapide** (`suggestQuickMin`) : Préparation et cuisson comprises, en minutes. En dessous, la recette est mise en avant les soirs de semaine chargés.
- **Afficher le petit-déjeuner** (`showBreakfast`) : Ajoute la ligne du matin au planning des repas, et donc à la génération des courses. Les repas déjà saisis sont conservés quand la ligne est masquée.

## Courses

Génération de la liste depuis les repas, et mémoire de ce qu’on a déjà. L’ordre des rayons et les articles de placard se règlent dans l’écran Courses.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `stockDays` | Durée du « j’ai déjà ça » | Foyer | entier | `21` | de 1 à 180 | Courses | — |

- **Durée du « j’ai déjà ça »** (`stockDays`) : Combien de jours un article écarté d’un « j’ai déjà ça » reste hors de la liste engendrée depuis les repas. Passé ce délai il revient, parce qu’un placard se vide. La date du geste reste affichée.

## Tâches

Ce qui compte encore comme l’affaire du jour, et ce qui rappelle.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `taskLateDays` | Au-delà de ce retard, une tâche passe derrière | Foyer | entier | `30` | de 1 à 365 | Tâches | — |
| `taskDefaultRemind` | Rappel proposé pour une nouvelle tâche datée | Foyer | liste | _(vide)_ | _(vide)_, `at`, `1h`, `eve`, `morning` | Tâches | — |

- **Au-delà de ce retard, une tâche passe derrière** (`taskLateDays`) : Une tâche en retard depuis plus longtemps cesse d’être l’affaire du jour et descend sous les tâches d’aujourd’hui. Elle n’est ni effacée ni masquée : elle cesse seulement de passer devant.
- **Rappel proposé pour une nouvelle tâche datée** (`taskDefaultRemind`) : Ce que le formulaire coche d’avance quand on donne une date à une tâche. Cela ne change aucune tâche existante, et reste modifiable tâche par tâche.

## Finances

Ce qui remonte sur l’accueil, et quand un compteur réclame un relevé.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `deadlineHorizonDays` | Horizon des échéances sur l’accueil | Foyer | entier | `60` | de 7 à 365 | Finances | — |
| `readingDueDays` | Relevé de compteur attendu après | Foyer | entier | `30` | de 7 à 365 | Énergie | — |

- **Horizon des échéances sur l’accueil** (`deadlineHorizonDays`) : Une fenêtre de résiliation ou une reconduction plus lointaine que cela n’apparaît pas sur l’accueil : elle n’appelle aucun geste aujourd’hui. L’écran Contrats les montre toutes, quoi qu’il arrive.
- **Relevé de compteur attendu après** (`readingDueDays`) : Passé ce délai sans nouveau relevé, le compteur est signalé comme à relire. Un mois par défaut, et non la périodicité de facturation : celle-ci dit quand le fournisseur prélève, pas quand une dérive devient visible.

## Documents

Ce que le foyer accepte de ranger sur son disque.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `maxUploadMb` | Taille maximale d’un fichier | Foyer | entier | `20` | de 1 à 20 | Documents | — |

- **Taille maximale d’un fichier** (`maxUploadMb`) : En mégaoctets, pour les documents du foyer comme pour les photos de recettes. Le serveur refuse de toute façon au-delà de 20 Mo : c’est son plafond technique, celui-ci est le vôtre, en dessous.

## Accès et comptes

Qui peut ouvrir un compte, et ce que l’application a le droit d’aller chercher dehors.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `signupAllowed` | Autoriser la création de comptes | Foyer | oui / non | activé | — | Accès | `FOYER_ALLOW_SIGNUP` |
| `recipeImport` | Importer une recette depuis une adresse web | Foyer | oui / non | activé | — | Cuisine | `FOYER_RECIPE_IMPORT` |
| `sessionDays` | Durée de validité d’une session | Foyer | entier | `30` | de 1 à 365 | Accès | — |
| `passwordMinLength` | Longueur minimale d’un mot de passe | Foyer | entier | `6` | de 6 à 64 | Accès | — |

- **Autoriser la création de comptes** (`signupAllowed`) : Quand c’est coupé, l’écran de connexion ne propose plus de créer un compte et l’API refuse les inscriptions. À laisser coupé dès que l’application est joignable depuis Internet.
- **Importer une recette depuis une adresse web** (`recipeImport`) : La seule requête sortante de l’application, déclenchée par vous et journalisée : le carnet va lire la page d’une recette pour la recopier. Coupé, le bouton d’import disparaît du carnet.
- **Durée de validité d’une session** (`sessionDays`) : Combien de jours une connexion reste valable avant de redemander le mot de passe. Les sessions déjà ouvertes gardent leur durée : c’est à la connexion suivante que la nouvelle valeur s’applique.
- **Longueur minimale d’un mot de passe** (`passwordMinLength`) : S’applique à la création d’un accès et à tout changement de mot de passe. Les mots de passe existants ne sont pas invalidés : personne ne se retrouve dehors parce que la règle a changé.

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
