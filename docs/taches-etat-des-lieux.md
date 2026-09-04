# Module Tâches : état des lieux et proposition

Document de travail préalable au chantier « parité FamilyWall et intégration »,
validé sur ses quatre points. La tranche 1 (socle, migration, concurrence, hors
ligne, saisie rapide) est livrée : ce qu'elle fait réellement est décrit dans
[`taches.md`](taches.md). Le reste de ce document est l'état des lieux tel
qu'il a servi à décider, conservé tel quel.

Lecture faite sur `main` au 3 septembre 2026 : `README.md`, `backend/src/`
(serveur, document d'état, couche courses, migrations), `frontend/src/app/`
(store, écran Tâches, accueil, calendrier, notifications, liens Finances et
Courses).

## 1. Ce qui existe aujourd'hui

### Le modèle

```ts
interface TaskList { id; name; color; icon; }
interface TaskItem {
  id; text; listId;
  who: string;              // un seul membre, obligatoire (défaut : moi)
  due: string;              // TEXTE LIBRE : « Aujourd'hui », « avant vendredi »
  planned?: string | null;  // vraie date ISO, celle que le calendrier lit
  done: boolean;
  prio: 'low' | 'med' | 'high';
  shopListId?: string | null; // lien vers une liste de courses
}
```

Ce qui coince dans ce modèle, avant même de parler de fonctionnalités :

- **`due` est du texte.** Il ne se compare pas, ne se trie pas, ne déclenche rien.
  Toute tâche créée en saisie rapide porte « Aujourd'hui » pour toujours : trois
  semaines plus tard, elle affiche encore « Aujourd'hui ». La vraie date est
  `planned`, un champ facultatif présenté comme « date de planification (option.) »
  au fond du formulaire. Deux champs pour une seule notion, et c'est le mauvais qui
  est mis en avant.
- **`who` est unique et obligatoire.** Une tâche « pour le premier qui passe »
  n'existe pas : elle est affectée à celui qui l'a saisie.
- **`done` est un booléen** sans qui ni quand, et **cocher est écrit comme une
  bascule** (`t.done = !t.done`). Le commentaire de `state-sync.ts` le dit
  lui-même : « Cocher une tâche que l'autre vient de cocher la décoche ». C'est
  exactement le cas interdit par le brief.
- Pas d'auteur, pas de note, pas de catégorie, pas d'heure, pas de rappel, pas de
  récurrence, pas d'ordre, pas de type ni de portée de liste.

### Le chemin d'écriture

Les tâches passent par `PUT /api/state`, document entier, avec contrôle de
version et rejeu des mutations (`state-sync.ts`). C'est mieux que « dernier
arrivé gagne » pour les créations, mais une bascule rejouée reste une bascule.
Hors ligne : l'enregistrement échoue, est retenté toutes les 8 s, et les
mutations en attente ne vivent **qu'en mémoire**. Un onglet que iOS recycle en
arrière-plan les perd sans un mot.

La liste de courses, elle, a résolu ces deux problèmes (`backend/src/shopping/`) :
opérations ciblées et idempotentes (« cet article est dans le panier », jamais
« inverse-le »), journal des opérations déjà appliquées, transaction SQLite, file
hors ligne persistée dans le navigateur, sondage différentiel. `PUT /api/state`
ignore le champ `shop` et garde celui du serveur. C'est le modèle à reprendre.

### Ce qui est déjà bien et à garder

- **L'accueil** : `core/tasks.ts` (ce qui est dû aujourd'hui, relégation du retard
  ancien, jamais de compteur d'arriéré), la tuile avec coche, « demain », saisie
  libre et **annulation**. C'est le bon esprit, il manque juste les attributs.
- **Le lien Courses** : `shopListId`, compte des articles restants, ouverture de
  la liste en un tap, intitulé calculé (`links.ts`).
- **Les membres** : couleur, initiales et nom viennent du store, source unique.
- **La recherche globale** et le menu « + » connaissent les tâches.
- **Le calendrier** affiche les tâches datées (lecture seule, sans clic).
- **Le centre de notifications** in-app dérive « à faire aujourd'hui » et « en
  retard » du document.

## 2. Tableau d'écart avec FamilyWall

Coût : **faible** (une demi-journée au plus), **moyen** (un à deux jours),
**élevé** (trois jours et plus, avec tests). La colonne « Tranche » renvoie au
découpage de la section 6.

| Fonctionnalité | Présente | Partielle | Absente | Détail | Coût | Tranche |
|---|:-:|:-:|:-:|---|---|---|
| Plusieurs listes | ✔ | | | Nom, couleur, icône, filtres par puce. | | |
| Listes d'usages différents (valise, corvées, fournitures) | | ✔ | | Aucun type : une liste de valise compte dans « Toutes » et sur l'accueil comme une corvée du jour. | faible | 1 |
| Liste privée ou partagée | | | ✔ | Tout est partagé. Voir la limite honnête en 3.3. | faible | 1 |
| Modèles de listes réutilisables | | | ✔ | | faible | 1 |
| Affectation à un membre | | ✔ | | Un seul, obligatoire. Pas de « personne ». | moyen | 1 |
| Affectation à plusieurs membres | | | ✔ | | (inclus) | 1 |
| Échéance datée | | ✔ | | `planned` existe mais est secondaire ; `due` est du texte. | moyen | 1 |
| Échéance avec heure | | | ✔ | | (inclus) | 1 |
| Rappel avant l'échéance | | | ✔ | Le centre in-app ne prévient que si l'app est ouverte. | élevé | 3 |
| Récurrence | | | ✔ | | élevé | 2 |
| Récurrence relative à la réalisation | | | ✔ | | (inclus) | 2 |
| Catégorie | | | ✔ | Il y a une priorité à trois niveaux, qui n'est pas la même chose. | faible | 1 |
| Notes libres | | | ✔ | | faible | 1 |
| Saisie en un champ unique | | ✔ | | Le champ existe (écran et accueil) mais fige tout : moi, aujourd'hui, liste active. Tout attribut demande le formulaire. | moyen | 1 |
| Barre d'action sous le champ | | | ✔ | | (inclus) | 1 |
| Suggestions à la saisie | | | ✔ | Le composant `f-quick-add` sait déjà les afficher ; l'emploi du temps et les courses ont le mécanisme. | faible | 1 |
| Visibilité en temps réel | | ✔ | | Le sondage n'existe que pour les courses. Une tâche cochée par l'autre n'apparaît qu'au rechargement, ou au hasard d'un conflit de version. | moyen | 1 |
| Consultation hors ligne | | ✔ | | Ce qui est déjà affiché reste lisible ; ouvrir l'app sans réseau ne charge rien (aucun service worker). | voir 3.4 | 1 |
| Coche hors ligne resynchronisée | | | ✔ | En mémoire seulement, perdue si l'onglet est recyclé. | moyen | 1 |
| Tâches datées dans le calendrier | ✔ | | | Lecture seule, sans clic, absentes du flux ICS. **À arbitrer** (section 5). | faible | 4 |
| Notifications quand quelque chose bouge | | ✔ | | Centre in-app dérivé, pas de push, pas de canal sortant. | élevé | 3 |
| Cocher d'une main, un tap, sans confirmation | ✔ | | | Sur l'écran et l'accueil. | | |
| Annulation après suppression ou report | | ✔ | | Sur l'accueil (coche, report). Pas sur l'écran Tâches, pas en masse. | faible | 1 |

### Intégrations

| Intégration | État | Détail | Coût | Tranche |
|---|---|---|---|---|
| Accueil : cocher, reporter, créer | présente | Bonne base. Manque : attributs à la création, tâche affectée à « moi » d'office. | faible | 1 |
| Courses : tâche qui pointe sur une liste, compte restant | présente | | | |
| Courses : dernière ligne cochée propose de clore la tâche | absente | | faible | 4 |
| Finances : échéance ou piste devient une tâche | partielle | La tâche est une copie sans lien retour : rien ne mène au contrat depuis la tâche. La piste, elle, retient `taskId` de son côté. | faible | 4 |
| Finances : ouvrir le contrat depuis la tâche | absente | | faible | 4 |
| Emploi du temps : proposer une date où le membre est là | absente | `schedule.ts` sait déjà dire qui est où et quand (`slotsOn`, `away`). | moyen | 4 |
| Membres : couleurs, initiales, pastilles | présente | Une seule pastille, faute de multi-affectation. | (inclus) | 1 |
| Documents : tâche qui pointe sur un fichier | absente | | faible | 4 |
| Agenda et flux ICS | partielle | Voir section 5. | faible | 4 |

Deux intégrations n'apportent rien et ne sont pas proposées : la messagerie
(le brief exclut les commentaires) et les recettes (aucun cas d'usage réel).

## 3. Proposition

### 3.1 Le modèle cible

```ts
type ListKind = 'taches' | 'corvees' | 'checklist';

interface TaskList {
  id; name; color; icon;
  kind: ListKind;
  /** 'shared', ou l'id du membre pour une liste privée. */
  scope: 'shared' | string;
  position: number;
  archived?: boolean;
}

/** Un modèle : un nom, un type, des intitulés. Rien de plus. */
interface TaskTemplate { id; name; kind: ListKind; color; icon; items: string[]; }

interface TaskRec {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  every: number;              // toutes les N unités, 1 par défaut
  days?: number[];            // hebdomadaire : lundi = 1 … dimanche = 7
  /** 'due' : à date fixe. 'done' : à partir de la réalisation. */
  base: 'due' | 'done';
  /** Tolérance en jours après l'échéance avant d'être « en retard ». Pour le saisonnier. */
  grace?: number;
  until?: string | null;
}

interface TaskItem {
  id; listId; text;
  note?: string;
  cat?: string;               // catégorie libre, suggérée : maison, enfants, administratif, courses…
  who: string[];              // vide = « le premier qui passe »
  due: string | null;         // ISO. Remplace `due` texte ET `planned`.
  time?: string | null;       // « 18:00 », facultatif
  remind?: number | null;     // minutes avant l'échéance (0, 60, 1440…)
  rec?: TaskRec | null;
  done: boolean;
  doneAt?: string | null; doneBy?: string | null;
  by?: string; at?: string;   // auteur et date de création
  /** Réalisations passées d'une série : { at, by, due }. */
  history?: { at: string; by: string | null; due: string | null }[];
  position?: number;
  // liens
  shopListId?: string | null;
  contractId?: number | null;
  fileId?: string | null;     // id d'une fiche Documents (FileItem.id)
}
```

Choix commentés :

- **Une seule date, `due`**, ISO, comparable. Le texte libre disparaît. Le mot
  « échéance » et le mot « planifié » désignaient la même chose ; il n'y en a plus
  qu'un.
- **`who` devient une liste**, comme `SchedSlot.who` l'est déjà. Vide veut dire
  « sans responsable », et c'est licite.
- **`done` reste un booléen** pour ne pas casser les huit endroits qui le lisent
  (accueil, calendrier, notifications, pistes d'économies). `doneAt` et `doneBy`
  s'ajoutent à côté.
- **Une tâche récurrente est une série.** Elle porte son échéance **courante** ;
  la cocher inscrit une ligne dans `history` et avance `due` à l'occurrence
  suivante. Il n'y a pas une ligne par occurrence, donc rien qui s'accumule et
  rien à purger. « Cette occurrence ou toute la série » se traduit simplement :
  modifier une occurrence détache une copie ponctuelle (sans `rec`) et fait
  avancer la série ; supprimer une occurrence fait avancer la série sans ligne
  d'historique ; « toute la série » agit sur la tâche elle-même.
- **Les deux modes de récurrence sont explicites** (`base`). Pour le test de la
  piscine, `base: 'done'` : fait le dimanche avec deux jours de retard, la
  prochaine tombe le dimanche suivant, pas le samedi.
- **Le saisonnier** (« ouvrir la piscine vers le 15 avril ») est une récurrence
  annuelle avec `grace` : l'échéance s'affiche « vers le 15 avril » et la tâche
  n'est comptée en retard qu'au bout de la tolérance. Pas de plage à deux bornes,
  qui doublerait les champs pour le même résultat.
- **La priorité disparaît.** Trois niveaux que personne ne règle en saisie
  rapide, et un badge rouge « Haute » est précisément l'affichage anxiogène que le
  brief refuse. La catégorie la remplace pour organiser. La migration journalise
  chaque valeur `high` abandonnée. **Si vous tenez à la priorité, dites-le : la
  garder coûte peu, mais je ne la recommande pas.**
- **Les listes `corvees` et `checklist` ne comptent ni dans « Toutes » ni sur
  l'accueil.** Une liste de valise ou d'idées n'est pas l'affaire du jour. C'est
  ce qui range « la tâche qui n'aurait jamais dû en être une » : une liste
  « Idées » de type checklist, hors du quotidien. Pas de champ de plus pour ça.
- **Les liens** sont des champs séparés (`shopListId`, `contractId`, `fileId`)
  plutôt qu'un objet générique : une tâche administrative peut viser un contrat
  **et** le document qui va avec.

### 3.2 La concurrence : opérations ciblées, comme les courses

Le choix : un endpoint **`POST /api/tasks/ops`** qui reçoit un lot d'opérations
et les applique dans une transaction SQLite ; `PUT /api/state` ignore désormais
le champ `tasks` et conserve celui du serveur, exactement comme pour `shop`. Les
listes, les modèles et le reste du document continuent de passer par `PUT`.

Pourquoi ce choix plutôt qu'une fusion du sous-arbre au moment du `PUT` :

- **Une fusion ne sait pas ce que l'utilisateur voulait.** Deux documents où la
  même tâche est cochée d'un côté et non de l'autre : lequel a raison ? Une
  opération « cette tâche est faite » le sait. Rejouée deux fois, elle ne fait
  rien. Rejouée après que l'autre l'a déjà cochée, elle ne fait rien non plus.
- **Le journal des opérations est ce qui rend le hors ligne sûr.** Un « ajouter »
  rejoué après une coupure ne ressuscite pas une tâche supprimée entre-temps.
- **Le code existe, testé, en production** sur les courses depuis plusieurs
  versions. Même forme de routeur, même journal (`hh_task_ops`), même file côté
  navigateur. Pas de nouvelle dépendance, pas de nouveau service.

Les opérations : `add`, `edit` (champs à modifier, y compris `due` pour un
report), `done` (avec l'occurrence visée : la valeur de `due` au moment du
geste, ce qui rend le geste sans effet s'il arrive après que l'autre a coché la
même occurrence), `reopen`, `move` (liste, position), `remove`. L'annulation est
l'opération inverse (`reopen` après `done`, `add` avec le même identifiant après
`remove`), jamais une remise en bloc du tableau.

**Qui calcule la prochaine occurrence.** Le frontend, et il l'envoie dans
l'opération `done`. C'est cohérent avec le reste de l'application (« le store
frontend est la source de vérité métier », `CLAUDE.md`), et ça évite de tenir
deux moteurs de récurrence identiques dans deux paquets qui ne peuvent pas
partager de code. Le serveur vérifie la forme, pas le calcul. Il fait déjà
confiance au client pour tout le document.

Sondage : un seul appel `GET /api/live?since=<version>` qui rend courses et
tâches ensemble quand la version a bougé, à la place du sondage courses actuel.
Deux minuteries pour deux sous-arbres du même document n'auraient aucun sens.

### 3.3 Les listes privées : ce que « privé » veut dire ici

Une liste privée est **cachée** aux autres membres, pas chiffrée. Le document
d'état est lu en entier par tout compte authentifié (`GET /api/state`), et le
serveur ne peut pas en retirer un morceau sans casser le `PUT` qui suit. Entre
deux adultes qui partagent un foyer et des enfants sans compte, c'est un
réglage d'affichage honnête, pas une confidentialité. Je le documenterai tel
quel. Si une vraie confidentialité était voulue, il faudrait sortir les tâches
du document, et ce n'est pas justifié ici.

### 3.4 Le hors ligne : ce qui marchera, ce qui ne marchera pas

Ce que la tranche 1 garantit, sur le modèle des courses :

- **Dans une app déjà ouverte** (onglet, ou raccourci sur l'écran d'accueil),
  cocher, ajouter, reporter sans réseau fonctionne : la file est écrite dans le
  navigateur, survit à un onglet recyclé, repart au retour du réseau, à la
  reprise de l'onglet ou au prochain geste. Un compteur « 2 en attente » le dit.
- Une opération refusée par le serveur (liste supprimée entre-temps) est
  **signalée** et retirée de la file : elle ne tourne pas en boucle.
- Pour une tâche récurrente cochée hors ligne, la prochaine occurrence
  apparaît telle que le client l'a calculée ; le serveur confirme au retour.

Ce que la tranche 1 **ne** garantit **pas** : ouvrir l'application en mode avion
alors qu'elle n'était pas déjà chargée. Il n'y a ni service worker ni manifeste
PWA aujourd'hui. Le faire, c'est ajouter `@angular/service-worker` (paquet
officiel Angular, pas une dépendance lourde) et un manifeste, et accepter deux
contraintes : sur iPhone, seul un raccourci ajouté à l'écran d'accueil profite du
cache, et une mise à jour de l'app se propage avec un rechargement de plus. Je
propose de le traiter comme une tranche à part, **après** la tranche 3, parce
que le web push en aurait de toute façon besoin. Votre recette (« je passe en
mode avion, je coche, je repasse en ligne ») passe sans cela, à condition que
l'app soit ouverte avant de couper le réseau.

### 3.5 Ce qui mérite d'être réécrit plutôt que complété

| Élément | Verdict | Pourquoi |
|---|---|---|
| `screens/taches.ts` | **réécrire** | Deux colonnes « À faire / Terminées », un formulaire modal à sept champs, une échéance en texte libre. La forme même contredit la saisie rapide. Les puces de listes et le style restent. |
| Méthodes tâches de `foyer.store.ts` | **réécrire** | Elles écrivent des bascules dans le document entier. Elles deviennent des émetteurs d'opérations, comme les méthodes courses. Le reste du store ne bouge pas. |
| `core/tasks.ts` (ce qui est dû aujourd'hui) | **compléter** | Bon découpage, testé. Lit `due` au lieu de `planned`, apprend `grace` et les types de liste. |
| Tuile d'accueil et `f-quick-add` | **compléter** | Y brancher la barre d'action et les suggestions. |
| Liens Courses et Finances | **compléter** | Ajouter le lien retour vers le contrat et la proposition de clôture. |
| Modèle backend `models.ts`, `seed.ts` | **compléter** | Champs additifs, valeurs par défaut. |
| Migration | **écrire** (migration 9 du document) | Voir section 4. |

## 4. Migration des tâches existantes

Migration 9 du document d'état, dans `backend/src/state/migrations.ts`, avec
les garanties du mécanisme en place : sauvegarde automatique du document
d'origine dans `<données>/backups/` avant transformation, transaction,
rejouable (elle ne réagit qu'à l'ancienne forme), journal de démarrage nommant
tout ce qui n'a pas pu être converti.

| Ancien champ | Devient | Cas limite, et traitement |
|---|---|---|
| `who: 'm1'` | `who: ['m1']` | Membre inconnu → `[]`, journalisé. |
| `planned: '2026-09-05'` | `due: '2026-09-05'` | |
| `due: '05/09/2026'` (créée depuis Finances) sans `planned` | `due: '2026-09-05'` | Date lisible → convertie. |
| `due: 'avant vendredi'` sans `planned` | `due: null`, texte recopié dans `note` | **Rien n'est perdu** : le texte reste lisible sur la tâche. |
| `due: 'Aujourd'hui'` / `'Demain'` / `'Cette semaine'` sans `planned` | `due: null`, texte abandonné | Ce sont les puces par défaut, sans rapport avec une date réelle. Compte journalisé. |
| `prio` | abandonné | Chaque `high` est nommé dans le journal. (Sauf décision contraire.) |
| `done: true` | `done: true, doneAt: null, doneBy: null` | La date n'est pas connue, elle n'est pas inventée. |
| `TaskList` | `kind: 'taches', scope: 'shared', position: index` | |

Avant de déployer la version qui porte la migration :

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

Vérifier après démarrage :

```bash
journalctl -u foyer -n 50 | grep 'État'          # LXC
docker compose logs foyer | grep 'État'          # Docker
# attendu : « migration 9 appliquée (…) », puis les notes de conversion
```

Revenir en arrière : remettre le fichier `<données>/backups/state-avant-migration-v8-*.json`
en base, procédure déjà décrite dans `docs/cuisine-architecture.md`, et
redéployer la version précédente. La procédure complète sera reprise dans
`docs/taches.md` avec la tranche 1.

## 5. Point à arbitrer : les tâches datées dans l'Agenda et le flux ICS

Mon avis, en deux temps.

**Dans l'écran Calendrier : oui.** Elles y sont déjà, en lecture seule. Il manque
le tap qui ouvre la tâche et l'heure quand elle en a une. C'est peu de code, et
c'est ce que FamilyWall fait. Le calendrier reste un lecteur : il n'écrit rien
dans les tâches, et une tâche faite y apparaît barrée puis disparaît du jour.

**Dans le flux ICS : non par défaut, oui sur option.** Le flux est lu par Google
et Apple Agenda, donc par les agendas personnels et parfois professionnels. Y
verser « Sortir les poubelles » toutes les semaines pollue un agenda qui sert à
autre chose, et une tâche cochée ou reportée fait **disparaître ou bouger** un
événement que l'agenda tiers avait mémorisé, ce qui déroute. Les `VTODO` du
standard seraient la bonne réponse, mais Apple Calendrier et Google Agenda les
ignorent en lecture ICS. Je propose donc un réglage du foyer, désactivé par
défaut, « Inclure les tâches datées dans le calendrier partagé », consommé par
le flux, qui émet les tâches ouvertes comme événements (journée entière, ou à
leur heure).

J'attends votre réponse sur ces deux points avant de toucher au calendrier.

## 6. Découpage en tranches

Chaque tranche est une PR, déployable seule, avec ses tests en CI.

| Tranche | Contenu | Ce que vous vérifierez |
|---|---|---|
| **1. Socle et parité de base** | Modèle cible, migration 9, `POST /api/tasks/ops` avec journal et transaction, `PUT /api/state` qui protège `tasks`, file hors ligne persistée, sondage commun courses et tâches, écran Tâches refait autour de la saisie rapide et de sa barre d'action (membres, date et heure, liste, catégorie, note), listes typées, privées ou partagées, archivables, modèles de listes, annulation sur suppression et report, accueil branché sur les mêmes gestes, suggestions d'après l'historique de la liste. | Créer une tâche affectée à votre épouse, échéance demain 18 h, en moins de cinq secondes sans formulaire. Cocher chacun de votre côté en même temps : rien ne se décoche. Mode avion, coche, retour en ligne : la coche est là. |
| **2. Récurrence** | Les deux modes, la tolérance saisonnière, « cette occurrence ou toute la série » à la modification et à la suppression, historique des réalisations, tests du moteur et de l'occurrence suivante. | Le test de la piscine fait avec deux jours de retard : la prochaine tombe une semaine après la réalisation. |
| **3. Rappels et notifications** | D'abord une **note d'analyse** (web push VAPID face à un canal sortant vers Home Assistant, contraintes iOS, fiabilité réelle), que vous tranchez. Puis l'implémentation du canal retenu, désactivable par configuration, avec rappels d'échéance et tâches affectées, rien d'autre par défaut. | Le rappel arrive au bon moment sur le téléphone de votre épouse. |
| **4. Intégrations** | Contrat et document liés à la tâche et ouverts en un tap, clôture proposée quand la dernière ligne de courses est cochée, date proposée d'après l'emploi du temps du membre affecté, Agenda et ICS selon votre arbitrage. | Une tâche liée à un contrat mène au contrat en un tap. |
| **5. Confort** | Glisser-déposer, sous-tâches à un niveau, vue « ce qui m'est affecté ». | |
| **Optionnel : PWA** | Service worker et manifeste pour l'ouverture hors ligne à froid. À décider après la tranche 3. | |

Un mot sur les notifications, puisque c'est là que se joue la migration. Sans
préjuger de la note de la tranche 3 : le web push sur iPhone exige un raccourci
sur l'écran d'accueil, une autorisation explicite, iOS 16.4 au moins, et Safari
peut révoquer un abonnement silencieusement après une période d'inactivité. Ça
marche, mais pas assez sûrement pour qu'une tâche oubliée n'arrive jamais. Un
appel HTTP sortant du backend vers un **webhook Home Assistant** (une automation
« webhook → notify.mobile_app_… ») s'appuie sur une application native déjà en
place et sur un mécanisme que vous savez déboguer. C'est vers cette option que
je pencherai, avec le web push comme second canal possible plus tard.

## 7. Questions ouvertes

1. Le modèle de la section 3.1 vous convient-il, priorité abandonnée comprise ?
2. Concurrence par opérations ciblées (3.2) : validé ?
3. Hors ligne : la file persistée en tranche 1, la PWA plus tard et à part ?
4. Agenda et flux ICS : votre arbitrage sur la section 5.

Dès validation, la tranche 1 démarre.
