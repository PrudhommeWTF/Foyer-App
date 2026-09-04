# Tâches : modèle, écriture, hors ligne, exploitation

Ce document décrit le module Tâches tel qu'il est depuis les tranches 1 à 3
du chantier « parité FamilyWall et intégration » (l'état des lieux qui les a
précédées est dans [`taches-etat-des-lieux.md`](taches-etat-des-lieux.md)).
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
  contractId?: number | null; // contrat du module Finances (échéance, piste d'économie)
  docId?: string | null;      // document du foyer (FileItem.id)
  parentId?: string | null;   // sous-tâche : un seul niveau, dans la liste du parent
  pos?: number;               // ordre manuel, posé au glisser-déposer
  rec?; history?; remind?;    // voir « La récurrence » et « Rappels »
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
- **Une sous-tâche est un détail, pas une tâche de plus.** Elle ne compte dans
  aucun compteur, ne monte pas sur l'accueil, et ne fait pas de ligne à elle
  seule. Voir « Sous-tâches » plus bas.

## La récurrence

```ts
interface TaskRec {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  every: number;        // toutes les N unités, 1 par défaut
  days?: number[];      // hebdomadaire à date fixe : lundi = 1 … dimanche = 7
  base: 'due' | 'done'; // à date fixe, ou après la réalisation
  grace?: number;       // tolérance en jours avant d'être en retard
  until?: string | null;
}
// sur la tâche :
rec?: TaskRec | null;
history?: { at: string; by: string | null; due: string | null }[];
```

**Une tâche récurrente est une série, pas une tâche par occurrence.** Elle
porte son échéance **courante** ; la cocher inscrit une ligne dans `history`
(quand, par qui, quelle échéance) et avance `due` à l'occurrence suivante. Rien
ne s'accumule, rien n'est à purger, et l'historique est borné à 200 lignes.
Une série a toujours une échéance : la saisie en pose une (aujourd'hui) si
aucune n'est donnée.

### Les deux modes

| Mode | Règle de la suivante | Exemple |
|---|---|---|
| **À date fixe** (`base: 'due'`) | La première date de la règle **strictement après** la plus tardive des deux, échéance ou réalisation. Faite avec trois semaines de retard, les occurrences manquées ne sont **pas** rattrapées : elles ne sont plus à faire, et les accumuler serait un reproche. | Les poubelles du mardi, sorties mercredi : la prochaine est le mardi d'après. |
| **Après la réalisation** (`base: 'done'`) | Un pas de la cadence à partir du jour du geste. Les jours de la semaine n'ont pas de sens ici et sont ignorés. | Le test de la piscine, prévu samedi, fait lundi avec deux jours de retard : la prochaine tombe le lundi d'après, pas le samedi. |

Détails du calcul (`frontend/src/app/core/recurrence.ts`, testé) : le mensuel
garde le jour du mois, borné à la fin d'un mois plus court (le 31 janvier
donne le 28 février) ; l'annuel garde le jour et le mois (le 29 février donne
le 28) ; « toutes les 2 semaines » est calée sur la semaine de l'échéance
courante ; une fin de série (`until`) dépassée arrête la récurrence, la tâche
est alors faite.

**Qui calcule.** Le client, et lui seul : la coche envoie `occ` (l'échéance
soldée) et `next` (la suivante). Le serveur vérifie la forme, pas le calcul.
C'est cohérent avec le reste de l'application, et ça évite deux moteurs
identiques dans deux paquets qui ne partagent aucun code.

### La tolérance, pour le saisonnier

`grace` est un nombre de jours après l'échéance pendant lesquels l'occurrence
est encore l'affaire du jour, pas en retard. L'ouverture de la piscine « vers
le 15 avril » avec quinze jours de souplesse est due du 15 au 30 avril, et en
retard à partir du 1er mai. L'échéance s'affiche « vers le 15/04/2026 », et le
retard se compte depuis la fin de la tolérance. C'est une échéance approximative
plutôt qu'une fausse précision, sans plage à deux bornes.

### Cette occurrence, ou toute la série

À la modification comme à la suppression d'une série, la question est posée
en une ligne, une seule fois :

| Geste | Cette occurrence seulement | Toute la série |
|---|---|---|
| Modifier | Une **copie ponctuelle** (sans règle) porte la modification, et la série avance à l'occurrence suivante sans ligne d'historique (`skip`). | La série est modifiée en place (`edit`). |
| Supprimer | La série avance sans ligne d'historique (`skip`) : « passer cette occurrence ». | La série est supprimée (`remove`). |

Une occurrence retouchée n'est donc pas un troisième type d'objet : c'est une
tâche simple, détachée.

### Concurrence et annulation

- `done` porte `occ` : si l'échéance courante n'est plus celle-là, l'autre
  appareil a déjà coché cette occurrence, et la coche est **acquittée sans
  effet**. Deux téléphones ne font jamais avancer la série deux fois.
- `reopen` porte `occ` : annuler une coche ne rétablit que l'occurrence soldée
  (la dernière ligne d'historique, si c'est bien elle), et rejouée, elle ne
  remonte pas plus loin.
- Annuler un « passer cette occurrence » remet l'échéance d'avant ; annuler la
  suppression d'une série la remet avec sa règle et son historique.
- Le journal `hh_task_ops` et la transaction valent pour ces opérations comme
  pour les autres.

### Vérifier une série sans passer par l'écran

```bash
DB=/var/lib/foyer/foyer.db
sqlite3 "$DB" "SELECT json_extract(value, '$.text'), json_extract(value, '$.due'),
  json_extract(value, '$.rec'), json_array_length(value, '$.history')
  FROM household, json_each(household.state, '$.tasks') WHERE json_extract(value, '$.rec') IS NOT NULL;"
```

Aucune migration : les champs sont nouveaux et facultatifs, un document sans
eux est un document sans série.

## Les opérations

| Opération | Champs | Effet |
|---|---|---|
| `add` | `id`, `listId`, `text`, et au choix `note`, `cat`, `who`, `due`, `time`, `shopListId`, `contractId`, `docId`, `parentId`, `pos`, `rec`, `remind`, `done`, `doneAt`, `doneBy`, `history` | Crée la tâche. Une tâche déjà là sous cet `id` : acquittée, sans doublon. `done` et `history` à l'ajout servent à annuler une suppression. |
| `edit` | `id` et les champs à changer | Ne touche que les champs nommés. `who` est remplacé, jamais fusionné. `rec: null` retire la règle. |
| `done` | `id`, et sur une série `occ`, `next` | Faite. Déjà faite : acquittée, et c'est la première coche qui reste (`doneBy`). Sur une série : ligne d'historique et échéance avancée à `next` (null : la série s'arrête, la tâche est faite). |
| `skip` | `id`, `occ`, `next` | Passe l'occurrence courante d'une série sans trace. |
| `reopen` | `id`, et sur une série `occ` | Rouverte. Sur une série : rétablit l'occurrence soldée. |
| `remove` | `id` | Supprimée. |

Chaque opération porte `opId` (généré par le client), `by`, `at`. Une
opération sur une tâche disparue est **acquittée** (sans objet), pas refusée :
quelqu'un l'a supprimée pendant que l'autre était hors ligne.

Ce qui est **refusé**, avec la raison renvoyée au client et écrite au journal :
une tâche sans intitulé, une liste inconnue, une date qui n'est pas
`AAAA-MM-JJ`, une heure qui n'est pas `HH:MM`, un numéro de contrat qui n'en
est pas un, une position qui n'est pas un nombre, un parent inconnu, d'une
autre liste, déjà sous-tâche, ou qui créerait un second niveau, une opération
inconnue. Un membre inconnu dans `who` est
simplement retiré. Un lien vers une liste de courses ou un document disparus
tombe, la tâche reste.

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

## Rappels et notifications (Web Push)

Le choix du canal, ses raisons et ses limites sont dans
[`taches-notifications.md`](taches-notifications.md). Ce qui suit est ce qui
est en place, et comment l'exploiter.

### Ce qui est envoyé, et à qui

| Quoi | Quand | À qui |
|---|---|---|
| **Rappel d'échéance** | À l'heure choisie sur la tâche : à l'heure (9 h sans heure), 1 h avant, la veille à 18 h, le matin à 9 h. **Aucun rappel par défaut**, réglé tâche par tâche dans le panneau « Date » du composeur. | Les membres affectés. Une tâche sans responsable rappelle **tous les comptes** du foyer. |
| **Tâche qui m'est affectée** | Tout de suite, quand quelqu'un d'autre m'affecte une tâche (création ou modification). Pas quand je m'affecte moi-même, pas pour une tâche faite. | Le membre affecté. |

Rien d'autre : pas de « Marie a coché », pas de résumé. Une série récurrente
rappelle son occurrence courante, puis la suivante quand elle arrive. Une
tâche reportée est rappelée à nouveau ; une tâche faite ou supprimée ne l'est
plus. Les heures sont celles du foyer (Europe/Paris), quel que soit le fuseau
du serveur.

```ts
// sur la tâche
remind?: 'at' | '1h' | 'eve' | 'morning' | null;   // sans échéance, retiré
```

### Comment ça marche

1. Le navigateur enregistre un **service worker** (`sw.js`, sans cache : il
   n'affiche que les notifications) et, sur un geste dans *Paramètres →
   Notifications → « Activer les rappels sur cet appareil »*, s'abonne auprès
   du service push de son éditeur avec la clé VAPID publique du serveur.
2. L'abonnement est confié au serveur (`POST /api/push/subscribe`), rattaché
   au membre connecté, dans `hh_push_subs`. Un appareil par ligne.
3. Un **planificateur** passe toutes les minutes : il lit le document, calcule
   les rappels dus (`notify/reminders.ts`) et les envoie à chaque appareil
   des membres visés (`notify/push.ts`). Une affectation est envoyée dès que
   l'opération est appliquée.
4. Chaque envoi est journalisé dans `hh_notif_sent` par clé et par membre. La
   clé porte la tâche, son échéance et son réglage : un redémarrage ne renvoie
   rien deux fois, une tâche reportée est rappelée à nouveau. Un rappel tombé
   pendant plus de deux heures d'arrêt du service est noté **manqué**, pas
   envoyé en retard.

### Sur iPhone : ce qu'il faut faire, et ce qui casse

- Les rappels n'arrivent qu'à une application **ajoutée à l'écran d'accueil**
  (Safari, *Partager*, *Sur l'écran d'accueil*), ouverte depuis cette icône,
  sur iOS 16.4 au moins. Dans un onglet Safari, l'écran Paramètres le dit et
  ne propose pas d'activer.
- **Supprimer l'icône révoque l'abonnement.** Le serveur l'apprend au prochain
  envoi (le service push répond 404 ou 410), retire l'appareil et l'écrit au
  journal. Entre-temps, rien ne prévient.
- Le service worker **affiche toujours** une notification, même si le message
  est illisible : un message reçu sans notification affichée fait révoquer
  l'abonnement par iOS.
- Le service push d'Apple ou de Google répond « accepté » : cela veut dire
  qu'il a pris le message, pas que le téléphone l'a montré. Quand un rappel
  n'arrive pas alors que le journal dit `sent`, la cause est sur le téléphone
  (réglages de notification, mode concentration, icône supprimée) et
  l'application n'a aucun moyen de la voir. C'est la limite du canal, elle
  était connue au moment de le choisir.

### L'écran d'état

*Paramètres → Notifications* montre, pour cet appareil, où il en est
(installer d'abord, bloqué, activer, activé), **« Envoyer un test »** qui
envoie une vraie notification, mes appareils avec la date du dernier envoi
accepté ou la dernière erreur, qui du foyer reçoit les rappels, et les
derniers envois avec leur sort (envoyé, aucun appareil, échec, manqué).

### Configuration

| Variable | Rôle | Défaut |
|---|---|---|
| `FOYER_VAPID_PUBLIC`, `FOYER_VAPID_PRIVATE` | Paire VAPID. Sans elles, une paire est **générée au premier démarrage et gardée en base** (`hh_meta`). En changer invalide tous les abonnements. | générées |
| `FOYER_VAPID_SUBJECT` | Contact que le service push peut joindre en cas d'abus, `mailto:` ou `https:`. Mettez une adresse réelle. | `mailto:foyer@localhost` |
| `FOYER_PUBLIC_URL` | Adresse ouverte au tap sur une notification. Vide : la racine de l'application telle que le service worker la connaît. | vide |

HTTPS est obligatoire pour le push (le reverse-proxy le fournit). Rien ne
sort du serveur tant qu'aucun appareil n'est abonné ; les envois vont aux
services push d'Apple et de Google, avec l'intitulé de la tâche, l'échéance et
le membre. Retirer tous les appareils dans Paramètres coupe tout.

### Exploitation

```bash
# Ce que le serveur a envoyé, et ce qu'on lui a répondu
journalctl -u foyer | grep 'Notifications'

# Les appareils abonnés, et le dernier sort de chacun
sqlite3 /var/lib/foyer/foyer.db "SELECT id, member_id, substr(ua,1,40), created_at, last_ok_at, last_error FROM hh_push_subs;"

# Les derniers envois
sqlite3 /var/lib/foyer/foyer.db "SELECT sent_at, member_id, status, title, error FROM hh_notif_sent ORDER BY sent_at DESC LIMIT 20;"

# Les clés VAPID (à sauvegarder avec la base : les perdre invalide tous les abonnements)
sqlite3 /var/lib/foyer/foyer.db "SELECT key FROM hh_meta WHERE key LIKE 'vapid_%';"
```

| Ligne de journal | Sens |
|---|---|
| `Notifications : Web Push prêt (clés VAPID générées et gardées en base)` | Premier démarrage avec le canal. Au suivant : « clés VAPID existantes ». |
| `Notifications : appareil abonné pour m1 (…)` | Un téléphone vient de s'abonner. |
| `Notifications : rappel « … » (2026-09-05 18:00) → m1 : 1 appareil(s) ; me : aucun appareil abonné` | Un rappel est parti, membre par membre. « aucun appareil abonné » n'est pas une erreur, c'est un membre qui n'a jamais activé les rappels. |
| `… → m1 : échec (abonnement expiré (HTTP 410), appareil retiré)` | L'icône a été supprimée ou l'autorisation retirée : à refaire sur le téléphone. |
| `Notifications : rappel manqué pour « … »` | Le service était arrêté à l'heure du rappel. Noté, pas envoyé en retard. |
| `Notifications : affectation « … » → m1 : sent` | Quelqu'un vient d'affecter la tâche à m1. |

Le canal ne demande **aucune migration du document** : le schéma du foyer
passe en version 3 (deux tables), appliqué au démarrage, sans toucher aux
tâches.

## Sous-tâches

**Un seul niveau, dans la liste du parent.** Une sous-tâche ne peut pas en avoir
elle-même, et une tâche qui en porte ne peut pas en devenir une : le serveur
refuse les deux, avec la raison. C'est ce qui empêche l'arborescence que le
module ne veut pas, et qui rend l'écran lisible sur un téléphone.

Une sous-tâche porte un **intitulé, des membres, une coche**, et rien d'autre :
ni date, ni heure, ni récurrence, ni rappel. Le serveur les écarte si un client
les envoie, et la saisie ne les propose pas (la barre d'action perd « Date » et
« Répéter », et dit de quel parent la sous-tâche relève). Sans cette règle, un
rappel sonnerait pour une ligne que l'écran ne montre jamais seule.

Ce qui en découle :

- Le parent affiche son **avancement** (« 2/5 ») ; les sous-tâches se cochent
  là où elles sont, sous lui.
- **Cocher la dernière sous-tâche propose de clore le parent** (toast
  « Clore »), sans le cocher : même règle que la liste de courses finie.
- **Cocher un parent coche ses sous-tâches ouvertes**, en un lot annulable d'un
  geste. Les laisser ouvertes sous une ligne barrée les rendrait invisibles.
- **Sur une série, l'occurrence suivante repart avec ses cases** : cocher un
  parent qui se répète rouvre ses sous-tâches, puisqu'elles seront à refaire.
- **Supprimer un parent emporte ses sous-tâches**, en un lot dont une seule
  annulation rend tout. Côté serveur, une sous-tâche restée sans parent
  (ajoutée par un autre appareil au même moment, ou dont la liste du parent a
  été supprimée) **remonte au premier niveau** au lieu de disparaître.
- Une sous-tâche **ouverte sous un parent coché** (l'autre appareil a coché le
  parent seul) redevient une ligne à part entière : rien ne se cache sous une
  ligne barrée.

## Ordre manuel

`pos` est posé par le glisser-déposer. Il décide **là où aucune date ne
décide** : une checklist, le groupe « Sans date », et les sous-tâches d'un
parent. Ailleurs, la date et l'heure passent devant et `pos` départage. La
poignée n'apparaît donc que dans les groupes où l'ordre tient : la montrer sur
« À venir », où la date range déjà, ferait un geste sans effet.

Le glisser-déposer est écrit à la main (`frontend/src/app/shared/reorder.ts`),
sans le CDK d'Angular : cent lignes de `pointer events` contre un paquet de
plus. Deux règles y décident de tout sur téléphone :

- **On tire par une poignée, jamais par la ligne.** Seule la poignée porte
  `touch-action: none` ; la liste continue de défiler au doigt et la ligne reste
  tapable.
- **La poignée est un bouton**, et les flèches haut et bas la déplacent aussi :
  l'ordre reste réglable au clavier, et pour qui ne peut pas faire un
  glissement précis.

Un déplacement renumérote de 0 à n et n'envoie que les positions qui changent.
Deux appareils qui réordonnent en même temps ne perdent aucune tâche : le
dernier lot reçu fait foi sur les positions qu'il touche.

## La vue « À moi »

Une puce à côté de « Toutes », visible dès qu'un membre est reconnu. Elle
rassemble **ce qui m'est affecté**, dans toutes les listes que je vois (tâches,
corvées, checklists), et les **sous-tâches de mes tâches**, pour que je voie ce
qu'elles demandent. Une sous-tâche à mon nom dont le parent est à quelqu'un
d'autre y fait sa propre ligne.

Une tâche **sans responsable** n'y est pas : « le premier qui passe » n'est à
personne en particulier, et « Toutes » la montre déjà. La vue n'a pas de saisie :
elle rassemble, elle ne range pas.

## Liens avec le reste du foyer

Le principe est le même partout : une tâche liée **reste une tâche**. Elle se
coche, se déplace, se supprime comme les autres ; le lien est un raccourci vers
l'autre module et une information de plus, jamais un miroir qui la ferait
réapparaître ou bouger toute seule.

### Finances : le contrat en un tap

- Une tâche créée depuis une échéance (« Dernier jour pour résilier : Box
  internet ») ou depuis une piste d'économie porte `contractId`. Sur l'écran
  Tâches, elle montre **« Ouvrir le contrat »** : un tap ouvre l'écran Finances,
  l'onglet Contrats, la fiche du contrat (d'où « Voir ces opérations »).
- Les contrats ne vivent pas dans le document d'état mais dans leurs tables :
  le serveur vérifie la forme du numéro, pas son existence. Un contrat supprimé
  entre-temps est dit au tap (« Ce contrat n'existe plus »), la tâche reste.
- Si la date du contrat bouge après coup, la tâche **ne suit pas** : c'est une
  copie assumée, sinon une tâche qu'on a déplacée à la main reviendrait.

### Documents : un document lié, ouvert en un tap

- Dans la saisie, le bouton **« Document »** (présent dès que le foyer a des
  documents) choisit un fichier du module Documents ; la tâche porte `docId`.
  Sur un document, **« En tâche »** crée une tâche à son nom, sans date.
- Sur la tâche, un tap sur le nom du document le **télécharge** quand il a un
  fichier joint (un PDF s'ouvre dans le navigateur du téléphone) ; une fiche
  sans pièce jointe ouvre l'écran Documents, déjà filtré sur elle.
- Un document supprimé délie les tâches qui l'ouvraient, à l'enregistrement
  du document d'état (même rattrapage que les listes de courses).

### Courses : clore la tâche quand la liste est finie

Quand le **dernier article** d'une liste passe dans le panier et qu'une tâche
ouvre cette liste, un toast propose **« Clore »** la tâche. Il propose, il ne
coche pas : « tout dans le panier » n'est pas toujours « courses faites »
(il reste la caisse), et la tâche appartient au foyer. Le geste reste
annulable comme n'importe quelle coche. Un article « indisponible » n'est pas
à prendre : il ne bloque pas la proposition.

### Emploi du temps : lu, jamais écrit

Dans le panneau de la date, quand la tâche a **des membres affectés** et une
date :

- ce qu'ils ont ce jour-là (« Ce jour-là : École 08:30 à 16:30, Foot 17:00 à
  18:30 »), avec le prénom devant quand plusieurs membres sont affectés ;
- si une heure est choisie en plein créneau, un avertissement (« À cette
  heure : École 08:30 à 16:30 ») ; l'heure reste possible, c'est un avis ;
- le **jour le plus libre** des sept jours à venir, en un tap (le moins
  d'heures prises, puis le moins de créneaux, puis le plus tôt).

Sans membre affecté, rien n'est dit : « le premier qui passe » n'a pas
d'agenda. Quand tous les jours se valent, rien n'est proposé non plus. Les
vacances scolaires et fériés sont pris en compte comme dans l'écran Emploi du
temps (un créneau « hors vacances » ne compte pas pendant les vacances).
L'emploi du temps n'est **jamais modifié** par une tâche.

### Agenda et flux ICS

- Le calendrier montre les tâches datées le jour de leur échéance, avec
  l'heure ; un **tap** ouvre la tâche (écran Tâches, modale de modification).
- Le flux ICS partagé n'inclut les tâches que sur demande : *Paramètres →
  Partage du calendrier → Inclure les tâches datées* (`settings.icsTasks`,
  éteint par défaut : le flux est l'agenda de la famille). Alors chaque tâche
  **à faire et datée** devient un `VEVENT` `Tâche : <intitulé>` (journée
  entière, ou une heure à partir de l'heure choisie), catégorie `Tâche`, avec
  la liste, les membres et la note en description. L'UID `task-<id>@foyer`
  est stable : quand une coche fait avancer une série, l'agenda **déplace**
  l'entrée. Une tâche faite disparaît du flux. Une série n'y met que son
  occurrence courante, sans `RRULE` : une règle iCalendar dirait autre chose
  que l'application (tolérance, base sur la réalisation).

Vérifier le flux depuis le serveur, sans agenda :

```sh
TOKEN=…   # le jeton du lien affiché dans Paramètres
curl -s "http://localhost:3000/api/calendar/feed.ics?token=$TOKEN" | grep -c '^SUMMARY:Tâche :'
```

## Où vit le code

| Fichier | Rôle |
|---|---|
| `backend/src/tasks/ops.ts` | Le moteur d'opérations, pur : validation, idempotence, rattrapage après édition des listes et des membres. |
| `backend/src/tasks/repo.ts` | La transaction SQLite, le journal `hh_task_ops`, et `preserveTasks` qui protège le `PUT`. |
| `backend/src/tasks/routes.ts` | `POST /api/tasks/ops`. |
| `backend/src/state/doc.ts` | Lecture et écriture brutes du document, partagées avec les courses. |
| `backend/src/server.ts` | `GET /api/live`, et l'appel de `preserveTasks` dans `PUT /api/state`. |
| `backend/src/state/migrations.ts` | Migration 9. |
| `backend/src/notify/reminders.ts` | Quand une tâche rappelle et à qui, en heure murale du foyer : pur, testé. |
| `backend/src/notify/push.ts` | Clés VAPID, appareils, envoi idempotent, journal, appareils morts retirés. |
| `backend/src/notify/scheduler.ts` | Le passage à la minute. |
| `backend/src/notify/routes.ts` | `/api/push` : état, abonnement, test. |
| `frontend/public/sw.js`, `manifest.webmanifest` | Le service worker (notifications seulement) et le manifeste d'installation. |
| `frontend/src/app/core/task-ops.ts` | Application locale d'une opération, et son inverse pour « Annuler ». |
| `frontend/src/app/core/tasks.ts` | Ce qui se voit et dans quel ordre, la tolérance, les suggestions, les dates d'un tap, l'imbrication des sous-tâches, l'ordre manuel, ce qui m'est affecté. |
| `frontend/src/app/core/recurrence.ts` | Le moteur de récurrence : l'occurrence suivante dans les deux modes, le saut d'occurrence, la fenêtre de tolérance, le libellé de la règle. |
| `frontend/src/app/core/availability.ts` | La disponibilité lue dans l'emploi du temps : créneaux du jour, conflit à une heure, jour le plus libre. Pur, lecture seule. |
| `frontend/src/app/shared/reorder.ts` | Le glisser-déposer, à la poignée, au doigt comme au clavier. Sans dépendance. |
| `frontend/src/app/core/links.ts` | Les intitulés déposés entre modules, et la tâche à proposer de clore quand la liste de courses est finie. |
| `backend/src/ics.ts` | Le flux ICS, dont les tâches datées quand `settings.icsTasks` est activé. |
| `frontend/src/app/core/foyer.store.ts` | La file, le sondage commun, les gestes, les listes et les modèles, les liens (document, tâche depuis un document, clôture proposée depuis les courses). |
| `frontend/src/app/core/finances.store.ts` | `taskFromDeadline`, `taskFromSaving` (la tâche porte le contrat) et `openContract` (le contrat en un tap). |
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
| `backend/test/tasks-ops.test.ts` | Le moteur : une coche posée deux fois reste une coche et garde le premier auteur, deux appareils partis du même état gardent chacun leur travail, une modification ne décoche pas, rejeu après coupure, ajout rejoué sans doublon, opération sans objet acquittée, refus avec raison sans faire tomber le lot, bornes, rattrapage après suppression d'une liste, d'un membre, d'une liste de courses, d'un document. Les séries : deux appareils qui cochent la même occurrence ne la font avancer qu'une fois, réouverture qui rétablit l'occurrence sans remonter deux fois, saut, fin de série, règle bornée, historique borné. Les liens : contrat lié, délié, refusé s'il est illisible ; document inconnu qui tombe sans faire échouer ; suppression annulée qui rend les liens. |
| `backend/test/ics.test.ts` | Le flux : rien sans le réglage, journée entière ou créneau d'une heure, identifiant stable, une tâche faite ou sans date absente, une série sans `RRULE` et une seule fois, échappement. |
| `backend/test/tasks-ops.test.ts` (sous-tâches et ordre) | Un seul niveau tenu des deux côtés, parent inconnu ou d'une autre liste refusé avec la raison, date et rappel écartés d'une sous-tâche, promotion au premier niveau à la suppression du parent et au rattrapage, position bornée et arrondie, deux appareils qui réordonnent sans rien perdre. |
| `backend/test/tasks-repo.test.ts` | La couture avec la base : version qui n'avance pas pour rien, journal qui survit, deux téléphones sur la même tâche, et un `PUT` périmé qui ne peut ni décocher ni ressusciter. |
| `backend/test/state-migrations.test.ts` | La migration 9 : chaque conversion, ce qui est nommé au journal, la rejouabilité, aucune tâche perdue. |
| `backend/test/reminders.test.ts` | L'heure du rappel dans les quatre réglages, sans heure, à cheval sur minuit, l'heure murale du foyer été comme hiver, la fenêtre de rattrapage, les destinataires, la clé d'idempotence, les affectations. |
| `backend/test/push.test.ts` | Clés gardées, abonnements sans doublon, envoi à tous les appareils et une seule fois par clé, « aucun appareil » visible, appareil mort retiré et panne passagère gardée, planificateur qui envoie, note les manqués et ne recommence pas, affectation signalée avec son opération. |
| `frontend/src/app/core/task-ops.test.ts` | L'application locale sans bascule, l'inverse exact de chaque opération pour « Annuler », y compris sur une série (occurrence rétablie, saut annulé, suppression annulée avec règle et historique). |
| `frontend/src/app/core/recurrence.test.ts` | Les deux modes : la piscine faite en retard qui repart de la réalisation, les poubelles du mardi qui ne rattrapent pas, toutes les N semaines sur certains jours, le mensuel borné, le 29 février, la fin de série, la tolérance, les libellés. |
| `frontend/src/app/core/tasks.test.ts` | Le compteur et la relégation de l'accueil, ce qui se voit selon le type et la portée des listes, l'ordre des groupes, les suggestions, les catégories, les dates d'un tap, la lecture de l'échéance. |
| `frontend/src/app/core/availability.test.ts` | Rien sans membre affecté, les créneaux du jour des membres affectés, le conflit à une heure (fin de créneau et créneau sans fin exclus), le jour le plus libre, rien quand tous se valent. |
| `frontend/src/app/core/links.test.ts` | La clôture proposée seulement quand plus rien n'est à prendre, sur la bonne liste, jamais sur une liste vide ni une tâche faite. |
| `frontend/src/app/core/tasks.test.ts` (tranche 5) | Les sous-tâches sous leur parent et dans leur ordre, celle qui reste ouverte sous un parent coché, celle dont le parent n'est pas là, les compteurs qui ne comptent pas les détails, l'ordre manuel là où il décide et là où il départage, `reorder` sur des indices absurdes. |
| `frontend/src/app/core/tiles/tiles.test.ts` | La tuile d'accueil : trois vides différents, compteur sur le jour seulement. |

Tous tournent en CI (`npm test` dans `backend/` et dans `frontend/`).

## Ce qui reste à faire

Le chantier de parité et d'intégration est terminé. Reste, hors tranche, le
chargement **hors ligne à froid** (cache PWA) : aujourd'hui, les gestes faits
sans réseau repartent au retour, mais l'application doit avoir été ouverte
avant. C'est un choix à faire séparément, parce qu'un cache d'application
change la façon dont les mises à jour arrivent.
