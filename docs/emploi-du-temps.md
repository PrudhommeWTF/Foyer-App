# Emploi du temps : modèle, récurrence, exploitation

Ce document porte les décisions de fond du module Emploi du temps. Il existe
parce que ces choix se prennent une fois et se relisent des mois plus tard, quand
il faut décider si une demande nouvelle entre dans le modèle ou le casse.

Le module décrit le **rythme récurrent de la semaine**. Il ne remplace pas
l'Agenda, qui gère les événements ponctuels et datés. Ce sont deux objets
différents, et ils le restent : pas de fusion des vues, pas de sortie de
l'emploi du temps dans le flux ICS, pas de conversion d'un créneau en événement
de calendrier.

## Le principe qui commande tout le reste

Un emploi du temps de foyer **n'est pas quatre agendas côte à côte**. C'est un
agenda partagé où chaque créneau porte une ou plusieurs personnes.

La messe du dimanche, un trajet en voiture, un repas de famille concernent tout
le monde : ils font **une ligne**, pas quatre. Le modèle précédent rattachait
chaque créneau à un membre unique, ce qui obligeait à saisir, modifier et
supprimer quatre fois la même chose.

Deuxième règle, qui en découle : **aucune sélection veut dire tout le foyer,
jamais rien.** Le filtre par membre est un affinage, pas un prérequis à
l'affichage. Un écran qui paraît vide parce qu'un filtre est resté actif est un
bug, pas une fonctionnalité.

## Le modèle de données

Un créneau, dans `HouseholdState.sched` :

```ts
export interface SchedSlot {
  id: string;
  who: string[];      // membres concernés ; liste vide = « sans membre »
  dow: number;        // jour de la semaine, lundi = 1, dimanche = 7
  start: string;      // 'HH:MM'
  end: string;        // 'HH:MM', ou '' quand la fin n'est pas connue
  label: string;
  k: SchedType;       // ecole | travail | sport | loisir | sante | repas | autre
}
```

### Pourquoi `who` est une liste

Voir le principe ci-dessus. Une **liste vide est licite** : c'est ce que
deviennent les créneaux dont le membre a été supprimé. Ils restent visibles,
marqués « sans membre », et l'écran les signale en tête. Les effacer avec leur
membre aurait été une perte muette, et les cacher les aurait rendus
irréparables, puisqu'on ne peut pas sélectionner un membre qui n'existe plus.

Le formulaire, lui, **exige au moins un membre** pour enregistrer. C'est ce qui
force la reprise d'un créneau orphelin : le rouvrir demande de lui attribuer
quelqu'un.

### Pourquoi `dow` est un numéro

Le reste de l'application compte déjà en lundi = 1 (`weekdayOf`, et la semaine
type des repas dans `presence.ts`). Le champ portait auparavant le nom français
du jour, une chaîne à traduire à chaque calcul de date. Contrepartie assumée :
le JSON du document est légèrement moins lisible à l'oeil nu.

### Où vit la logique

| Fichier | Rôle |
|---|---|
| `frontend/src/app/core/schedule.ts` | Le moteur : tri, jour d'une date, filtre par membre, marqueurs d'identité. Pur, testé dans `schedule.test.ts`. |
| `frontend/src/app/core/foyer.store.ts` | Les gestes : création, modification, suppression avec annulation, filtre. |
| `frontend/src/app/screens/planning.ts` | L'écran. |
| `frontend/src/app/shared/who.ts` | `f-who`, les marqueurs d'identité, partagés avec la tuile d'accueil. |
| `backend/src/state/migrations.ts` | La migration 6, qui amène les documents existants à cette forme. |

## Le modèle de récurrence retenu

**Livré en tranche 3.** Le modèle est arrêté, il est écrit ici pour que la
tranche s'y conforme et pour que le choix ne se rediscute pas.

Trois concepts, pas plus. C'est le squelette d'iCalendar (RRULE + EXDATE +
RECURRENCE-ID) réduit à ce qu'un foyer utilise réellement.

```ts
  rec: 'weekly' | 'once';   // toutes les semaines, ou une seule fois
  date?: string;            // pour 'once' : la date ISO de l'occurrence
  from?: string;            // validité : premier jour inclus
  until?: string | null;    // validité : dernier jour inclus
  when?: 'always' | 'school' | 'holidays';
  skip?: string[];          // occurrences annulées (l'EXDATE d'iCalendar)
  srcId?: string;           // occurrence détachée : la série dont elle vient
```

### Pourquoi pas de bibliothèque

`rrule.js` sait exprimer « le troisième mardi ouvré des mois pairs ». Le besoin
réel est « toutes les semaines, du 1er septembre au 30 juin, sauf pendant les
vacances ». La bibliothèque coûterait une quarantaine de kilo-octets, un modèle
de données imposé et un format de chaîne à parser, pour un moteur qui tient en
une trentaine de lignes testables.

### Pourquoi la période de validité est indispensable

Sans elle, l'emploi du temps de l'an dernier pollue celui de cette année. Les
activités des enfants démarrent en septembre, s'arrêtent en juin et changent
d'horaire d'une rentrée à l'autre ; un enfant change d'établissement. Tout cela
se traite en **fermant des créneaux à une date et en en ouvrant d'autres**, sans
effacer l'historique.

### « Cette fois seulement » ne crée pas un troisième type d'objet

Déplacer ou modifier une occupation ponctuellement ajoute la date au `skip` de
la série, et crée un créneau `rec: 'once'` portant la modification, relié à la
série par `srcId`.

L'affichage n'a donc qu'une seule sorte de chose à dessiner, et il n'y a pas de
fusion d'exceptions à écrire. C'est le comportement d'iCalendar, exprimé avec
les objets qu'on a déjà. Contrepartie assumée, la même que dans Apple Calendar
ou Google Agenda : renommer la série ensuite ne renomme pas l'occurrence
détachée.

### Vacances scolaires et jours fériés

Les deux sources existent et ne changent pas : `GET /api/calendar/school-holidays`
interroge `data.education.gouv.fr` selon l'académie du foyer, avec cache serveur,
et `frenchHolidays()` calcule les fériés localement. Aucune liste de dates en dur.

`when: 'school'` veut dire hors vacances de l'académie **et** hors jour férié.
`when: 'holidays'` : l'inverse. Par défaut `'always'`, ce qui convient à un
adulte qui travaille certains fériés.

**Décision de repli, et elle compte :** quand les vacances scolaires ne sont pas
connues (pas de réseau, service en panne, académie non renseignée), le filtre
**n'est pas appliqué** et les créneaux s'affichent, avec une mention discrète en
tête de vue. Cacher l'école à 7h50 parce qu'une API est tombée est une faute bien
pire que d'afficher un créneau en trop un jour de vacances.

## Densité d'affichage

**Vue jour sur téléphone, vue semaine sur tablette et grand écran**, au seuil
`narrow` existant (860 px). Et dans les deux cas, **des listes triées par heure,
pas une grille horaire proportionnelle.**

Une grille où la hauteur vaut la durée demande treize à quatorze heures de
hauteur pour rester lisible, impose un défilement permanent, et gère les
chevauchements en rétrécissant les colonnes. Avec quatre membres et trois
créneaux à 18h, on obtient des bandes de trois millimètres de large : c'est
précisément le cas le plus fréquent du foyer.

Une liste absorbe les chevauchements sans rien faire : deux créneaux à 18h sont
deux lignes, toutes deux lisibles. **Ce qu'on y perd, et c'est assumé :** le sens
visuel de la durée et des trous de la journée.

L'ordre est stable à heure égale (fin la plus tôt, puis intitulé) : sans cela,
deux enfants qui partent à 7h50 changeraient de place d'un rendu à l'autre.

## Marqueurs d'identité

Pastille de la couleur du membre **et** ses initiales, jamais la couleur seule :
deux teintes proches se confondent pour qui les distingue mal, et se confondent
pour tout le monde sur un écran en plein soleil.

Au-delà de trois membres, le débordement est **compté** (« +1 ») plutôt que
dessiné, pour qu'une ligne de créneau reste une ligne sur un téléphone. Les noms
au complet restent accessibles au survol.

Les couleurs viennent des **membres du foyer** (`Member.color`), source unique.
Le type du créneau garde sa propre couleur, sur le liseré et sur son étiquette :
la couleur dit *quoi*, la pastille dit *qui*.

Si la place manque sur une ligne, c'est **l'heure** qui se coupe, jamais le
marqueur d'identité.

## Concurrence

Le module reste sur `GET/PUT /api/state`. À deux sur l'application, la protection
est celle du document entier : le serveur refuse une écriture partie d'une
version périmée, et le store **rejoue** ses modifications sur la version du
serveur (voir `state-sync.ts`).

Conséquence pratique pour tout ce qui s'annule dans ce module : **une annulation
ne restaure jamais une copie de `sched` en bloc**. Elle réinsère le créneau
retenu par son identifiant, ou retire ceux qu'elle a créés. Une remise en bloc
effacerait ce que l'autre appareil a ajouté entre-temps, en silence. La règle
vaut pour la suppression d'un créneau, et vaudra pour le collage de journée.

## Migration 6

`emploi du temps : créneaux à plusieurs membres, jour numéroté`

Elle transforme chaque créneau du document :

- `who: 'm1'` devient `who: ['m1']` ;
- `day: 'Mardi'` devient `dow: 2`, et la clé `day` disparaît.

Trois cas de reprise, tous **signalés au journal, aucun silencieux** :

| Cas | Traitement |
|---|---|
| `who` désigne un membre qui n'existe pas | `who: []`. Le créneau est conservé, l'écran le signale « sans membre ». |
| `day` illisible (retouche à la main) | Placé au lundi, et **nommé** dans le journal pour être retrouvé. |
| Créneau déjà à la nouvelle forme | Laissé tel quel. |

Le cas du membre inconnu n'est pas théorique : le filtre de l'ancien écran
s'initialisait sur `lea`, un identifiant venu de la maquette de design qui
n'existe dans aucun foyer réel, et les créneaux créés depuis cet état lui étaient
attribués.

Vérifier avant migration ce que porte votre base :

```bash
sqlite3 /var/lib/foyer/foyer.db "SELECT state FROM household WHERE id=1;" \
  | jq -r '[.sched[].who] | group_by(.) | map({who: .[0], n: length})'
sqlite3 /var/lib/foyer/foyer.db "SELECT state FROM household WHERE id=1;" \
  | jq -r '[.members[] | {id, name}]'
```

### Sauvegarde avant migration

À faire une fois, avant de déployer la tranche sur une base qui contient déjà des
créneaux.

```bash
# LXC natif : arrêt bref, archive complète du dossier de données
systemctl stop foyer
tar czf /root/foyer-avant-edt-$(date +%F).tar.gz -C /var/lib foyer
systemctl start foyer

# Docker : instantané cohérent sans arrêt de service
docker compose exec -T foyer sqlite3 /data/foyer.db ".backup '/data/avant-edt.db'"
docker compose cp foyer:/data ./foyer-data-$(date +%F)
```

La migration écrit **elle-même** une copie du document d'origine dans
`<données>/backups/` avant la première transformation en attente. C'est ce
fichier que la restauration remet en place.

### Vérifier que la migration s'est bien passée

```bash
# LXC
journalctl -u foyer -n 50 --no-pager | grep '\[foyer\] État'

# Docker
docker compose logs --tail=50 foyer | grep '\[foyer\] État'
```

Sortie attendue :

```
[foyer] État : migration 6 appliquée (emploi du temps : créneaux à plusieurs membres, jour numéroté).
[foyer] État : document d'origine sauvegardé dans /var/lib/foyer/backups/state-avant-migration-v5-….json
```

Un message `rattaché(s) à un membre inconnu` compte des créneaux à réparer :
ouvrez-les dans l'écran Emploi du temps et attribuez-leur quelqu'un. Rien n'a été
effacé.

### Revenir en arrière

La migration est rejouable, donc un simple retour de version applicative ne
suffit pas : le document est déjà à la nouvelle forme. Pour revenir réellement,
remettez le document sauvegardé et remettez le compteur à sa valeur d'avant.

```bash
systemctl stop foyer
DB=/var/lib/foyer/foyer.db
SAVE=/var/lib/foyer/backups/state-avant-migration-v5-XXXX.json   # celui du journal

sqlite3 "$DB" "UPDATE household SET state = readfile('$SAVE') WHERE id = 1;"
sqlite3 "$DB" "UPDATE hh_meta SET value = '5' WHERE key = 'state_version';"

systemctl start foyer
```

Redéployez d'abord la version applicative précédente, sans quoi la migration se
rejouera au prochain démarrage.

## Tests

| Fichier | Ce qu'il tient |
|---|---|
| `frontend/src/app/core/schedule.test.ts` | Jours, ordre stable à heure égale, le filtre vide qui laisse tout passer, un créneau partagé qui n'apparaît qu'une fois, les marqueurs d'identité et leur débordement. |
| `backend/test/state-migrations.test.ts` | La migration 6 : conversion, membre inconnu conservé, jour illisible nommé, rejouabilité, aucun créneau perdu. |

Les tests du moteur de récurrence, des exceptions, des périodes de validité et
des opérations de copie s'ajouteront à `schedule.test.ts` et à un futur
`sched-copy.test.ts` au fil des tranches.

## Intégrations prévues

**Tranche 5.** L'emploi du temps sait qui est à la maison à midi et le soir :
c'est lui qui alimentera le nombre de couverts, via une interface de lecture
propre, plutôt que la grille d'absences tenue à la main dans la fiche membre
(`Member.absent`). Le module Cuisine ne lira jamais `sched` directement.

La tuile d'accueil consomme déjà le module et porte les **mêmes** marqueurs
d'identité, par le même composant `f-who` : il n'y a pas deux façons de dessiner
un membre.
