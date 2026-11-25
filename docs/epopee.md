# Épopée

Les écus que les enfants gagnent par leurs efforts : une besace par enfant, des routines pas à pas, des récompenses choisies avec les parents. Le module s'inspire des programmes d'entraînement aux habiletés parentales (renforcement positif immédiat, économie de jetons), en particulier des travaux de Russell Barkley. Foyer n'est pas un dispositif médical : il ne pose ni ne stocke aucun diagnostic, et ses réglages portent des noms d'usage (« une consigne à la fois », « sablier »), pas des noms cliniques.

## Où en est le module

**Étape 3 sur 6 : l'espace des parents.** Une besace par enfant, les routines pas à pas, et de quoi les régler et créditer d'un geste.

| Fait | Pas encore |
|---|---|
| Enrôler un enfant : sa besace commence avec 5 écus d'amorce | L'Armurerie : récompenses, quêtes, pacte, souvenirs |
| Routines du matin et du soir, une consigne à la fois, avec sablier et pause « grain de sable » | Le parcours d'alliance et le parchemin à imprimer |
| Régler une routine : nom, heure, étapes (consigne, pictogramme, durée, écus), ordre | Le bilan de la semaine pour le conseil de famille |
| Exploits convenus : crédit d'un geste par un parent, avec cinq secondes pour annuler | Une notification au parent quand un enfant signale un exploit |
| L'enfant signale un exploit ; un parent valide ou répond « pas tout à fait » | Créer une routine de plus que le matin et le soir |
| Bravo spontané, journal, annulation de toute écriture | |
| Réglages par enfant : pièces sans le nombre, routines sans sablier | |

Hors du plan pour l'instant : le retrait d'écus (« coût de la réponse »), les outils d'assistant, le gain d'écus par une tâche cochée.

## Une routine, à l'usage

L'enfant ouvre « Mon épopée », touche « Commencer » sur la routine du matin ou du soir, et elle se déroule en plein écran :

- **Une seule consigne à la fois** : un pictogramme, un titre, une phrase. Les points en haut montrent le chemin.
- **Le sablier est un repère, pas une échéance.** Il se vide en tons ambrés, jamais en rouge. Arrivé au bout, il dit « Prends ton temps » : l'écu de l'étape reste acquis, quelle que soit la durée. Il se calcule sur l'horloge, une tablette qui s'endort ne le fausse pas.
- **« C'est fait ! »** verse l'écu tout de suite : une pièce, un son court (synthétisé, aucun fichier), une vibration là où l'appareil le permet (pas sur iPad ni iPhone, Safari ne le propose pas). Le son se coupe par appareil, avec la cloche en haut à droite. Les animations respectent le réglage « réduire les animations » du système.
- **« Un grain de sable ? »** arrête le sablier et propose de respirer (inspirer 4 s, garder 2 s, souffler 4 s). On reprend quand on veut, ou on passe l'étape pour aujourd'hui : ni écu, ni reproche. Les pauses sont comptées pour les parents, jamais pénalisées.
- **Sans réseau**, l'étape est fêtée de la même façon et attend sur l'appareil (file `foyer.epopeeQueue.<membre>`) ; elle part au retour du réseau, et jusqu'au lendemain. Limite : il faut du réseau pour **ouvrir** l'écran (la besace et les routines du jour ne sont pas gardées sur l'appareil) ; c'est une routine déjà commencée qui survit à une coupure.

Les routines viennent d'un **gabarit** (`backend/config/epopee/routines.json` : matin et soir, cinq étapes d'un écu chacune), posé à l'enrôlement. Un foyer le remplace par un fichier au même chemin dans `FOYER_DATA_DIR` (`epopee/routines.json`) ; il ne vaut que pour les enfants enrôlés ensuite. Avec dix écus possibles par jour, le prix des récompenses (à venir) devra en tenir compte.

Un adulte voit, pour chaque enfant, où en sont les routines du jour et le nombre de pauses. Il ne déroule pas la routine à sa place depuis l'écran (l'API le permet, pour plus tard).

## L'espace des parents

- **Répondre à un exploit signalé.** L'enfant touche « C'est fait ! » sur un exploit convenu : rien n'est versé, la demande attend en tête de sa carte chez le parent. « Valider » verse l'écu ; « Pas tout à fait » ne retire rien, et l'enfant peut réessayer. Un même exploit ne se signale pas deux fois tant qu'il attend. Il n'y a pas encore de notification : la demande se voit en ouvrant l'écran.
- **Créditer un exploit.** Un tap sur un exploit convenu le verse aussitôt, au montant convenu. Pas de confirmation avant : le message propose « Annuler » pendant cinq secondes (c'est une contre-écriture, les deux lignes restent au journal). Le bravo spontané suit la même règle.
- **Régler une routine.** « Régler » ouvre son nom, son heure et ses étapes : consigne, phrase, pictogramme, durée du sablier en minutes, écus (0 à 3), ordre, ajout et retrait (12 étapes au plus). Rien ne part avant « Enregistrer ». Une étape retirée garde ses coches passées ; régler une routine ne touche jamais à la besace. « Revenir aux routines proposées » remplace les routines de l'enfant par celles du gabarit.
- **Réglages de l'enfant.** « Montrer les pièces sans le nombre » : la besace n'affiche que des pièces, plus grosses, pour un enfant qui ne lit pas encore les nombres. « Sablier dans les routines » : coupé, les étapes s'enchaînent sans décompte. La carte rappelle le nombre d'écus possibles par jour avec les routines telles qu'elles sont réglées.
- **Exploits convenus** (communs au foyer) : les ajouter, changer leur valeur (1 à 3 écus), les retirer. Des exploits proposés viennent du gabarit (clé `exploits` du même fichier) au premier enrôlement. Retirer un exploit referme les demandes qui l'attendaient ; les écus déjà gagnés restent.

## Les règles

Elles sont dans `backend/src/epopee/rules.ts`, pures et testées. Le serveur les applique avant chaque écriture ; l'appareil ne décide d'aucun montant.

- **La besace ne commence jamais vide.** L'enrôlement verse 5 écus d'amorce, une seule fois. Ils forment le **plancher** de la besace : ils ne se reprennent pas.
- **Rien ne s'efface.** Le solde est la somme d'un grand livre en ajout seul. Annuler un bravo, c'est écrire sa contre-écriture ; les deux lignes restent.
- **Une écriture ne s'annule qu'une fois**, une annulation ne s'annule pas, et reprendre des écus ne fait jamais passer la besace sous son plancher (quand l'Armurerie existera : un bravo déjà dépensé ne se reprend plus).
- **Un bravo vaut 1, 2 ou 3 écus.** Le geste porte un identifiant donné par l'appareil : reçu deux fois, il ne compte qu'une fois.
- **Une étape ne se note qu'une fois par jour** (faite ou passée), et son écu n'est versé qu'une fois : l'identifiant de l'écriture se déduit de l'étape et du jour. L'appareil annonce aujourd'hui ou hier (heure de Paris), rien d'autre.
- **Reprendre l'écu d'une étape** (un adulte, depuis le journal) ne rouvre pas l'étape : elle reste notée pour ce jour.
- **Un exploit convenu se verse à son montant**, jamais à celui qu'annonce l'appareil. La demande d'un enfant validée est versée sous l'identifiant de la demande : une seule fois, quoi que fassent deux parents.
- **Retirer un enfant** de l'Épopée ne supprime rien : réenrôlé, il retrouve sa besace telle quelle, sans seconde amorce.

Décision à venir avec l'Armurerie, déjà arrêtée : le plancher ne protège que des retraits. Échanger un trésor dépense son coût entier, et chaque nouvelle quête repart avec une amorce.

## Ce que Foyer retient

Tables relationnelles `epo_*` dans `foyer.db` (donc dans les sauvegardes), hors du document du foyer :

| Table | Contenu |
|---|---|
| `epo_profiles` | un enfant enrôlé : son plancher, la date, l'adulte qui l'a enrôlé, la date de retrait s'il a été retiré, ses réglages (affichage de la besace, sablier) |
| `epo_ledger` | le grand livre : identifiant, enfant, genre (`amorce`, `bravo`, `etape`, `exploit`, `annulation`), montant, quelques mots, écriture annulée (`ref`), auteur, instant |
| `epo_routines`, `epo_steps` | les routines d'un enfant (matin, soir, heure prévue) et leurs étapes (titre, phrase, pictogramme, durée du sablier, écus) |
| `epo_step_marks` | une étape un jour donné : faite ou passée, par qui |
| `epo_exploits` | les exploits convenus du foyer : titre, écus, ordre |
| `epo_requests` | un exploit signalé par un enfant : en attente, validé, ou « pas tout à fait », et par qui |
| `epo_routine_days` | le déroulé d'une routine un jour donné : début, fin, nombre de pauses |

## Qui a le droit de quoi

| | Enfant | Adulte |
|---|---|---|
| sa besace, son journal, ses routines | lire (sans les écritures annulées à l'écran) | sans objet : seul un membre marqué enfant a une besace |
| noter une étape de ses routines, faire une pause | oui, pour lui seul | oui, pour n'importe quel enfant |
| ceux d'un autre enfant | refusé (403) | lire |
| signaler un exploit convenu | oui, pour lui seul | non : un adulte crédite directement |
| enrôler, retirer, régler (routines, exploits, affichage), créditer, répondre à une demande, annuler | refusé (403) | oui |

Un jeton d'accès (assistant, script) n'entre pas dans l'API du module. L'écran figure au menu d'un enfant (`ECRANS_ENFANT`), sous « Mon épopée » à l'accueil.

## API

Sous `/api/epopee`, session de navigateur, membre du foyer, module activé (`modEpopee`).

| Route | Effet |
|---|---|
| `GET /membres` | les enfants du foyer et leur besace (`enrolled`, `floor`, `balance`) : tous pour un adulte, soi pour un enfant |
| `GET /membres/:id` | la besace d'un enfant, le jour (`day`, heure de Paris), ses routines avec l'état de chaque étape ce jour-là, ses demandes (en attente, ou tranchées ce jour), ses réglages (`display`, `timer`), et les 50 dernières écritures de son journal (`cancelled` marque une écriture annulée) |
| `POST /membres/:id/enrolement` | enrôler (adultes). 201 quand l'amorce est versée, 200 ensuite. 400 si le membre n'est pas un enfant |
| `DELETE /membres/:id/enrolement` | retirer de l'Épopée (adultes) ; rien n'est supprimé |
| `POST /membres/:id/bravos` | `{ id (uuid), ecus (1 à 3), note (120 caractères au plus) }` (adultes). 201 à la première réception, 200 et `duplicate: true` ensuite. 409 si l'enfant n'est pas enrôlé |
| `PATCH /membres/:id/reglages` | `{ display: "nombre" ou "pieces", timer }` (adultes) ; un réglage absent ne bouge pas |
| `POST /membres/:id/routines/gabarit` | poser les routines du gabarit à un enfant qui n'en a aucune ; avec `{ replace: true }`, remplacer les siennes (adultes) |
| `PUT /routines/:id` | régler une routine (adultes) : `title`, `time` (HH:MM), `steps` dans l'ordre (`id` pour une étape existante, `title`, `hint`, `icon`, `seconds`, `ecus`). Une étape absente est archivée. La première faute est nommée |
| `GET /exploits` | les exploits convenus (tout membre) |
| `POST /exploits`, `PUT /exploits/:id`, `DELETE /exploits/:id` | ajouter, régler (`title`, `ecus` de 1 à 3), retirer un exploit (adultes) |
| `POST /membres/:id/exploits` | crédit express (adultes) : `{ id (uuid), exploitId }`. 201, puis 200 et `duplicate: true` |
| `POST /membres/:id/demandes` | l'enfant signale un exploit : `{ id (uuid), exploitId }`. 200 et `duplicate: true` si cet exploit attend déjà |
| `POST /demandes/:id/decision` | `{ accept }` (adultes). 409 si la demande a déjà sa réponse |
| `POST /etapes/:id` | `{ status: "fait" ou "saute", day (aujourd'hui par défaut, ou hier) }`. 201 à la première réception, 200 et `duplicate: true` ensuite. Rend `ecus`, `balance`, `routineDone` |
| `POST /routines/:id/pauses` | une pause « grain de sable » de plus dans la routine du jour |
| `POST /journal/:id/annulation` | annuler une écriture (adultes). 409 avec la raison quand la règle le refuse |

Chaque geste est journalisé (« Épopée : bravo de Nolwenn à Raphaël, +2 écus (« Table mise sans rappel »). »).

## Module éteint, remise à zéro

Désactivé (`modEpopee`), l'écran disparaît et l'API répond 403 ; les besaces et leur journal sont conservés et reviennent à la réactivation. « Repartir à zéro » (`POST /api/modules/epopee/reset`, administrateur, confirmation par saisie) efface exploits, demandes, routines, profils et grand livre.

## Vérifier depuis le serveur

```bash
# Le solde de chaque enfant, recalculé depuis le grand livre (lecture seule)
sqlite3 -readonly /var/lib/foyer/foyer.db \
  "SELECT member_id, SUM(delta) AS ecus, COUNT(*) AS ecritures FROM epo_ledger GROUP BY member_id;"
```
