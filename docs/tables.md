# Tables (calcul mental)

L'entraînement aux tables de multiplication et d'addition, avec un suivi par enfant, par opération (6 × 7 est-il su ?), par table et dans le temps. Inspiré de mestables.fr pour la simplicité côté enfant, nettement plus complet côté suivi.

> État : l'exercice, la grille et l'onglet Suivi sont en place. Le bilan hebdomadaire, le PDF pour la maîtresse, la tuile d'accueil détaillée, la tâche « Devoirs de … » et les outils d'assistant arrivent dans la tranche suivante.

## À l'usage

**Pour l'enfant** (dans sa session, ouverte par un parent ou avec ses identifiants) : la tuile « Mes tables » de l'accueil, puis deux taps.

- **Mon entraînement du jour** : le programme réglé par un parent, d'un seul bouton, avec l'objectif du jour (« Pas encore aujourd'hui », « 1 session sur 2 faite », « Objectif du jour atteint » : jamais un zéro reproché).
- **Je choisis** : l'opération (multiplication ou addition), les tables « de … à … », le mode.
  - **Apprendre** : la table entière sous les yeux, une ligne mise en évidence à la fois, que l'enfant recopie au pavé. Lue à voix haute si l'appareil a une voix française et si le réglage « Lire les tables à voix haute » de cet appareil est allumé ; sans voix française, pas de bouton « Écouter » du tout. Ni chronomètre ni score.
  - **S'entraîner** : une question à la fois, une barre de temps qui descend (une réponse après la barre est acceptée, notée « un peu lent »), correction immédiate avec la bonne réponse en cas d'erreur, enchaînement automatique. « Je ne sais pas » passe la question.
  - **Test** : pareil, sans la bonne réponse pendant le test.
- Le **pavé numérique** est celui de l'application, à grosses touches : le clavier du système n'apparaît jamais. Sur iPad en paysage, la question est à gauche et le pavé sous le pouce droit ; sur iPhone, l'un sous l'autre, sans défilement. Le clavier d'un Mac marche aussi (chiffres, retour arrière, Entrée).
- **Le bilan** : « Tu as révisé les tables de 6 à 9 : 18 bonnes, 2 lentes, 0 fausse. », les opérations à revoir, et la grille avec ce qui vient de changer. « Encore une » ou « J'ai fini ». « Arrêter » en cours de route garde les réponses déjà données.
- **La grille** : une case par opération, de 0 à la dernière table, colorée selon son état (légende écrite sous la grille). Une case touchée montre son historique.

**Pour un adulte** : l'onglet « M'entraîner » (sa propre grille, sans programme) et l'onglet **Suivi des enfants** : le programme de chaque enfant (opération, tables, questions, temps selon l'âge ou fixé, objectif par jour, sens des questions), son activité sur quatre semaines, sa réussite par table du programme, ses opérations encore fragiles, sa grille, et l'aide qui écrit les seuils d'acquisition du barème.

**Sans réseau** (l'iPad dans la voiture) : l'exercice tourne entièrement sur l'appareil, sur la dernière grille connue. La session terminée attend dans une file de l'appareil (« Une session attend le réseau : elle partira toute seule. »), même si l'application est fermée et rouverte, et part au retour du réseau. Son identifiant vient de l'appareil : renvoyée deux fois, elle n'est comptée qu'une fois. La file est rangée au nom de l'enfant : elle ne part jamais sous la session de quelqu'un d'autre.

## Le module

Drapeau `modTables` (Paramètres → Modules actifs), **activé par défaut**. Désactivé : l'accès API répond 403, l'écran et la tuile disparaissent. Les sessions et la progression sont conservées, et la réactivation les retrouve telles quelles : contrairement aux autres modules, Tables ne propose **pas** de « repartir à zéro », parce qu'une session ne se supprime jamais.

Réglage du foyer `tablesMax` (Paramètres → Tables) : la dernière table proposée, 10 par défaut, 12 si l'école le demande.

## Ce que Foyer retient

Tables relationnelles `tab_*` dans `foyer.db`, hors du document du foyer :

| Table | Contenu |
|---|---|
| `tab_programs` | le programme d'un enfant, réglé par un parent : opération, tables « de … à … », nombre de questions, temps accordé (ou le barème), objectif par jour, sens des questions. Un seul actif par enfant ; l'ancien reste, daté et signé, pour que le bilan d'une période dise sur quoi elle portait. |
| `tab_sessions` | une session : mode (apprendre, s'entraîner, test), plage, début et fin, abandon, nombre de bonnes, lentes et fausses, temps moyen, seuils appliqués, appareil, et le parent qui avait ouvert la session de l'enfant s'il y en a un. L'identifiant vient de l'appareil (uuid). |
| `tab_answers` | chaque réponse : la question telle que posée (a, b), le couple commutatif, la réponse donnée (ou rien si passée), le temps, le résultat, l'heure. |
| `tab_mastery` | la maîtrise par couple : un cache, recalculable entièrement depuis `tab_answers`. |

**Rien n'est jamais supprimé.** Une session abandonnée reste (ses réponses déjà données comptent), un programme remplacé reste. Le passé ne se réécrit qu'avec une commande explicite (voir plus bas).

## Le modèle de maîtrise

Une boîte de Leitner par couple, **commutatif** : 6 × 7 et 7 × 6 comptent ensemble (la question, elle, peut être posée dans les deux sens). Niveau de 0 à 5.

| Réponse | Effet |
|---|---|
| juste et **rapide** | monte d'un niveau, **si le couple était dû** (sa date de révision est passée) ; la prochaine révision est fixée selon le niveau : 1, 3, 7, 14 puis 30 jours |
| juste mais **lente** | le niveau ne bouge pas, le couple reste à revoir |
| **fausse** ou passée | descend de deux niveaux, et le couple redevient dû tout de suite |

La règle « si le couple était dû » empêche un enfant d'obtenir « acquise » en répétant la même opération dix fois dans la soirée : il faut des jours différents.

**Quatre états affichés :**

| État | Quand |
|---|---|
| pas encore vue | aucune réponse : on ne sait rien, ce n'est pas « non sue » |
| pas assez de données | moins de réponses que le seuil (3 par défaut) |
| en cours | le reste |
| **acquise** | niveau 3 ou plus, au moins 3 bonnes réponses, et la dernière rapide |

Avec les valeurs par défaut, une opération peut être « acquise » **au plus tôt quatre jours** après sa première bonne réponse (jour 0, jour 1, puis jour 4). Une réponse lente ensuite retire « acquise » sans faire descendre le niveau.

Le résultat d'une réponse (bonne, lente, fausse) est **fixé à sa réception**. Juste ou faux se décide sur le serveur, d'après la question, pas d'après ce que dit l'appareil. « Rapide » se décide avec le seuil que l'appareil appliquait pendant la session (celui que le serveur lui avait donné). Changer le barème ensuite change les sessions à venir, pas le passé ; changer les seuils d'acquisition change l'affichage « acquise », pas les niveaux stockés.

Une session faite hors ligne mardi et arrivée après celle de mercredi donne exactement la même grille que si elles étaient arrivées dans l'ordre : la maîtrise d'un couple est recalculée depuis toutes ses réponses, dans l'ordre où elles ont été données. L'horloge de l'appareil fait foi, bornée (une réponse datée dans le futur est ramenée à l'heure de réception).

Le mode **Apprendre** (la table sous les yeux, sans chronomètre) est enregistré, mais ne compte pas pour la maîtrise.

## Le barème

Fichier livré `backend/config/tables-bareme.json`, surchargeable par un fichier du même nom dans le dossier de données (`FOYER_DATA_DIR`), relu sans redémarrer. La surcharge ne contient que ce qui change (`ages` se remplace en bloc ; `adulte`, `sansAge` et `maitrise` champ par champ). Une valeur illisible est écartée et nommée au journal, le reste s'applique.

Valeurs de départ, **à ajuster à l'usage** (aucune étude ne les fonde ; mestables.fr adapte lui aussi le temps à l'année de naissance, ses valeurs ne sont pas reprises ici) :

| Âge | Temps accordé | « Rapide » sous |
|---|---|---|
| 6 ans et moins | 10 s | 5 s |
| 7 ans | 9 s | 4,5 s |
| 8 ans | 8 s | 4 s |
| 9 ans | 7 s | 3,5 s |
| 10 ans | 6 s | 3 s |
| 11 à 14 ans | 5 s | 2,5 s |
| 15 ans et plus | 4 s | 2 s |
| enfant sans date de naissance | 8 s | 4 s |

L'âge se calcule depuis la date de naissance de la fiche du membre, au jour de la session. Un adulte sans date de naissance a le temps d'un adulte. Le programme d'un enfant peut fixer son propre temps accordé et son propre seuil, qui l'emportent. Une réponse après le temps accordé n'est pas refusée : elle est « lente ».

Exemple de surcharge (`/var/lib/foyer/tables-bareme.json`), pour exiger quatre jours de révision de plus avant « acquise » :

```json
{ "maitrise": { "niveauAcquis": 4 } }
```

## Qui a le droit de quoi

| | Enfant | Adulte |
|---|---|---|
| ses propres sessions, sa grille, son historique | lire, écrire | lire, écrire (il s'entraîne pour lui-même, sans programme ni bilan) |
| ceux d'un autre membre | refusé (403) | lire |
| le programme d'un enfant | lire le sien | régler |
| enregistrer une session au nom d'un autre | refusé | refusé |

Un jeton d'accès (assistant, script) n'entre pas dans le module : l'assistant passera par ses outils MCP.

## API

Sous `/api/tables`, session de navigateur, membre du foyer, module activé.

| Route | Effet |
|---|---|
| `GET /config` | `tablesMax`, règles de maîtrise et barème, pour l'aide |
| `GET /members/:id[?operation=…]` | programme, temps accordé (et sa source : programme, barème, sans âge), grille de l'opération avec l'état de chaque case |
| `GET /members/:id/pairs/:operation/:a/:b` | l'historique d'une case (les deux sens), le plus récent d'abord |
| `GET /members/:id/sessions[?since=…&limit=…]` | les sessions |
| `GET /members/:id/stats[?operation=…&since=…]` | le résumé de l'onglet Suivi (quatre semaines par défaut) : sessions par jour à l'heure de Paris, et par table les questions qui la touchent, justes et rapides (le mode Apprendre n'y entre pas) |
| `PUT /members/:id/program` | régler le programme d'un enfant (adultes) |
| `POST /sessions` | une session en un seul envoi : `id` (uuid de l'appareil), `mode`, `operation`, `from`, `to`, `startedAt`, `endedAt`, `aborted`, `programId`, `fastMs` et `allowedMs` appliqués, `answers` (`a`, `b`, `given` ou null, `ms`, `askedAt`). 201 à la première réception, 200 et `duplicate: true` ensuite. La réponse dit, pour chaque couple touché, son état avant et après. |

Chaque session reçue et chaque changement de programme sont journalisés (« Tables : session de Raphaël reçue (entrainer, multiplication, tables 6 à 9) : 18 bonnes, 2 lentes, 0 fausse, 212 s. »).

## Recalculer

`tab_mastery` se reconstruit depuis les réponses. Utile si la table est abîmée, ou si les règles de maîtrise du barème ont changé et qu'on veut les appliquer à l'historique. Le service peut tourner pendant ce temps.

```bash
# Docker
docker compose exec foyer npm run tables:recalcul -- --membre m2
# LXC
runuser -u foyer -- node /opt/foyer/backend/dist/tables/recalcul.js --env - --membre m2 < /etc/foyer/foyer.env
# Tous les membres qui ont des réponses
runuser -u foyer -- node /opt/foyer/backend/dist/tables/recalcul.js --env - --tous < /etc/foyer/foyer.env
```

`--reclasser` refait d'abord « bonne » ou « lente » de chaque réponse juste avec le barème et le programme **d'aujourd'hui** : c'est le seul geste qui réécrit le passé. Il est donc explicite, et chaque lancement est écrit sur la sortie d'erreur pour le journal. Une réponse fausse reste fausse. L'identifiant d'un membre est celui de sa fiche (champ `members[].id` de `GET /api/state` ; le journal des sessions reçues donne le prénom).

## Sauvegarde

Les tables `tab_*` sont dans `foyer.db` : l'instantané `VACUUM INTO` et la procédure de `docs/sauvegarde-restauration.md` les emportent sans rien changer. La surcharge éventuelle du barème (`tables-bareme.json`) est dans le dossier de données, emportée avec lui.
