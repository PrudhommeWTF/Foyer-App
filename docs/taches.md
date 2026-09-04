# Tâches : modèle, écriture, hors ligne, exploitation

Ce document décrit le module Tâches tel qu'il est depuis la tranche 1 du
chantier « parité FamilyWall et intégration » (l'état des lieux qui l'a
précédé est dans [`taches-etat-des-lieux.md`](taches-etat-des-lieux.md)).
Il s'adresse à qui exploite l'application : ce que le module garantit, où
sont les données, comment sauvegarder, migrer, revenir en arrière, et quoi
lire dans le journal quand quelque chose cloche.

## Le principe qui commande tout le reste

**Une tâche ne s'écrit jamais par l'enregistrement du document entier.**

Le reste du foyer s'enregistre par `PUT /api/state`, document complet, avec un
contrôle de version et un rejeu des modifications en cas de conflit. Pour ce
qui se coche à deux, ce n'est pas suffisant : « cocher » écrit comme une
bascule et rejoué sur la version de l'autre appareil **décoche** ce qu'il
venait de cocher. C'est le défaut qui rendait le module inutilisable.

Les tâches passent donc par des **opérations ciblées** (`POST /api/tasks/ops`),
exactement comme la liste de courses :

- une opération dit une **intention** (« cette tâche est faite »), jamais une
  bascule. Rejouée deux fois, elle ne fait rien de plus ;
- chaque opération porte un **identifiant** que le serveur retient dans
  `hh_task_ops`. Un « ajouter » rejoué après une coupure ne ressuscite pas une
  tâche supprimée entre-temps ;
- un lot est appliqué dans **une transaction SQLite** : deux téléphones qui
  cochent en même temps se sérialisent au lieu de s'écraser ;
- `PUT /api/state` **ignore le champ `tasks`** et garde celui du serveur, quel
  que soit l'âge du client. Les listes, elles, s'éditent par le document, et le
  serveur en tire les conséquences pour les tâches (liste supprimée : ses
  tâches partent avec, et le journal le dit).

Les tâches restent dans le même document JSON que le reste : une archive du
répertoire de données demeure une sauvegarde complète.

## Le modèle

```ts
type ListKind = 'taches' | 'corvees' | 'checklist';

interface TaskList {
  id; name; color; icon;
  kind: ListKind;      // seules les listes « taches » sont l'affaire du jour
  scope: string;       // 'shared', ou l'id du membre pour une liste privée
  position: number;
  archived?: boolean;
}

interface TaskTemplate { id; name; kind; color; icon; items: string[]; }

interface TaskItem {
  id; listId; text;
  note?: string;
  cat?: string;               // catégorie libre : Maison, Administratif…
  who: string[];              // vide = « le premier qui passe »
  due: string | null;         // AAAA-MM-JJ
  time?: string | null;       // HH:MM, ignorée sans date
  done: boolean;
  doneAt?; doneBy?;           // qui a coché, et quand
  by?; at?;                   // auteur et date de création
  shopListId?: string | null; // lien vers une liste de courses
}
```

Ce que ces choix impliquent à l'écran :

- **« Toutes » et l'accueil ne montrent que les listes `taches`**, partagées ou
  à moi. Une liste de valise (`checklist`) ou de corvées ne pèse pas sur la
  journée. C'est aussi là que se rangent les idées sans engagement : une liste
  « Idées » de type checklist, hors du quotidien.
- **Une liste privée est cachée, pas chiffrée.** Le document est lu en entier
  par tout compte authentifié (`GET /api/state`). Entre deux adultes et des
  enfants sans compte, c'est un réglage d'affichage, et il est présenté ainsi.
- **Une tâche dont la liste a disparu est montrée** dans « Toutes » plutôt que
  cachée : rien ne se perd en silence.
- **Le retard se dit, il ne crie pas.** L'écran groupe : aujourd'hui, en retard
  (le récent d'abord), à venir, sans date. L'accueil relègue le retard de plus
  d'un mois derrière le jour même, sans jamais le décompter.
- **La priorité n'existe plus.** La catégorie organise ; un badge rouge
  « Haute » était l'affichage anxiogène que le module refuse.

Les champs prévus pour les tranches suivantes (récurrence, rappel, liens vers
un contrat ou un document) n'existent pas encore dans le modèle : ils
arriveront avec ce qui les lit.

## Les opérations

| Opération | Champs | Effet |
|---|---|---|
| `add` | `id`, `listId`, `text`, et au choix `note`, `cat`, `who`, `due`, `time`, `shopListId`, `done`, `doneAt`, `doneBy` | Crée la tâche. Une tâche déjà là sous cet `id` : acquittée, sans doublon. `done` à l'ajout sert à annuler une suppression. |
| `edit` | `id` et les champs à changer | Ne touche que les champs nommés. `who` est remplacé, jamais fusionné. |
| `done` | `id` | Faite. Déjà faite : acquittée, et c'est la première coche qui reste (`doneBy`). |
| `reopen` | `id` | Rouverte. |
| `remove` | `id` | Supprimée. |

Chaque opération porte `opId` (généré par le client), `by`, `at`. Une
opération sur une tâche disparue est **acquittée** (sans objet), pas refusée :
quelqu'un l'a supprimée pendant que l'autre était hors ligne.

Ce qui est **refusé**, avec la raison renvoyée au client et écrite au journal :
une tâche sans intitulé, une liste inconnue, une date qui n'est pas
`AAAA-MM-JJ`, une heure qui n'est pas `HH:MM`, une opération inconnue. Un
membre inconnu dans `who` est simplement retiré. Un lien vers une liste de
courses disparue tombe, la tâche reste.

Un « report » est un `edit` de `due`. **Annuler** envoie l'opération inverse
(`reopen` après `done`, `add` avec la tâche telle qu'elle était après `remove`,
`edit` des valeurs d'avant), jamais une remise en bloc du tableau, qui
effacerait ce que l'autre appareil a écrit entre-temps. Le report en masse
(« Tout reporter à aujourd'hui ») s'annule en un geste, de la même façon.

## La lecture : un seul sondage

`GET /api/live?since=<version>` rend les courses **et** les tâches quand la
version du document a bougé, et `{ unchanged: true }` sinon. Ce sont deux
sous-arbres du même document, une seule minuterie suffit : toutes les cinq
secondes sur les écrans Courses et Tâches, toutes les quinze sur l'accueil,
jamais ailleurs ni quand l'onglet est en arrière-plan.

Une réponse à un lot d'opérations ne fait pas avancer la version connue du
sondage : elle ne dit rien de ce que l'autre appareil a pu écrire ailleurs. Le
sondage suivant rattrape tout en un aller-retour.

## Hors ligne : ce qui est garanti, ce qui ne l'est pas

Dans une application **déjà ouverte** (onglet, ou raccourci sur l'écran
d'accueil), cocher, ajouter, modifier, reporter et supprimer sans réseau
fonctionne :

- l'écran est mis à jour tout de suite ;
- l'opération est écrite dans une file **persistée dans le navigateur**
  (`localStorage`, clé `foyer.taskQueue`), qui survit à un onglet recyclé par iOS ;
- l'écran affiche « Hors ligne. N modification(s) en attente » ;
- la file repart au retour du réseau, à la reprise de l'onglet ou au prochain
  geste, et la réponse du serveur fait autorité ;
- une opération **refusée** par le serveur est retirée de la file et signalée
  (« Refusé : la liste visée n'existe plus »). Elle ne tourne pas en boucle.

Ce qui n'est **pas** garanti : ouvrir l'application en mode avion alors qu'elle
n'était pas chargée. Il n'y a ni service worker ni manifeste PWA. C'est une
tranche à part, envisagée après les notifications, qui en auront besoin aussi.

Une liste créée à l'instant part par le document, pas par la file : la file
attend que le document soit enregistré avant de partir, sinon le serveur
refuserait la tâche pour une liste qu'il ne connaît pas encore.

## Où vit le code

| Fichier | Rôle |
|---|---|
| `backend/src/tasks/ops.ts` | Le moteur d'opérations, pur : validation, idempotence, rattrapage après édition des listes et des membres. |
| `backend/src/tasks/repo.ts` | La transaction SQLite, le journal `hh_task_ops`, et `preserveTasks` qui protège le `PUT`. |
| `backend/src/tasks/routes.ts` | `POST /api/tasks/ops`. |
| `backend/src/state/doc.ts` | Lecture et écriture brutes du document, partagées avec les courses. |
| `backend/src/server.ts` | `GET /api/live`, et l'appel de `preserveTasks` dans `PUT /api/state`. |
| `backend/src/state/migrations.ts` | Migration 9. |
| `frontend/src/app/core/task-ops.ts` | Application locale d'une opération, et son inverse pour « Annuler ». |
| `frontend/src/app/core/tasks.ts` | Ce qui se voit et dans quel ordre, les suggestions, les dates d'un tap. |
| `frontend/src/app/core/foyer.store.ts` | La file, le sondage commun, les gestes, les listes et les modèles. |
| `frontend/src/app/screens/taches/composer.ts` | La saisie rapide et sa barre d'action, réutilisée par l'accueil et la modale de modification. |
| `frontend/src/app/screens/taches/taches.ts` | L'écran. |
| `frontend/src/app/screens/home/taches.ts`, `core/tiles/taches.tile.ts` | La tuile d'accueil et son fournisseur. |

## Migration 9

`tâches : échéance datée, affectation multiple, listes typées`

Elle transforme chaque tâche et chaque liste du document. Rien n'est supprimé
en silence : ce qui n'a pas pu être converti est conservé ou nommé au journal.

| Avant | Après | Journal |
|---|---|---|
| `who: 'm1'` | `who: ['m1']` | |
| `who` désigne un membre disparu | `who: []`, la tâche est sans responsable | « N affectation(s) à un membre disparu retirée(s) » |
| `planned: '2026-09-05'` | `due: '2026-09-05'` | |
| `due: '05/09/2026'` (tâche créée depuis Finances) sans `planned` | `due: '2026-09-05'` | « N échéance(s) écrite(s) en JJ/MM/AAAA converties » |
| `due: 'avant vendredi'` sans `planned` | `due: null`, le texte est recopié dans `note` | « N échéance(s) en texte libre recopiée(s) dans la note » |
| `due: 'Aujourd'hui'`, `'Demain'`, `'Cette semaine'` sans `planned` | `due: null` | « N échéance(s) […] abandonnée(s) » : c'étaient les puces par défaut, sans rapport avec une date réelle |
| `prio` | disparaît | chaque tâche qui était « Haute » est nommée |
| liste sans `kind` | `kind: 'taches'`, `scope: 'shared'`, `position` = son rang | |
| pas de `taskTemplates` | `[]` | |

Rejouée sur un document déjà migré, elle ne change rien (vérifié par
`backend/test/state-migrations.test.ts`).

### Sauvegarde avant migration

La migration s'exécute au premier démarrage de la version qui la porte. Avant
de la lancer, le serveur écrit lui-même une copie du document d'origine dans
`<données>/backups/state-avant-migration-v8-<horodatage>.json`. Faites quand
même une sauvegarde complète, la base est en WAL et un `cp` de `foyer.db` seul
pendant que le service tourne donne un fichier corrompu :

```bash
# LXC natif : arrêt bref, archive complète du dossier de données
systemctl stop foyer
tar czf /root/foyer-$(date +%F-%H%M).tar.gz -C /var/lib/foyer .
systemctl start foyer

# Docker : instantané cohérent sans arrêt de service
STAMP=$(date +%F-%H%M)
docker compose exec -T foyer node -e "
const db = require('better-sqlite3')('/data/foyer.db');
db.exec(\"VACUUM INTO '/data/foyer-$STAMP.db'\"); db.close();"
docker compose cp foyer:/data/foyer-$STAMP.db ./foyer-$STAMP.db
```

### Vérifier que la migration s'est bien passée

```bash
# LXC
journalctl -u foyer -n 100 --no-pager | grep 'État'
# Docker
docker compose logs foyer | grep 'État'
```

Attendu : `migration 9 appliquée (tâches : échéance datée, affectation
multiple, listes typées)`, puis les lignes de conversion listées plus haut,
puis `document d'origine sauvegardé dans …`. Et, un peu plus haut dans le même
journal, `Foyer : migration 2 appliquée (journal des opérations de tâches)`.

Puis, côté données :

```bash
# Version du document (attendu : 9) et nombre de tâches, à comparer à la sauvegarde
DB=/var/lib/foyer/foyer.db     # Docker : docker compose exec foyer sh, puis /data/foyer.db
sqlite3 "$DB" "SELECT value FROM hh_meta WHERE key='state_version';"
sqlite3 "$DB" "SELECT json_array_length(state, '$.tasks') FROM household;"
sqlite3 "$DB" "SELECT json_extract(value, '$.text'), json_extract(value, '$.due'), json_extract(value, '$.who') FROM household, json_each(household.state, '$.tasks');"
```

Le nombre de tâches doit être **exactement** celui d'avant : la migration n'en
retire aucune.

### Revenir en arrière

1. Arrêter le service (`systemctl stop foyer`, ou `docker compose stop`).
2. Redéployer la version précédente de l'application.
3. Remettre le document d'origine en base et ramener la version du document à 8 :

```bash
DB=/var/lib/foyer/foyer.db
BACKUP=$(ls -t /var/lib/foyer/backups/state-avant-migration-v8-*.json | head -1)
sqlite3 "$DB" "UPDATE household SET state = readfile('$BACKUP'), version = version + 1 WHERE id = 1;
               UPDATE hh_meta SET value = '8' WHERE key = 'state_version';"
```

4. Redémarrer. Les tâches cochées ou créées **après** la migration ne sont pas
   dans ce document d'origine : c'est le prix d'un retour en arrière, et c'est
   pour cela que la sauvegarde complète est faite avant, pas après.

Le journal `hh_task_ops` peut rester : la version précédente ne le lit pas.

## Journal : ce qu'il faut savoir lire

| Ligne | Sens |
|---|---|
| `Tâches : N opération(s) écartée(s). <opId> : <raison>` | Un client a envoyé quelque chose que le serveur refuse (liste disparue, date illisible). Le client l'a retirée de sa file et l'a dit à l'écran. Si ça se répète pour une même raison, c'est un client périmé : recharger la page. |
| `Tâches : N tâche(s) retirée(s) avec leur liste, …` | Quelqu'un a supprimé une liste ; ses tâches sont parties avec, comme l'écran l'annonçait. Les affectations à un membre supprimé et les liens vers une liste de courses disparue sont comptés sur la même ligne. |
| `Tâches : erreur inattendue en appliquant un lot` | Une exception dans le moteur ou la base. Le lot n'a pas été écrit (transaction). À signaler avec la ligne complète. |
| `État : migration 9 appliquée …` et les lignes `Tâches : …` qui suivent | Voir ci-dessus. |

Vérifier ce que le serveur détient, sans passer par l'écran :

```bash
TOKEN=...   # jeton de session (Paramètres, ou POST /api/auth/login)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8099/api/live | python3 -m json.tool | head -60
```

## Tests

| Fichier | Ce qu'il tient |
|---|---|
| `backend/test/tasks-ops.test.ts` | Le moteur : une coche posée deux fois reste une coche et garde le premier auteur, deux appareils partis du même état gardent chacun leur travail, une modification ne décoche pas, rejeu après coupure, ajout rejoué sans doublon, opération sans objet acquittée, refus avec raison sans faire tomber le lot, bornes, rattrapage après suppression d'une liste, d'un membre, d'une liste de courses. |
| `backend/test/tasks-repo.test.ts` | La couture avec la base : version qui n'avance pas pour rien, journal qui survit, deux téléphones sur la même tâche, et un `PUT` périmé qui ne peut ni décocher ni ressusciter. |
| `backend/test/state-migrations.test.ts` | La migration 9 : chaque conversion, ce qui est nommé au journal, la rejouabilité, aucune tâche perdue. |
| `frontend/src/app/core/task-ops.test.ts` | L'application locale sans bascule, et l'inverse exact de chaque opération pour « Annuler ». |
| `frontend/src/app/core/tasks.test.ts` | Le compteur et la relégation de l'accueil, ce qui se voit selon le type et la portée des listes, l'ordre des groupes, les suggestions, les catégories, les dates d'un tap, la lecture de l'échéance. |
| `frontend/src/app/core/tiles/tiles.test.ts` | La tuile d'accueil : trois vides différents, compteur sur le jour seulement. |

Tous tournent en CI (`npm test` dans `backend/` et dans `frontend/`).

## Ce que la tranche 1 ne fait pas encore

Récurrence (tranche 2), rappels et notifications (tranche 3), liens vers un
contrat ou un document, clôture proposée quand la dernière ligne de courses est
cochée, date proposée d'après l'emploi du temps, tap sur une tâche depuis le
calendrier et option ICS (tranche 4), glisser-déposer, sous-tâches et vue « ce
qui m'est affecté » (tranche 5).
