# Révisions

Des exercices courts pour réviser à la maison, avec un programme réglé par un parent et un suivi par enfant, par item (6 × 7 est-il su ?), par groupe (la table de 7) et dans le temps. Deux exercices : **Tables** (multiplication et addition, maths) et **Dictée de mots** (français) ; d'autres suivront, un par un.

> État : le socle serveur (tables `rev_*`, registre d'exercices, exercice Tables, barème, maîtrise, réception des sessions, programmes, recalcul) et l'écran pour s'entraîner (« Mon entraînement du jour », une carte par exercice, grille, file hors ligne) sont en place, ainsi que le suivi des parents (programme, activité, réussite, items fragiles, grille), le bilan d'une période (à l'écran, en PDF « Pour la maîtresse », sessions en CSV), le bilan du dimanche sur le téléphone et la tuile d'accueil. Les outils d'assistant `revisions_*` sont décrits dans `docs/assistants.md`. La dictée de mots, second exercice, a prouvé le socle (voir « Ce que la dictée a demandé au socle »).

## Le module

Drapeau `modRevisions` (Paramètres → Modules actifs), **activé par défaut**. Désactivé : l'accès API répond 403, l'écran et la tuile disparaissent. Les sessions et la progression sont conservées, et la réactivation les retrouve telles quelles : contrairement aux autres modules, Révisions ne propose **pas** de « repartir à zéro », parce qu'une session ne se supprime jamais.

Aucun réglage propre à un exercice dans les Paramètres : ce qui le règle (pour Tables, l'opération, la dernière table proposée, les tables travaillées, le sens des questions) est un **paramètre de l'exercice**, porté par le programme de chaque enfant.

## Le socle et les exercices

Le socle (sessions, réponses, maîtrise, programmes, suivi, réception hors ligne) **ne connaît aucune matière**. Tout ce qui est propre à un exercice passe par une **définition** (`ExerciseDef`, contrat dans `backend/src/revisions/exercises/contract.ts`), rangée dans un registre (`exercises/index.ts`) :

| Élément | Rôle |
|---|---|
| `id`, `label`, `matiere`, `icon`, `ageMin`, `desc` | ce qui s'affiche ; la matière renvoie à `config/revisions/matieres.json` ; l'âge est indicatif, jamais une interdiction |
| `input`, `prompt`, `view`, `requires` | la saisie (`pave` : le pavé maison, `clavier`, `choix`), l'énoncé (`texte`, `audio`, `horloge`), la vue du suivi (`grille`, `liste`), ce que l'appareil doit savoir faire (`voix`) |
| `params` | les paramètres que porte un programme, d'un des types `int`, `bool`, `enum`, `range`, `content` (une liste du contenu de l'exercice) : le formulaire du programme est **engendré** depuis eux, jamais écrit pour un exercice. Un test refuse un autre type, et un type sans rendu dans le formulaire ne compile pas. |
| `universe`, `question`, `parse` | les items que le programme peut poser (par leur clé), une question pour un item, la relecture d'une question reçue. `universe`, `groups`, `learn` et `summary` reçoivent aussi le **contexte** de l'exercice (ses listes de contenu) ; un exercice sans contenu l'ignore |
| `itemKey`, `itemLabel`, `text`, `groups` | la clé de maîtrise (« mult:6x7 », commutative pour les tables), l'item en clair, l'énoncé, les regroupements du suivi (« Table de 7 ») |
| `ask`, `prerequisite` | facultatifs : l'énoncé de part et d'autre de la case de réponse (absent : le texte, « = », la case) ; l'item qu'il faut avoir **acquis** avant qu'un autre soit posé (le tirage l'applique, le serveur ne le refuse pas : c'est une progression, pas un droit) |
| `check` | la correction, la même sur l'appareil et sur le serveur |
| `choices` | facultatif : les réponses proposées d'une saisie `choix`, dans l'ordre de l'écran (obligatoire pour elle, vérifié par un test du registre) |
| `clock`, `display` | facultatifs : l'heure que dessine un énoncé `horloge` (obligatoire pour lui, vérifié par un test du registre) ; la saisie telle qu'elle s'affiche pendant qu'on tape (« 745 » devient « 7 h 45 ») |
| `learn`, `spoken`, `grid`, `summary` | le mode Apprendre (absent : pas de mode Apprendre), ce que lit la voix, la forme de la grille, le programme en une ligne |

Le dossier `exercises/` est **pur** (aucune dépendance hors de lui) : il vit en deux copies identiques, `backend/src/revisions/exercises/` et `frontend/src/app/core/revisions/exercises/` (où l'exercice tourne hors ligne), vérifiées octet pour octet par `backend/test/revisions-copy.test.ts`, comme le moteur de récurrence. Modifier l'une, puis copier : `cp backend/src/revisions/exercises/*.ts frontend/src/app/core/revisions/exercises/`.

### Ajouter un exercice

1. Un fichier dans `backend/src/revisions/exercises/` qui exporte une définition respectant le contrat.
2. Une ligne dans `exercises/index.ts`.
3. Son contenu pédagogique (listes de mots, etc.) **en configuration**, dans `backend/config/revisions/<exercice>/*.json`, surchargeable au même chemin dans le dossier de données ; jamais dans le code.
4. Si l'exercice prend plus ou moins de temps que le commun, sa partie dans le barème (`exercices.<id>`).
5. Ses tests sur cas fixés (génération, correction), à côté de ceux de Tables (`backend/test/revisions-exercises.test.ts`) ; les tests du registre (types de paramètres, matière, icône) s'appliquent seuls.

Ni table, ni colonne, ni route à ajouter. Un exercice qui demanderait une saisie ou un énoncé d'un type nouveau ajoute ce type au contrat et son composant à l'écran, une fois, pour tous les exercices qui en voudront.

### La dictée de mots

La voix de l'appareil lit un mot (jamais affiché, sauf en mode Apprendre, où il se recopie) ; l'enfant l'écrit au **clavier système**, avec correction automatique, majuscule automatique et vérification orthographique coupées. Sur iPad et iPhone, la barre de suggestions peut subsister selon les réglages de l'appareil (Réglages → Général → Clavier → Prédiction) : à couper sur l'appareil familial si elle souffle les mots.

- **Correction** : les accents comptent (c'est ce qu'on apprend), pas les majuscules, les espaces en trop ni la forme de l'apostrophe (’ ou ').
- **Item** : le mot, quelle que soit la liste qui le porte. « oiseau » su dans la liste de la semaine reste su dans la suivante.
- **Listes** : celles livrées dans `backend/config/revisions/dictee/` (mots invariables du CE1 et du CE2, pour commencer), et celles du foyer, saisies par un parent dans le suivi (« la dictée de la semaine »). Le programme choisit une liste.
- **Temps** : le barème a une partie `exercices.dictee` (25 s par mot à 8 ans, rapide sous 12 s) : écrire un mot prend plus longtemps que répondre 42.
- **Voix** : l'exercice déclare `requires: ['voix']`. Un appareil sans voix française ne le propose pas et le dit sur l'écran Révisions ; le réglage `revisionsVoix` ne coupe pas la dictée (la voix y est l'énoncé).
- **Vue** : la maîtrise s'affiche en liste (un mot par ligne et son état), pas en grille.

### Ce que la dictée a demandé au socle

La PR 6 devait dire si le contrat de la PR 4 tenait. Il ne tenait pas tout à fait, sur un point : **un exercice qui lit un contenu**. Deux ajouts au contrat, et rien d'autre :

1. un cinquième type de paramètre, `content`, qui désigne une liste du contenu de l'exercice ;
2. un argument `ctx` (le contexte : les listes de l'exercice) passé à `universe`, `groups`, `learn`, `summary`, `defaults` et `readParams`. Tables l'ignore : son code n'a pas changé.

Ce qui était prévu et n'a demandé aucune retouche du contrat : la saisie `clavier`, l'énoncé `audio`, la vue `liste`, la capacité `voix`, et la table de contenu `rev_content`. Au passage, le serveur refuse désormais une question qui sort de l'univers des réglages de la session (une question de dictée hors de sa liste, un 2 × 3 dans une session des tables 6 à 9) : l'appareil ne peut plus inventer ses items.

### Orthographe

`orthographe`, français, dès 7 ans environ : une phrase à trou et des mots qui se prononcent pareil ; l'enfant **touche le bon** parmi deux à quatre grands boutons (les touches 1 à 4 d'un clavier marchent aussi).

- **Le contenu** est une liste de phrases, **une ligne par phrase**, le trou entre accolades, le bon mot d'abord puis les pièges : « Il {a/à} un chat. », « C'{est/et} beau. ». Pas de virgule dans une phrase saisie à l'écran (il coupe aux virgules). Listes livrées dans `backend/config/revisions/orthographe/` (a ou à, et ou est, son ou sont, on ou ont, ou ou où, ces ou ses ; huit phrases chacune), et celles du foyer, saisies dans le suivi ou par l'assistant (`exercice: "orthographe"`). Une ligne qui n'a pas cette forme est ignorée.
- **Un item** est une phrase ; la clé est la ligne entière, bon mot compris : le serveur refuse une question dont les mots ou le bon mot ne sont pas ceux de la liste. L'ordre des boutons est tiré à chaque question.
- **La correction** : le bon mot, accents compris, majuscule indifférente.
- **Le suivi** en liste, groupé par mots qui se confondent (« a / à », « on / ont », majuscule ou non). Le mode Apprendre montre les phrases justes.
- **Le temps** : partie `exercices.orthographe` du barème (15 s à 8 ans, rapide sous 7 s).

Ce que l'orthographe a demandé au socle : la saisie `choix`, **prévue au contrat depuis la PR 4** mais sans écran, et l'élément facultatif `choices` qui donne les boutons. Le lecteur l'affiche en grille de boutons ; le mot touché s'inscrit dans le trou de la phrase. Ni table, ni migration, ni route.

### Conjugaison

`conjugaison`, français, dès 7 ans environ : « être (présent) : nous … », l'enfant écrit la forme au **clavier système**, comme pour la dictée.

- **Le contenu** est une liste de formes, **une ligne par forme** : « verbe (temps) : pronom forme », par exemple « être (présent) : nous sommes » ou « avoir (présent) : j'ai ». Pas de virgule (l'écran des listes coupe aux virgules), et aucune conjugaison dans le code. Listes livrées dans `backend/config/revisions/conjugaison/` (être et avoir au présent, au futur, à l'imparfait ; les verbes en -er au présent et au futur ; aller, faire, dire, venir au présent), et celles du foyer, saisies par un parent dans le suivi ou par l'assistant (`revisions_liste_creer` avec `exercice: "conjugaison"`). Une ligne qui n'a pas cette forme est ignorée.
- **Un item** est une forme ; la clé porte la forme attendue (« conj:être:présent:nous:sommes »), ce qui permet au serveur de refuser une question dont la forme n'est pas celle de la liste.
- **La correction** suit la dictée : les accents comptent, pas les majuscules, les espaces ni la forme de l'apostrophe. Écrire le pronom avec (« nous sommes ») est juste aussi.
- **Le suivi** en liste, groupé par verbe et temps (« être (présent) »). Le mode Apprendre déroule la liste, la voix lit chaque forme.
- **Le temps** : partie `exercices.conjugaison` du barème (20 s à 8 ans, rapide sous 10 s).

Rien n'a été ajouté au socle. Une conséquence : plusieurs exercices ont désormais des listes (la dictée, la conjugaison, l'orthographe), l'assistant doit donc préciser `exercice` pour en gérer une.

### Soustractions

Les tables de soustraction (`soustractions`, mathématiques, dès 6 ans environ), l'inverse des tables d'addition : « enlever 7 », c'est de 7 − 7 à 17 − 7, le résultat allant de 0 à 10.

- **Le programme** choisit les nombres enlevés (de 0 à 10, par défaut de 2 à 5). 11 items par nombre enlevé.
- **Un item** est une soustraction (« sub:13-7 ») : elle n'est pas commutative, 13 − 7 et 13 − 6 se suivent à part.
- **Le suivi** : une grille d'une ligne par nombre enlevé (« − 7 ») et d'une colonne par résultat ; groupes « Enlever 7 ». Le mode Apprendre récite la table du premier nombre enlevé.
- **Le temps** : celui du barème commun, comme les Tables (partie `exercices.soustractions` vide, à remplir pour l'adapter).

Rien n'a été ajouté au socle : l'exercice n'utilise que ce que le contrat offrait déjà.

### Lire l'heure

Troisième exercice (`heure`, mathématiques, dès 6 ans environ) : une **horloge à aiguilles** dessinée à l'écran, l'enfant écrit l'heure au pavé (7, 4, 5 pour « 7 h 45 »).

- **Le programme** règle la précision : heures pleines, et demies (par défaut), et quarts, cinq minutes. L'univers est chaque heure du cadran (1 à 12) à chaque minute permise : 12, 24, 48 ou 144 items.
- **Un item** est une position des aiguilles (« heure:7:45 ») ; 7 h 45 et 19 h 45 sont toutes deux justes, 0 h 15 vaut 12 h 15. Les minutes doivent y être : « 7 » ne répond pas à 7 h 45.
- **La saisie** se lit comme un réveil : les deux derniers chiffres sont les minutes dès qu'il y en a trois (« 745 », « 1205 ») ; un ou deux chiffres sont l'heure seule (« 7 », « 15 »). L'écran l'affiche ainsi pendant la frappe ; le passage par « 1 h 00 » en tapant 10 h 05 est le seul moment trompeur, il disparaît au chiffre suivant.
- **Le suivi** : une grille heures × minutes, et des groupes « Heures pleines », « Demies », « Quarts », « Cinq minutes ». Le mode Apprendre fait le tour du cadran à la précision du programme (à 4 heures, ou les douze heures pleines).
- **Le temps** : partie `exercices.heure` du barème (15 s à 8 ans, rapide sous 8 s) : lire deux aiguilles prend plus longtemps qu'une table.

Ce que l'heure a demandé au socle : deux éléments **facultatifs** du contrat, `clock` (l'énoncé `horloge` était prévu depuis la PR 4, sans cadran pour le dessiner) et `display`, et un composant d'écran, le cadran (`screens/revisions/clock.ts`, en SVG, aux couleurs du thème). Ni table, ni migration, ni route.

### Les questions à trous

Un paramètre de Tables, `trous` (« Questions à trous », non par défaut), que le parent active dans le programme : « ? × 7 = 42 » ou « 6 × ? = 42 », la case de réponse à la place du nombre qui manque.

- **Item à part** : « mult:6x7:trou ». Retrouver le facteur qui manque n'est pas réciter la table, sa maîtrise se suit à part (« 6 × 7, à trous », groupe « Table de 6, à trous » au suivi).
- **Prérequis** : la question à trous d'un couple n'est tirée qu'une fois ce couple **acquis** (niveau 3) dans le sens direct. Activer les trous sur une table toute neuve ne change donc rien tant qu'elle n'est pas sue.
- **Pas de trou avec un 0 en multiplication** : « ? × 0 = 0 » a toutes les réponses. En addition, « 0 + ? = 6 » n'en a qu'une et reste posé.
- **Correction** : la réponse attendue est le facteur manquant ; la correction affichée remet l'opération entière (« 6 × 7 = 42 »).
- Le serveur refuse une question à trous dans une session dont les réglages n'ont pas `trous`, comme toute question hors de l'univers.

Ce qu'il a fallu au contrat : deux éléments **facultatifs**, `ask` (où se place la case) et `prerequisite` (l'ordre d'apprentissage). Aucune table, aucune migration, et la dictée n'a pas changé.

### L'entraînement du jour dans « Devoirs de … »

Dans le programme d'un exercice, un parent peut cocher « Une tâche « Tables : entraînement du jour » dans « Devoirs de Raphaël », les jours d'école ». La case n'apparaît que si cette liste existe, c'est-à-dire si le module **École** est activé et l'enfant **associé à ÉcoleDirecte** : sans elle, pas de tâche, et Foyer n'invente pas de seconde liste.

- **Les jours d'école** : d'après l'emploi du temps ÉcoleDirecte de l'enfant quand la semaine en a un (un jour avec au moins un cours qui n'est pas annulé, donc un mercredi libre reste libre) ; sinon le calendrier, du lundi au vendredi hors jours fériés et vacances scolaires de l'académie (vacances inconnues : le jour compte).
- **Une tâche par jour**, affectée à l'enfant, échéance le jour même. Elle se **coche toute seule** quand l'objectif du jour du programme est atteint (les sessions du jour comptent comme pour l'écran : toutes, sauf le mode Apprendre). Il faut donc un objectif d'au moins une session.
- **Le lendemain**, celle de la veille s'en va, faite ou non : pas de retard qui s'accumule ni de reproche.
- **Le serveur ne décoche jamais** : relever l'objectif dans la journée laisse cochée une tâche déjà faite.
- **Supprimée à la main**, elle ne revient pas le même jour (`rev_day_tasks` s'en souvient) ; le jour d'école suivant en apporte une nouvelle. Pour l'arrêter, on décoche la case du programme : la tâche du jour s'en va aussitôt.
- Elle **ne se modifie pas** (c'est le programme qui la règle), se coche à la main comme toute tâche, et son lien « S'entraîner » ouvre l'écran Révisions.
- Module Révisions ou École éteint : les tâches d'entraînement s'en vont, le choix fait dans le programme reste pour la réactivation. Un programme réglé par l'assistant garde le choix du programme qu'il remplace.

Côté technique : `revisions/day-tasks.ts` décide (pur, testé), `revisions/devoirs.ts` lit les tables et écrit par les opérations de tâches « de confiance », comme la projection des devoirs (champ `revEx` de la tâche, posé par le serveur seul). Le passage a lieu au démarrage, chaque minute, à chaque programme enregistré, et à chaque session reçue (pour la coche).

### Le contenu des exercices

- **Livré** : `backend/config/revisions/<exercice>/*.json`, chaque fichier portant `{ "listes": [{ "id", "label", "items": [...] }] }` (identifiant en minuscules, chiffres et tirets). Un fichier au même nom dans `FOYER_DATA_DIR/revisions/<exercice>/` le **remplace**, un fichier d'un autre nom **s'ajoute** ; relus sans redémarrer. Une liste illisible est écartée et nommée au journal.
- **Du foyer** : table `rev_content` (migration v2), une ligne par liste, identifiant `foyer-<n>`. Un adulte la crée, la modifie ou l'archive ; **jamais effacée** : une liste archivée disparaît des choix, mais un programme ou une session qui la désigne reste lisible.
- L'appareil garde les listes dans sa copie locale (`foyer.revisions.<membre>`) : la dictée marche sans réseau.

## Ce que Foyer retient

Tables relationnelles `rev_*` dans `foyer.db`, hors du document du foyer :

| Table | Contenu |
|---|---|
| `rev_programs` | le programme d'un enfant pour un exercice, réglé par un parent : les paramètres de l'exercice (JSON), le nombre de questions, le temps accordé (ou le barème), l'objectif par jour. Un seul actif par enfant **et par exercice** ; l'ancien reste, daté et signé, pour que le bilan d'une période dise sur quoi elle portait. |
| `rev_sessions` | une session : exercice, mode (apprendre, s'entraîner, test), paramètres, début et fin, abandon, nombre de bonnes, lentes et fausses, temps moyen, seuils appliqués, appareil, et le parent qui avait ouvert la session de l'enfant s'il y en a un. L'identifiant vient de l'appareil (uuid). |
| `rev_answers` | chaque réponse : la question telle que posée (JSON propre à l'exercice), la clé de l'item, la bonne réponse et la réponse donnée (texte, ou rien si passée), le temps, le résultat, l'heure. |
| `rev_mastery` | la maîtrise par membre, exercice et item : un cache, recalculable entièrement depuis `rev_answers`. |
| `rev_content` | les listes de contenu saisies par le foyer (migration v2) : exercice, nom, éléments, auteur, dates, archivée. |
| `rev_day_tasks` | les tâches d'entraînement du jour déjà projetées (migration v3) : enfant, exercice, jour, identifiant de la tâche. La même migration ajoute `daily_task` à `rev_programs`. |

**Rien n'est jamais supprimé.** Une session abandonnée reste (ses réponses déjà données comptent), un programme remplacé ou retiré reste. Le passé ne se réécrit qu'avec une commande explicite (voir plus bas).

Les tables `tab_*` d'une version de développement antérieure n'ont jamais été livrées : aucune migration de données n'existe ni n'est nécessaire.

## Le modèle de maîtrise

Le même pour tous les exercices : une boîte de Leitner par item, niveau de 0 à 5. Pour Tables, l'item est un couple **commutatif** : 6 × 7 et 7 × 6 comptent ensemble (la question, elle, peut être posée dans les deux sens).

| Réponse | Effet |
|---|---|
| juste et **rapide** | monte d'un niveau, **si l'item était dû** (sa date de révision est passée) ; la prochaine révision est fixée selon le niveau : 1, 3, 7, 14 puis 30 jours |
| juste mais **lente** | le niveau ne bouge pas, l'item reste à revoir |
| **fausse** ou passée | descend de deux niveaux, et l'item redevient dû tout de suite |

La règle « si l'item était dû » empêche un enfant d'obtenir « acquis » en répétant la même opération dix fois dans la soirée : il faut des jours différents.

**Quatre états affichés :**

| État | Quand |
|---|---|
| pas encore vu | aucune réponse : on ne sait rien, ce n'est pas « non su » |
| pas assez de données | moins de réponses que le seuil (3 par défaut) |
| en cours | le reste |
| **acquis** | niveau 3 ou plus, au moins 3 bonnes réponses, et la dernière rapide |

Avec les valeurs par défaut, un item peut être « acquis » **au plus tôt quatre jours** après sa première bonne réponse (jour 0, jour 1, puis jour 4). Une réponse lente ensuite retire « acquis » sans faire descendre le niveau.

Le résultat d'une réponse (bonne, lente, fausse) est **fixé à sa réception**. Juste ou faux se décide sur le serveur, par la définition de l'exercice, pas d'après ce que dit l'appareil. « Rapide » se décide avec le seuil que l'appareil appliquait pendant la session (celui que le serveur lui avait donné). Changer le barème ensuite change les sessions à venir, pas le passé ; changer les seuils d'acquisition change l'affichage « acquis », pas les niveaux stockés.

Une session faite hors ligne mardi et arrivée après celle de mercredi donne exactement la même maîtrise que si elles étaient arrivées dans l'ordre : la maîtrise d'un item est recalculée depuis toutes ses réponses, dans l'ordre où elles ont été données. L'horloge de l'appareil fait foi, bornée (une réponse datée dans le futur est ramenée à l'heure de réception).

Le mode **Apprendre** (la matière sous les yeux, sans chronomètre) est enregistré, mais ne compte pas pour la maîtrise. Un exercice sans `learn` n'a pas de mode Apprendre (le serveur le refuse).

## Le barème

Fichier livré `backend/config/revisions/bareme.json`, surchargeable par `revisions/bareme.json` dans le dossier de données (`FOYER_DATA_DIR`), relu sans redémarrer. Deux parties :

- `commun` vaut pour tous les exercices ;
- `exercices.<id>` le précise pour l'un d'eux (taper un mot prend plus longtemps que répondre 42).

Les couches s'appliquent dans l'ordre : commun livré, exercice livré, commun du foyer, exercice du foyer. Chacune ne contient que ce qui change (`ages` se remplace en bloc ; `adulte`, `sansAge` et `maitrise` champ par champ). Une valeur illisible est écartée et nommée au journal, le reste s'applique.

Valeurs de départ communes, **à ajuster à l'usage** (aucune étude ne les fonde ; mestables.fr adapte lui aussi le temps à l'année de naissance, ses valeurs ne sont pas reprises ici). Tables n'y ajoute rien.

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

Exemple de surcharge (`/var/lib/foyer/revisions/bareme.json`), pour exiger un niveau de plus avant « acquis » partout, et laisser deux secondes de plus aux tables :

```json
{
  "commun": { "maitrise": { "niveauAcquis": 4 } },
  "exercices": { "tables": { "adulte": { "accorde": 6, "rapide": 3 } } }
}
```

Les matières (nom affiché, ordre du bilan) sont dans `backend/config/revisions/matieres.json`, surchargeables de la même façon.

## L'écran

Écran **Révisions** (menu Organisation ; pour un enfant, la tuile « Mes révisions » de son accueil et son menu). Pour un enfant, c'est son entraînement ; pour un adulte, c'est **seulement le suivi de ses enfants** (un adulte ne s'entraîne pas ici ; sans enfant dans le foyer, l'écran le dit). Rien n'y est écrit pour un exercice en particulier.

- **Mon entraînement du jour** enchaîne, en mode S'entraîner, les exercices dont l'enfant a un programme, chacun avec ses paramètres et son nombre de questions ; entre deux exercices, « Continuer » ou « J'arrête là ». Sans aucun programme (un enfant à qui rien n'est encore réglé), il enchaîne tous les exercices à leurs réglages par défaut, 20 questions chacun. L'objectif du jour s'affiche sans jamais reprocher un zéro (« Pas encore aujourd'hui », « Objectif du jour atteint ») ; toute session comptée du jour sur l'exercice compte.
- **Une carte par exercice**, rangée par matière (ordre de `matieres.json`) : « S'entraîner » (le programme, ou les défauts), « Je choisis » (le mode, et les paramètres dans un **formulaire engendré** depuis leur déclaration : une liste pour un entier, oui ou non, un choix, « de … à … »), la grille de maîtrise (un exercice de vue `grille`) et les items à retravailler. Toucher une case ou un item ouvre son historique.
- **Le runner**, plein écran : l'énoncé et la correction viennent de la définition. La saisie `pave` est le pavé maison (jamais le clavier du système) ; le clavier physique marche aussi. Un exercice d'une saisie que l'écran ne sait pas encore afficher n'est pas proposé (`SUPPORTED_INPUTS` dans `screens/revisions/runner.ts`) ; la vue `liste` et la saisie `clavier` arriveront avec la dictée.
- **Le bilan** : bonnes, lentes, fausses, ce qui est à revoir, la grille avec les cases qui viennent de changer. Pas de points ni de classement.
- **La voix** (mode Apprendre, exercice qui déclare `spoken`) : la synthèse vocale de l'appareil, jamais un service en ligne. Réglage d'appareil `revisionsVoix` (Paramètres → Révisions) ; sans voix française, pas de bouton « Écouter ».

**Le suivi des enfants** (l'écran d'un adulte, quand le foyer a un enfant), par enfant puis par exercice :

- **Le programme**, réglé ici : les paramètres de l'exercice dans le formulaire engendré, le nombre de questions par session, le temps par réponse (le barème selon l'âge, rappelé en clair, ou un temps fixé et son seuil « rapide »), l'objectif de sessions par jour. « Retirer le programme » le rend inactif sans rien effacer ; l'enfant s'entraîne alors aux réglages par défaut. Chaque réglage est daté et signé, et journalisé côté serveur.
- **L'activité** sur quatre semaines (sessions par jour, heure de Paris), **la réussite par groupe** d'items du programme (pour Tables, par table ; un groupe sans réponse dit « pas encore vu »), **ce qui reste fragile** (dans le périmètre du programme en vigueur), et **la grille**, avec l'aide qui rappelle les règles d'acquisition du barème.

**Le bilan d'une période** (carte « Bilan » du Suivi, adultes seulement, pour un enfant) : cette semaine (du lundi à aujourd'hui), la semaine dernière, ce mois-ci, le mois dernier. Par matière puis par exercice : le résumé du programme, sessions et questions, part de réponses justes comparée à la période précédente de même longueur, réussite par groupe (pour Tables, par table), ce qui reste fragile dans le programme en vigueur. Le mode Apprendre n'y compte pas.

- **« Pour la maîtresse (PDF) »** : le même bilan sur une page A4 en portrait, « Révisions de Raphaël », la période en toutes lettres, signé « Établi par Foyer le … ». Il ne contient le nom d'aucun autre membre, pas même du parent qui l'a demandé. S'imprime depuis l'iPhone (Partager → Imprimer).
- **« Les sessions (CSV) »** : une ligne par session (date, heure, exercice, mode, réglages, questions, bonnes, lentes, fausses, temps moyen, abandon), séparateur « ; », UTF-8 avec BOM, comme les autres exports.

**Le bilan du dimanche.** Le dimanche, à partir de `revisionsBilanHeure` (18 h 30 par défaut, Paramètres → Révisions), chaque adulte qui a laissé `revisionsBilanHebdo` activé (Paramètres → Notifications) reçoit une notification par enfant qui a un programme ou une session dans la semaine : « Raphaël cette semaine : 5 sessions, les tables de 6 à 9, multiplication, 92 % de réussite, 7 × 8 et 6 × 9 encore fragiles. » Sans session, elle le dit sans reproche. Une seule par enfant et par semaine (clé `revisions-hebdo|<enfant>|<lundi>` du journal des envois), même si le service redémarre. La toucher ouvre le suivi de l'enfant. Un enfant n'en reçoit jamais.

**La tuile d'accueil.** Pour un enfant, « Mes révisions » avec l'objectif du jour ; pour un adulte, « Raphaël : 2 sessions aujourd'hui, Gaëtan : pas encore aujourd'hui » (tuile sur téléphone, carte du bandeau sur tablette et ordinateur, une ligne ouvre le suivi).

**Hors ligne.** L'exercice tourne entièrement dans le navigateur. La session part en un seul envoi à la fin ; sans réseau, elle attend dans `foyer.revisionsQueue.<membre>` (rangée par membre, comme les autres files, voir `docs/portail-enfant.md`) et repart seule au retour du réseau, une seule fois grâce à son uuid. Un refus définitif (400) la retire en le disant ; un 403 (module éteint, autre membre) ou une panne du serveur la garde. La dernière vue connue (programmes, maîtrise, temps accordé) est copiée dans `foyer.revisions.<membre>` pour s'entraîner sans réseau. Une session d'enfant restée en file quand le parent reprend l'appareil dort sous le nom de l'enfant et part à sa prochaine session.

## Qui a le droit de quoi

| | Enfant | Adulte |
|---|---|---|
| ses propres sessions, sa maîtrise, son historique | lire, écrire | lire, écrire (l'API l'accepte, mais l'écran d'un adulte ne propose que le suivi des enfants) |
| ceux d'un autre membre | refusé (403) | lire |
| le programme d'un enfant | lire le sien | régler, retirer |
| enregistrer une session au nom d'un autre | refusé | refusé |

Un jeton d'accès (assistant, script) n'entre pas dans l'API du module : l'assistant passe par ses outils MCP `revisions_*` (`docs/assistants.md`), avec les mêmes règles : un enfant ne voit que lui, le bilan, le réglage d'un programme et la gestion des listes du foyer (créer, modifier, archiver) sont réservés aux adultes, les écritures à un jeton d'écriture, chacune est journalisée avec le nom du jeton. Les listes passent par les mêmes règles qu'à l'écran (`revisions/content.ts`).

## API

Sous `/api/revisions`, session de navigateur, membre du foyer, module activé. `:ex` est l'identifiant d'un exercice (`tables`).

| Route | Effet |
|---|---|
| `GET /exercises` | les matières et les exercices, avec leurs paramètres déclarés (ce que l'écran affiche, ce que le formulaire engendre) |
| `GET /config[?exercise=…]` | règles de maîtrise et barème (commun, ou d'un exercice), pour l'aide |
| `GET /members/:id` | les programmes actifs du membre, un par exercice : ce qu'enchaîne « Mon entraînement du jour » |
| `GET /members/:id/exercises/:ex` | programme, paramètres en vigueur (ceux du programme, sinon les défauts), temps accordé (et sa source : programme, barème, sans âge), la liste « Devoirs de … » où peut aller la tâche du jour (`devoirsList`, ou null), maîtrise de chaque item avec son état |
| `GET /members/:id/exercises/:ex/items/:clé` | l'historique d'un item (pour Tables, les deux sens), le plus récent d'abord |
| `GET /members/:id/exercises/:ex/stats[?since=…]` | sessions par jour (heure de Paris) et réussite par groupe d'items, limitée à ce que le programme travaille ; quatre semaines par défaut |
| `GET /members/:id/sessions[?exercise=…&since=…&limit=…]` | les sessions |
| `PUT /members/:id/exercises/:ex/program` | régler le programme d'un enfant (adultes) : `params`, `questions`, `secondsAllowed`, `fastSeconds`, `dailyGoal`, `dailyTask` (la tâche du jour ; absent : le choix du programme remplacé). Un paramètre refusé est nommé dans l'erreur. |
| `DELETE /members/:id/exercises/:ex/program` | retirer le programme (il reste en base, inactif) |
| `GET /members/:id/bilan[?from=AAAA-MM-JJ&to=AAAA-MM-JJ]` | le bilan d'une période (fin incluse, un an au plus ; par défaut la semaine en cours), adultes seulement, pour un enfant |
| `GET /members/:id/bilan.pdf[?from&to]` | le même bilan en PDF, journalisé |
| `GET /members/:id/sessions.csv[?from&to]` | les sessions de la période en CSV |
| `GET /exercises/:ex/content` | les listes d'un exercice à contenu, livrées et du foyer (archivées marquées) : tout membre, l'appareil en a besoin hors ligne |
| `POST /exercises/:ex/content` | créer une liste du foyer : `label`, `items` (1 à 200, de 40 caractères au plus) ; adultes |
| `PATCH /exercises/:ex/content/:id` | modifier une liste du foyer (`label`, `items`) ou l'archiver (`archived`) ; une liste livrée ne se modifie pas ici ; adultes |
| `POST /sessions` | une session en un seul envoi : `id` (uuid de l'appareil), `exerciseId`, `mode`, `params` (ou `programId`, dont les paramètres s'appliquent), `startedAt`, `endedAt`, `aborted`, `fastMs` et `allowedMs` appliqués, `answers` (`question` dans la forme de l'exercice, `given` ou null, `ms`, `askedAt`). 201 à la première réception, 200 et `duplicate: true` ensuite. La réponse dit, pour chaque item touché, son état avant et après. |

Chaque session reçue et chaque changement de programme sont journalisés (« Révisions : session Tables de Raphaël reçue (entrainer, Les tables de 6 à 9, multiplication) : 18 bonnes, 2 lentes, 0 fausses, 212 s. »).

## Recalculer

`rev_mastery` se reconstruit depuis les réponses. Utile si la table est abîmée, ou si les règles de maîtrise du barème ont changé et qu'on veut les appliquer à l'historique. Le service peut tourner pendant ce temps.

```bash
# Docker
docker compose exec foyer npm run revisions:recalcul -- --membre m2
# LXC
runuser -u foyer -- node /opt/foyer/backend/dist/revisions/recalcul.js --env - --membre m2 < /etc/foyer/foyer.env
# Tous les membres qui ont des réponses, un seul exercice
runuser -u foyer -- node /opt/foyer/backend/dist/revisions/recalcul.js --env - --tous --exercice tables < /etc/foyer/foyer.env
```

`--exercice <id>` limite le recalcul à un exercice ; sans elle, tous. `--reclasser` refait d'abord « bonne » ou « lente » de chaque réponse juste avec le barème et le programme **d'aujourd'hui** : c'est le seul geste qui réécrit le passé. Il est donc explicite, et chaque lancement est écrit sur la sortie d'erreur pour le journal. Une réponse fausse reste fausse, le mode Apprendre n'est pas touché. L'identifiant d'un membre est celui de sa fiche (champ `members[].id` de `GET /api/state` ; le journal des sessions reçues donne le prénom).

## Sauvegarde

Les tables `rev_*` (dont `rev_content`, les listes du foyer) sont dans `foyer.db` : l'instantané `VACUUM INTO` et la procédure de `docs/sauvegarde-restauration.md` les emportent sans rien changer. Les surcharges éventuelles (`revisions/bareme.json`, `revisions/matieres.json`, `revisions/<exercice>/*.json`) sont dans le dossier de données, emportées avec lui.
