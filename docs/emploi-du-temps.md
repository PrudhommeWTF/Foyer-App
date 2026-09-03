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

  rec: 'weekly' | 'once';   // toutes les semaines, ou une seule fois
  date?: string;            // pour 'once' : la date de l'unique occurrence
  from?: string;            // validité : premier jour inclus
  until?: string | null;    // validité : dernier jour inclus
  when?: 'always' | 'school' | 'holidays';
  skip?: string[];          // occurrences annulées (l'EXDATE d'iCalendar)
  srcId?: string;           // occurrence détachée : la série dont elle vient
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
| `frontend/src/app/core/sched-copy.ts` | La copie de journée : signature, plan, application, annulation. Pur, testé dans `sched-copy.test.ts`. |
| `frontend/src/app/core/foyer.store.ts` | Les gestes : création, modification, suppression avec annulation, filtre. |
| `frontend/src/app/screens/planning.ts` | L'écran. |
| `frontend/src/app/shared/who.ts` | `f-who`, les marqueurs d'identité, partagés avec la tuile d'accueil. |
| `backend/src/state/migrations.ts` | La migration 6, qui amène les documents existants à cette forme. |

## Copier une journée

C'est le geste qui décide si le module sera tenu à jour. Nos journées se
ressemblent : ressaisir chaque créneau un par un est la raison pour laquelle
l'emploi du temps n'a jamais été complet.

### Ce qui se copie

**Ce que la vue montre.** La copie prend les créneaux du jour tels qu'ils sont
affichés, filtre compris. Copier lundi en étant filtré sur Léa copie la journée
de Léa, pas celle de tout le monde.

Le presse-papier est une photo, pas un lien : modifier l'original après l'avoir
copié ne change pas ce qui sera collé. Il ne survit pas à un rechargement de
l'application, comme n'importe quel presse-papier.

### Les deux modes

| | Effet |
|---|---|
| **Fusionner** (défaut) | Ajoute ce qui manque, ne touche à rien d'autre. Rien n'est détruit. |
| **Remplacer** | Le jour visé devient la copie du jour source : ce qu'il portait est supprimé. |

Le mode est **retenu d'une action à l'autre** plutôt que redemandé à chaque
fois. Il repart sur « fusionner » à chaque ouverture de l'application : c'est le
seul défaut acceptable, puisque c'est le seul qui ne détruit rien.

**Ce que « remplacer » supprime exactement :** les créneaux que la vue montrerait
au même endroit, c'est-à-dire ceux qui portent au moins un des membres du
collage. Sans cette règle, coller la journée de Léa sur mardi effacerait aussi
celle de tout le monde, ce que personne n'attend.

Conséquence à connaître : un créneau **partagé** (un trajet Léa et Paul) est
emporté quand on remplace la journée de Léa, et Paul le perd aussi. L'aperçu le
dit en toutes lettres, et le collage s'annule.

### Ce qui empêche les doublons

Deux créneaux sont « les mêmes » quand ils ont mêmes horaires, même intitulé,
même type et mêmes membres. Une fusion n'écrit pas ce qui est déjà là, y compris
au sein d'un même collage : coller deux fois de suite ne double jamais la
journée.

La casse et les espaces d'un intitulé ne font pas deux créneaux différents.

### Prévisualisation et annulation

L'aperçu est **obligatoire dès que la cible n'est pas vide**, parce que c'est le
seul cas où quelque chose peut se perdre. Sur un jour vide, le collage part
directement : il n'y a rien à perdre, et l'aperçu ne ferait que coûter un geste.

Après coup, un message dit ce qui vient d'être fait, exactement (« 5 créneaux
collés sur mardi, 1 remplacé »), et propose de revenir en arrière pendant
quelques secondes.

**L'annulation est chirurgicale** : elle retire les identifiants créés et remet
les créneaux retirés, un par un. Elle ne remet jamais une copie de l'emploi du
temps entier, ce qui effacerait en silence ce que l'autre appareil a écrit
entre-temps. C'est testé, y compris le cas où quelqu'un recrée à la main, pendant
les quelques secondes de l'annulation, un créneau que le collage venait de
supprimer.

### Ce que la récurrence change à la copie

- Un créneau **ponctuel** collé ailleurs prend **la date de son nouveau jour**,
  dans la semaine affichée. Sinon il resterait accroché au jour d'origine tout
  en prétendant appartenir à un autre.
- La **période de validité** et le filtre scolaire se recopient tels quels : le
  car du lundi collé sur le mardi garde « du 1er septembre au 30 juin ».
- Les **exceptions** ne se copient pas. Une date annulée du lundi n'a aucun sens
  sur le mardi ; la recopier trouerait la copie à un jour arbitraire.
- Deux créneaux de **périodes différentes ne sont pas des doublons** : « tennis
  le mardi jusqu'en juin » et « tennis le mardi toute l'année » sont deux
  choses, et les confondre ferait disparaître la seconde lors d'une fusion.
- La copie d'une semaine prend **les occurrences de la semaine affichée** : ce
  qui n'a pas lieu cette semaine-là ne se copie pas.

### Copier vers un autre membre

Le champ « Attribuer à » du collage réattribue tous les créneaux collés à un
membre, aux mêmes horaires. C'est le cas réel de deux enfants inscrits à la même
activité, ou d'une activité qu'un enfant reprend quand l'autre arrête.

Avec une réattribution, coller sur le **même** jour redevient licite : ce n'est
plus un doublon puisque la personne change.

### Copier une semaine : ce qui n'existe pas, et pourquoi

Le brief demandait « copier une semaine entière sur une autre semaine ». **Cette
action n'a pas de cible dans ce module et n'a donc pas été écrite.** L'emploi du
temps ne contient qu'**une** semaine, la semaine type ; il n'y a pas de semaine
du 12 mars à recopier sur celle du 19. Fabriquer un bouton qui n'aurait rien à
faire aurait été une coquille, exactement ce que les conventions du dépôt
interdisent.

Ce qui existe à la place, et qui répond au besoin sous-jacent : **copier la
semaine d'un membre vers un autre**. Le bouton n'apparaît que lorsqu'un filtre
par membre est actif, parce que c'est la seule situation où l'action a un sens.

Si un jour l'emploi du temps devait porter des semaines datées, ce serait un
autre objet que la semaine type, et une décision à prendre pour elle-même.

### Dupliquer un créneau

Depuis le formulaire d'un créneau, « Dupliquer » repasse en création avec les
mêmes valeurs. Rien n'est écrit tant qu'on n'enregistre pas : se raviser ne
laisse pas de copie fantôme. C'est le geste pour créer le trajet retour à partir
du trajet aller.

### Où vit le code

| Fichier | Rôle |
|---|---|
| `frontend/src/app/core/sched-copy.ts` | Le moteur : signature, plan, application, annulation, rapport. Pur, testé. |
| `frontend/src/app/core/sched-copy.test.ts` | 22 tests, dont la non-duplication en fusion et l'annulation intégrale d'un remplacement. |

Le calcul est séparé de l'écriture pour que le rapport puisse être montré avant,
comme pour la copie des repas (`meal-copy.ts`) et la génération des courses.

## Le modèle de récurrence

Trois concepts, pas plus. C'est le squelette d'iCalendar (RRULE + EXDATE +
RECURRENCE-ID) réduit à ce qu'un foyer utilise réellement.

### La vue est datée, le modèle ne l'est pas

Point à retenir, parce qu'il surprend : l'emploi du temps **ne contient qu'une
semaine**, la semaine type. Mais l'écran, lui, affiche une **semaine réelle**,
avec ses dates et ses flèches de navigation.

Il ne pouvait pas en être autrement : sans date, impossible de savoir si un
créneau est encore valide, si l'on est en vacances, ni où poser une exception ou
un créneau ponctuel. La semaine datée est donc une **lecture** du modèle, pas un
second modèle. Il n'y a toujours pas de « semaine du 12 mars » à stocker ni à
recopier.

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

### Ce que le moteur décide, dans l'ordre

`occursOn(créneau, date, calendrier)` répond oui ou non, et rien d'autre :

1. un créneau **ponctuel** n'a lieu qu'à sa date ;
2. sinon, le jour de la semaine doit correspondre ;
3. la date doit tomber dans la **période de validité** (bornes incluses) ;
4. elle ne doit pas figurer dans les **occurrences annulées** ;
5. le **filtre calendaire** doit être satisfait.

Trente lignes, testées une par une dans `schedule.test.ts`.

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

## Modifier ou supprimer une occurrence

Une série ne se modifie **jamais en entier sans qu'on l'ait demandé**. Quand un
créneau hebdomadaire déjà enregistré est ouvert, le formulaire porte un choix
« Appliquer », juste au-dessus du bouton d'enregistrement.

| Choix | Ce qui se passe |
|---|---|
| **À toute la série** (défaut) | Le créneau est réécrit. Ses exceptions sont conservées. |
| **À partir du …** | La série est **coupée en deux** : l'ancienne se ferme la veille, une nouvelle démarre ce jour-là avec les nouvelles valeurs. |
| **Ce jour seulement** | La série saute la date, et une occurrence détachée la reprend. |

La suppression pose la même question, mais **sans réponse par défaut** : c'est
elle qui détruit. Le formulaire déplie trois boutons explicites plutôt qu'une
modale par-dessus une modale, ce qui reste utilisable au doigt.

Les trois suppressions s'annulent, et l'annulation est aussi ciblée que le
geste : elle retire la date de la liste des exceptions, ou remet la borne de fin
à sa valeur d'avant, ou réinsère le créneau. Jamais une copie de l'emploi du
temps entier.

**Pourquoi la coupure plutôt qu'une modification en place.** C'est ce qui traite
un changement d'horaire à la rentrée ou un changement d'établissement sans
effacer l'historique : les semaines passées gardent l'ancien créneau, les
suivantes portent le nouveau. Quand la coupure ne laisserait rien derrière elle
(le créneau ne commençait pas avant la date visée), le créneau est simplement
modifié : produire une série vide n'aurait servi à rien.

**Le compromis assumé de l'occurrence détachée :** renommer la série ensuite ne
renomme pas l'occurrence qu'on en a détachée. C'est le comportement d'iCalendar,
et celui d'Apple Calendar comme de Google Agenda.

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

## Saisie

### Les trous de la journée, et où l'on tape pour créer

La vue en listes absorbe les chevauchements mais fait perdre le sens des **temps
libres** : on ne voit plus d'un coup d'oeil qu'il y a deux heures entre deux
créneaux. C'était le coût assumé du choix de densité, et il est en partie rendu.

Entre deux créneaux séparés d'au moins **trente minutes**, une ligne discrète dit
« 12:00 – 14:00 libre ». Elle sert deux choses à la fois : elle montre le trou, et
**taper dessus crée un créneau qui démarre à cette heure**, jour et heure déjà
remplis. C'est la réponse, dans une vue en listes, au « taper directement sur une
case horaire » d'un calendrier en grille.

Le seuil de trente minutes n'est pas décoratif : cinq minutes entre deux cours ne
sont pas du temps libre, et les afficher noierait les vrais trous. Un créneau
sans heure de fin compte comme un **instant** : le car de 7h50 n'occupe pas la
matinée sous prétexte qu'on n'a pas dit quand il arrive.

« + Ajouter », en bas de chaque journée, propose l'heure qui suit le dernier
créneau (la fin la plus tardive, pas celle du dernier commencé), ou 8h sur une
journée vide.

### Déplacer un créneau

**À la souris**, un créneau se glisse d'une journée à l'autre. Si c'est une
série, une question précède l'écriture : toute la série, ou ce jour seulement.
Un créneau ponctuel se déplace sans question et **change de date** pour celle de
son nouveau jour. Les deux s'annulent.

**Sur téléphone, il n'y a pas de glisser-déposer, et c'est délibéré.** Le tactile
n'a pas de glisser natif ; en fabriquer un revient à se battre avec le
défilement de la page, pour un geste qui rate une fois sur trois. Le même
déplacement s'y fait en ouvrant le créneau et en changeant son jour : un chemin
visible plutôt qu'un geste à deviner. Le brief autorisait explicitement cette
dégradation, à condition de doubler l'accès par un bouton visible, ce que le
formulaire fait déjà.

### Suggestions d'intitulés plutôt que modèles

Le champ « Intitulé » propose les intitulés **déjà employés dans le foyer**, les
plus fréquents d'abord, par une simple liste native.

C'est la réponse sobre aux « modèles de créneaux » du brief, écartée d'un commun
accord : une bibliothèque de modèles serait une seconde chose à créer, nommer et
tenir à jour, alors que « École », « Car scolaire » et « Cabinet » reviennent
tous les jours et sont déjà dans le document.

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

## Migration 7

`emploi du temps : récurrence et périodes de validité`

Chaque créneau reçoit `rec: 'weekly'`. Ce n'est pas un changement de
comportement : jusqu'ici un créneau n'avait pas de récurrence **parce que tout
était récurrent**, « tous les lundis, pour toujours ». La migration rend la règle
explicite, rien de plus.

Les autres champs restent absents. Ils sont facultatifs, et leur absence est déjà
leur valeur par défaut : aucune période n'est inventée.

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
[foyer] État : migration 7 appliquée (emploi du temps : récurrence et périodes de validité).
[foyer] État : document d'origine sauvegardé dans /var/lib/foyer/backups/state-avant-migration-v5-….json
```

Un message `rattaché(s) à un membre inconnu` compte des créneaux à réparer :
ouvrez-les dans l'écran Emploi du temps et attribuez-leur quelqu'un. Rien n'a été
effacé.

### Revenir en arrière

La migration est rejouable, donc un simple retour de version applicative ne
suffit pas : le document est déjà à la nouvelle forme. Pour revenir réellement,
remettez le document sauvegardé et remettez le compteur à sa valeur d'avant.

Le nom du fichier de sauvegarde porte la version de **départ** : c'est elle
qu'il faut remettre au compteur. Une base qui n'avait jamais vu ces tranches
donne `…-v5-…` (les migrations 6 et 7 se sont enchaînées) ; une base déjà passée
en tranche 1 donne `…-v6-…`.

```bash
systemctl stop foyer
DB=/var/lib/foyer/foyer.db
SAVE=$(ls -t /var/lib/foyer/backups/state-avant-migration-*.json | head -1)
VERSION=$(basename "$SAVE" | sed -E 's/.*-v([0-9]+)-.*/\1/')
echo "restauration de $SAVE, retour à la version $VERSION"

sqlite3 "$DB" "UPDATE household SET state = readfile('$SAVE') WHERE id = 1;"
sqlite3 "$DB" "UPDATE hh_meta SET value = '$VERSION' WHERE key = 'state_version';"

systemctl start foyer
```

Redéployez d'abord la version applicative précédente, sans quoi la migration se
rejouera au prochain démarrage.

## Tests

| Fichier | Ce qu'il tient |
|---|---|
| `frontend/src/app/core/schedule.test.ts` | Jours, ordre stable à heure égale, le filtre vide qui laisse tout passer, un créneau partagé qui n'apparaît qu'une fois, les marqueurs d'identité et leur débordement. Le moteur de récurrence : bornes de validité, exceptions, période scolaire, jour férié, occurrence détachée, repli quand les vacances sont inconnues. Et les trous de la journée : seuil, chevauchements, créneau sans fin, heure proposée. |
| `frontend/src/app/core/sched-copy.test.ts` | Collage sur un et plusieurs jours, non-duplication en fusion, annulation intégrale d'un remplacement, annulation qui ne piétine pas une modification concurrente, réattribution à un autre membre. |
| `backend/test/state-migrations.test.ts` | La migration 6 : conversion, membre inconnu conservé, jour illisible nommé, rejouabilité, aucun créneau perdu. |

La tuile d'accueil est vérifiée sur les deux cas qui comptent : l'école
disparaît un jour de vacances, et elle **reste affichée** quand les vacances ne
sont pas connues.

## Intégrations prévues

**Tranche 5.** L'emploi du temps sait qui est à la maison à midi et le soir :
c'est lui qui alimentera le nombre de couverts, via une interface de lecture
propre, plutôt que la grille d'absences tenue à la main dans la fiche membre
(`Member.absent`). Le module Cuisine ne lira jamais `sched` directement.

La tuile d'accueil consomme déjà le module et porte les **mêmes** marqueurs
d'identité, par le même composant `f-who` : il n'y a pas deux façons de dessiner
un membre.
