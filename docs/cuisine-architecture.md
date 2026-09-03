# Module Cuisine : architecture et exploitation

Ce document décrit la chaîne **recettes → planning des repas → liste de courses**
de Foyer : ce qui est en place, pourquoi les choix ont été faits, et les
procédures d'exploitation en commandes shell.

Il se lit en complément de `docs/finances-architecture.md`, qui couvre l'autre
module à stockage relationnel.

## Où en est le module

| Tranche | Contenu | État |
|---|---|---|
| 0 | Semaine ancrée sur la date du jour, rayon des articles générés, petit-déjeuner masqué par défaut, exécuteur de tests frontend | Livrée |
| 1 | Photos sur le disque, liste de courses concurrente, écran Courses pensé magasin | Livrée |
| 1 bis | Import d'une recette depuis une URL (schema.org/Recipe), portions et temps séparés | Livrée |
| 2 a | Lecture des lignes d'ingrédients, référentiel d'articles, génération avec rapport | Livrée |
| 2 b | Écran de reprise en masse des lignes non reconnues | Livrée |
| 3 a | Semaine lisible sur téléphone : pile de jours, et fenêtre de trois jours | Livrée |
| 3 b | Recopie d'une période sur une autre | Livrée |
| 3 c | Présence des convives, suggestions, anti-répétition | Livrée |
| 4 | Recherche, historique, note, import par texte collé, « j'ai déjà ça » | Livrée (import photo : abandonné, voir plus bas) |
| 5 | Contraintes alimentaires : allergènes affichés, aliments refusés, alertes | Livrée (régimes et substitutions : non faits, voir plus bas) |
| Lot 1 | Exports : carnet en JSON (aller-retour), recette en texte, liste en CSV | Livrée |
| Lot 2 | Tâche « faire les courses », repas à l'agenda | Livrée |
| Lot 3 | Déplacer un repas d'un créneau à l'autre | Livrée |

## Le principe directeur

Le foyer est **un seul document JSON** dans SQLite, exposé par
`GET/PUT /api/state`. Le module Cuisine y reste : quelques centaines de recettes,
un planning glissant et quelques dizaines d'articles ne justifient pas des tables
dédiées, et une archive du répertoire de données demeure une sauvegarde complète.

Deux choses seulement en sortent, chacune pour une raison précise.

### 1. Les octets des fichiers ne sont plus dans le document

Une photo rangée en data-URL dans l'état n'était pas un problème de place, mais
de **débit** : le document entier repart à chaque enregistrement. Trente recettes
photographiées, ce sont plusieurs mégaoctets renvoyés en 4G à chaque coche d'un
article dans un magasin. Le module **Documents** portait exactement la même
dette, soldée depuis (migration 5) : les pièces d'identité et les factures de la
famille voyageaient elles aussi dans chaque enregistrement.

Les octets vivent donc dans le magasin partagé du foyer,
`backend/src/storage/blobs.ts`, extrait des pièces jointes du module Finances :

- **Même répertoire** (`$FOYER_DATA_DIR/pieces`) : une archive de plus à faire, zéro.
- **Adressage par empreinte SHA-256** : la même photo posée deux fois coûte un fichier.
- **Deux tables, un disque** : `fin_attachments` (Finances, propriétaires numérotés)
  et `hh_attachments` (foyer, propriétaires désignés par un identifiant texte comme
  `r7f3a`). Chacune se déclare auprès du magasin par un *détenteur* qui répond à
  deux questions : « ce fichier sert-il encore à quelqu'un ? » et « quels fichiers
  du disque sont orphelins ? ». Un fichier n'est effacé que lorsque plus aucune
  table ne le réclame.
- **Type reconnu d'après les octets**, jamais d'après l'extension. Les photos de
  recettes n'acceptent que des images (`JPEG, PNG, WEBP, GIF, HEIC`), pas un PDF.
- **Ce que chaque propriétaire accepte lui est propre** (`ACCEPTS` dans
  `storage/routes.ts`). Un dossier de famille reçoit un `.odt`, un `.txt` ou un
  tableur : refuser ce que le détecteur ne sait pas nommer laisserait ces
  fichiers en data-URL dans l'état, c'est-à-dire la dette qu'on solde. Ils sont
  donc rangés sous `application/octet-stream`, et c'est le nom conservé avec la
  fiche qui porte l'extension. Le détecteur, lui, ne bouge pas : il sert aussi de
  garde aux pièces du module Finances, où « je ne reconnais pas ces octets » doit
  rester un refus.
- **Ce qu'on ne sait pas afficher part en téléchargement.** `GET /api/files/<id>`
  ne répond `inline` que pour un PDF ou une image ; tout le reste est servi en
  `attachment`. Rendre des octets déposés par un utilisateur dans l'origine de
  l'application serait la porte ouverte à une page déposée en pièce jointe.

Le navigateur ne peut pas afficher `/api/files/3` directement : une balise
`<img>` ne porte pas l'en-tête d'autorisation, et mettre le jeton dans l'URL le
ferait entrer dans l'historique du navigateur. La photo est donc **téléchargée
avec la session** puis exposée en URL d'objet locale (voir `photoUrl` dans
`foyer.store.ts`).

### 2. La liste de courses ne voyage plus dans l'enregistrement du document

C'est le point le plus important du module.

Un `PUT` du document complet, c'est « le dernier arrivé gagne ». Sur une liste de
courses, cela veut dire : votre conjoint coche douze articles au magasin, vous
ajoutez « papier toilette » depuis la maison, votre téléphone renvoie l'état
qu'il a chargé il y a deux heures, et les douze coches disparaissent.

**`PUT /api/state` ignore désormais le champ `shop` et conserve celui du
serveur.** C'est ce qui rend l'écrasement structurellement impossible : un client
périmé ne peut plus transporter la liste, quel que soit son âge.

Les articles se modifient par des opérations ciblées, `POST /api/shopping/ops`.
Deux propriétés portent tout le dispositif :

1. **Une intention, pas une bascule.** L'opération dit « cet article est dans le
   panier », jamais « inverse son état ». Une bascule rejouée après une coupure
   réseau décocherait ; une intention rejouée ne fait rien.
2. **Un identifiant par opération.** Le client le génère, le serveur retient ceux
   qu'il a vus (`hh_shop_ops`). Sans cela, un « ajouter » rejoué ressusciterait un
   article supprimé entre-temps.

Un lot entier tient dans une transaction SQLite : deux téléphones se sérialisent
au lieu de s'écraser.

Côté navigateur, les opérations passent par une **file persistée**
(`localStorage`, clé `foyer.shopQueue`) : les coches faites sans réseau survivent
à un onglet recyclé par iOS et repartent au retour du réseau. L'écran Courses
sonde le serveur toutes les cinq secondes **tant qu'il est visible**, et seulement
là.

Limite connue : l'application n'est pas une *progressive web app*. Si l'onglet est
fermé et rouvert alors qu'il n'y a pas de réseau, la page ne peut pas se charger
du tout. La file, elle, est intacte et repart à la première ouverture avec du
réseau.

## Reprise des ingrédients non reconnus

Le lecteur fait ce qu'il peut avec le français écrit à la main. Ce qui lui
échappe n'est pas une erreur de code : c'est un mot que le foyer emploie et que
la base intégrée ignore (« gomasio », « nouilles soba »). L'écran de reprise
(`shell/repair-modal.ts`, moteur dans `core/ingredient-repair.ts`) donne la vue
d'ensemble et les deux gestes qui la referment.

**Le taux est affiché en tête et bouge à chaque geste.** Sans lui, on répare sans
savoir si l'on avance, et on abandonne au troisième. Il compte les **produits**,
pas les lignes : « thym + laurier » en vaut deux, et compter les lignes ferait
mentir le taux dès qu'une ligne en porte deux.

**Rien n'est rattaché automatiquement.** Un rattachement faux se propage à tout
le carnet et à toutes les listes de courses suivantes sans que personne le
remarque, ce qui est bien pire qu'une ligne restée non reconnue et visible.

Deux gestes, aux conséquences différentes :

| Geste | Ce qu'il écrit | Quand |
|---|---|---|
| **Rattacher** | La forme part en synonyme d'un article connu. Un article de la base intégrée est d'abord **recopié côté foyer** : c'est la seule façon de lui ajouter un synonyme sans toucher à l'application, et une correction du foyer gagne toujours contre une mise à jour. | Quand c'est vraiment le même achat (« gousse d'ail » et « ail »). |
| **Créer l'article** | Un article du foyer, avec son rayon, ses allergènes et son statut de fond de placard. La forme lue part en synonyme si elle diffère du nom choisi. | Quand c'est un produit distinct. |

Le piège du premier geste est **dit dans l'écran** : la liste de courses portera
le nom de l'article choisi, pas la forme rattachée. Rattacher « nouilles soba » à
« pâtes » donne une liste qui annonce « Pâtes 350 g », ce qui trompe en magasin.

Une ligne qui n'est **pas un ingrédient** (un intertitre « pour la sauce : », une
note) remonte quand même, faute de mieux : le lecteur en isole un produit. Aucun
geste n'est inventé pour elle, parce qu'il n'y en a pas de juste ; l'écran nomme
la recette d'où elle vient et l'ouvre d'un toucher, seul endroit où elle se
corrige. Les lignes dont **rien** ne se dégage (« 3 ») sont listées à part, pour
la même raison.

## Qui mange, et pour combien on cuisine

La présence **se déduit de l'emploi du temps** (`core/presence.ts`). Une grille
d'absences tenue à la main dans la fiche membre a existé et a été retirée : le
module Emploi du temps savait déjà que Léa est au collège le mardi midi, et
redemander la même chose ailleurs faisait deux sources de vérité pour un seul
fait, dont la seconde se démodait en silence.

Trois niveaux, chacun l'emportant sur le précédent :

| Niveau | Où | Ce qu'il dit |
|---|---|---|
| Emploi du temps | `SchedSlot.away`, lu par `awayAt()` | « Léa est au collège de 8h20 à 17h45 » |
| Dérogation du créneau | `MealValue.away` | « ce soir-là, Paul mange chez un ami » |
| Couverts posés à la main | `MealValue.pax` | « on est huit, il y a des invités » |

**Cuisine ne lit jamais `sched` directement.** Elle appelle `awayAt(sched, date,
créneau, calendrier)`, qui rend l'ensemble des membres hors du foyer à l'heure de
ce repas. Un créneau ne retire quelqu'un que s'il **couvre** l'heure du repas,
fin exclue : en cas de doute on compte présent, parce que trop de couverts fait
un reste au frigo quand pas assez fait quelqu'un sans rien dans son assiette.
Le détail du modèle est dans [`emploi-du-temps.md`](emploi-du-temps.md).

Les couverts ne sont **plus** un chiffre unique pour la semaine : `buildPlan`
reçoit chaque créneau avec les siens, déjà résolus par l'appelant. Le rapport de
génération annonce tous les nombres qui ont servi (« prévue pour 4, ajustée à 3
puis 2 couverts ») : une même recette peut être planifiée deux fois dans la
semaine avec des tablées différentes, et n'en annoncer qu'une serait un mensonge.

La présence sert aussi aux **alertes** : un plat n'est signalé que s'il gêne
quelqu'un d'attendu ce jour-là. Alerter pour une personne absente est une fausse
alerte, et une de trop suffit à ne plus les lire.

## Suggestions

Aucun appel à un service extérieur, aucun score (`core/suggest.ts`) : de la
rotation, des dates, et ce qui est déjà sur la liste de courses. **Une
suggestion qu'on ne sait pas expliquer ne se discute pas, donc ne se corrige
pas, donc finit ignorée.** Chaque proposition porte ses raisons en toutes
lettres, et le tri suit exactement l'ordre de ces raisons plutôt qu'un total
pondéré : ancienneté d'abord, puis les ingrédients déjà sur la liste, puis la
durée.

Deux choses ne sont jamais proposées, et les deux exclusions sont **dites**
plutôt que silencieuses (écarter sans le dire ferait croire à un carnet plus
pauvre qu'il n'est) :

- une recette servie dans les **quinze derniers jours**, ou déjà planifiée plus
  tard dans la semaine ;
- une recette qui ne convient pas à quelqu'un attendu à ce créneau. C'est
  l'intérêt concret de la présence déduite : le carnet s'ouvre les soirs
  d'absence au lieu de rester fermé toute l'année.

## Retrouver une recette

Une seule ligne de saisie (`core/recipe-search.ts`), pas trois champs. Les
filtres reconnus sont **extraits de la ligne entière** avant tout découpage,
parce que « 30 min » et « 4 étoiles » s'écrivent en deux morceaux ; ce qui reste
est cherché comme du texte, dans le nom, les étiquettes et les **ingrédients
rattachés**, si bien que « pomme de terre » trouve « 4 patates ».

Deux décisions :

- **Ce qui n'est ni durée ni note reste un mot à chercher.** Mieux vaut un
  filtre ignoré qu'un filtre inventé.
- **Une durée demandée écarte les recettes qui ne disent pas la leur.**
  Affirmer qu'une recette sans durée tient en vingt minutes est le genre de
  promesse qui se paie à dix-neuf heures trente.

La note de la famille (1 à 5) pèse dans les suggestions, en **dernier critère** :
une bonne note qui l'emporterait sur « pas faite depuis trois semaines » ferait
manger toujours la même chose.

## Import d'une recette collée en texte

L'import **depuis une photo n'est pas fait**, et ne le sera pas : il demande de
la reconnaissance de caractères, lourde à embarquer en local pour un usage rare,
et interdite à distance par la règle « aucune donnée sortante ». iOS et Android
savent déjà extraire le texte d'une image ; le collage couvre le même besoin en
deux gestes, sans rien installer ni rien envoyer.

Le lecteur (`core/recipe-text.ts`) tourne **dans le navigateur** et remplit le
formulaire, que l'utilisateur relit avant d'enregistrer. Deux lectures :

- **Avec intertitres** (« Ingrédients », « Préparation »), on fait confiance à
  l'auteur : il a dit lui-même où commence quoi.
- **Sans intertitre**, le partage est deviné ligne à ligne, et le lecteur
  **l'annonce** : c'est la lecture qui se trompe le plus.

Un cas ambigu tranché à la vérification : un nom de produit seul en tête de
collage (« Pâtes », « Crêpes ») est bien plus souvent le titre de la recette
qu'un ingrédient. Le critère du titre est donc plus large que celui du corps :
seule une ligne **quantifiée** est refusée comme titre.

## « J'ai déjà ça »

Le brief demandait un stock de placard. Un inventaire complet demande une tenue
quotidienne, et **mal tenu il fait rater des achats**, ce qui est plus grave que
de racheter un paquet de farine. Ce qui est livré ne demande aucune discipline :
au moment du rapport de génération, un geste écarte l'article de cette liste et
retient la date.

- La marque **se périme** au bout de `STOCK_DAYS` (trois semaines) : assez pour
  un paquet de farine, assez court pour qu'un oubli ne fasse pas rater des
  courses tout un mois. L'article revient sans qu'on ait rien à faire.
- La **date est montrée** (« il y a 3 jours »), parce que c'est elle qui permet
  de juger : trois jours pour de la crème et trois semaines pour de la farine ne
  se valent pas, et l'application n'a aucun moyen de le savoir.
- Recocher un article qu'on avait dit avoir **efface sa marque** du même geste :
  on vient de dire qu'on n'en a plus.
- Une marque **datée du futur** (horloge qui recule, état restauré) ne fait rien
  disparaître.

## Contraintes alimentaires

Tout est **dérivé**, rien n'est saisi deux fois (`core/diet.ts`) : les allergènes
d'une recette viennent des articles que le lecteur a su rattacher, et une alerte
naît de la rencontre entre ces articles et ce qu'un membre a déclaré
(`Member.allerg`, `Member.refuse`). C'est le premier consommateur des allergènes
du référentiel, qui étaient stockés depuis la tranche 2 a sans que rien ne les lise.

**La règle qui gouverne tout : l'absence d'alerte ne prouve rien.** Une ligne
d'ingrédient non rattachée ne porte aucun allergène, donc ne déclenche aucune
alerte, alors qu'elle peut parfaitement en contenir. Chaque résultat porte le
nombre de lignes non vérifiées, et l'interface a le **devoir** de le montrer :
une alerte silencieuse qu'on croit exhaustive est plus dangereuse que pas
d'alerte du tout. La fiche d'une recette le dit, le formulaire d'un membre aussi.

Trois autres décisions :

- **Un membre sans contrainte déclarée ne produit jamais de conflit.** Ne rien
  savoir de quelqu'un n'est pas une raison de l'alerter. Tant que personne n'a
  rien déclaré, l'application n'affiche rien de tout cela.
- **Un plat en texte libre ne prétend rien.** Il n'a pas d'ingrédients à lire.
- **Le référentiel est prudent, et cette prudence se corrige.** `chocolat` porte
  « lait » parce que le chocolat pâtissier en contient presque toujours ; sur une
  recette explicitement sans lait, l'alerte est de trop. Elle se retire en créant
  l'article du foyer qui convient (écran de reprise), sans toucher à l'application.

Deux choses du plan d'origine **ne sont pas faites**, et leurs raisons sont dans
« À savoir pour la suite » : les régimes et les substitutions. Les livrer sur le
référentiel actuel aurait produit des faux négatifs, ce que ce module refuse.

## Ce que voit l'API

| Route | Rôle |
|---|---|
| `GET /api/shopping?since=<version>` | Instantané de la liste. Répond `{ version, unchanged: true }` quand rien n'a bougé. |
| `POST /api/shopping/ops` | Applique un lot (`add`, `set-state`, `edit`, `remove`). Rend les articles, la version, les opérations retenues et celles écartées avec leur raison. |
| `POST /api/files?owner=recipe\|document&id=<id>&filename=<nom>` | Range un fichier. Corps : les octets bruts. |
| `GET /api/files/<id>` | Sert le fichier, en flux (`inline` pour un PDF ou une image, `attachment` sinon). |
| `DELETE /api/files/<id>` | Rend les octets au disque. Appelé à la suppression d'une fiche : la copie d'une pièce d'identité n'a pas à attendre le ménage du prochain démarrage. |
| `GET /api/finances/attachments-check` | Diagnostic du magasin, désormais **pour les deux tables**. Chaque ligne signalée porte son détenteur. |

Une opération écartée l'est **définitivement**, pas différée : le client la retire
de sa file, sinon il la rejouerait sans fin. La raison est affichée à
l'utilisateur et journalisée côté serveur.

## Import d'une recette depuis une URL

C'est la **seule sortie réseau** du module, et elle obéit aux trois conditions
posées au départ : déclenchée par un geste explicite, journalisée, coupable par
configuration (`FOYER_RECIPE_IMPORT=false`).

### Pourquoi un lecteur générique et pas un lecteur Marmiton

La plupart des sites de cuisine francophones publient leur recette en **JSON-LD
`schema.org/Recipe`** dans la page, pour que les moteurs de recherche affichent
une fiche. Foyer lit ce balisage, et rien d'autre. Conséquences :

- un seul lecteur couvre Marmiton, 750g, Cuisine AZ et les blogs sous WordPress
  avec un greffon recette ;
- il ne casse pas quand l'un d'eux refait son habillage, puisqu'il ne regarde
  jamais leur HTML de présentation ;
- il n'y a **pas de recherche par mots-clés**, et c'est délibéré : interroger le
  moteur d'un site voudrait dire analyser sa page de résultats, donc du code
  fragile propre à un site, et un parcours de son catalogue plutôt qu'un import
  d'une page choisie. On cherche dans le navigateur, on colle le lien.

### Ce qui est importé, et ce qui ne l'est pas

| Importé | Laissé de côté, et pourquoi |
|---|---|
| Titre (débarrassé des appâts à moteur de recherche) | **Calories et valeurs nutritionnelles** : le foyer ne fait pas de suivi nutritionnel |
| Portions, temps de préparation, temps de cuisson | **Note du site** : 4,9/5 sur Marmiton n'est pas la note de la famille |
| Lignes d'ingrédients, telles qu'écrites | **Régimes déclarés, catégorie, mots-clés** : aucun écran ne les lit encore |
| Étapes, avec le titre que le site leur donne | **Auteur** : la source suffit à retrouver la page |
| Photo (rangée dans le magasin d'octets) | |

Ce qui n'est pas compris est **signalé, jamais inventé** : portions absentes,
temps non détaillés, ingrédients introuvables produisent un avertissement affiché
dans le formulaire. La relecture du formulaire avant enregistrement tient lieu
d'écran de reprise manuelle.

### Ce que « générique » veut dire en pratique

Les sites publient la même norme de façons différentes, et le lecteur absorbe
ces écarts. Constatés sur les pages du jeu de test :

| Écart | Marmiton | Journal des Femmes | CuisineAZ |
|---|---|---|---|
| Durées | `PT15M` | `PT0H05M` | `PT10M` |
| Portions | « 4 personnes » | « 6 personnes » | « 6 » |
| Image | tableau, JPEG et WebP mêlés | un `ImageObject` seul | tableau en `.jpeg` |
| Étapes | `text` seul | `name` **et** `text` | `name` **et** `text` |
| Ingrédients | « 100 g **de** gruyère râpé » | « 100 g gruyère » | « 150 g Gruyère râpé », « 5 Courgette(s) » |

Le titre d'étape est conservé devant la consigne (« Cuisson des courgettes :
Faites-les cuire… ») : c'est un repère utile quand on cuisine en suivant l'écran.
Il est laissé de côté quand il répète le début de la consigne ou qu'il est en
réalité la consigne entière.

### Rien d'autre que les champs de recette

Une page publie souvent, dans le **même bloc JSON-LD**, des choses qui ne sont pas
la recette : la fiche de l'auteur, une vidéo, des commentaires d'internautes. Un
de ceux du jeu de test se termine par un lien publicitaire en HTML.

Le lecteur ne va chercher que les champs déclarés de la recette. Ni les
commentaires, ni les avis, ni les descriptions d'auteur n'atteignent la fiche, et
un test l'exige explicitement sur un nœud hostile. Côté écran, les textes sont
rendus par interpolation Angular, donc échappés : le dépôt n'utilise nulle part
`innerHTML` ni `bypassSecurityTrust`.

### Le temps de repos, que le standard ne sait pas dire

`schema.org` n'a pas de champ pour le repos. Un tiramisu qui doit passer 24 heures
au réfrigérateur s'annonce « 25 min », et le repos n'existe que dans la phrase
d'une étape. Quelqu'un qui le planifie pour le dîner de samedi s'y prend le
samedi après-midi, et se trompe d'un jour.

L'import repère donc ces phrases et les **signale telles qu'elles sont écrites**,
sans en tirer de donnée. Il faut un mot de repos (réfrigérateur, reposer, mariner,
lever, la veille) **et** une durée longue (heures, jours, une nuit) dans la même
phrase : « laisser reposer 10 min » ne change pas un planning, « au réfrigérateur
24 heures » si. Une cuisson longue au four ne déclenche rien.

L'étiquette « à préparer la veille » du modèle cible, posée à la main, restera le
bon endroit pour en faire quelque chose d'exploitable.

### Les gardes de la sortie réseau

Le serveur va chercher une adresse fournie par un utilisateur, sur un réseau
domestique où vivent un hyperviseur, un routeur et d'autres services. Trois
protections, testées dans `backend/test/recipe-fetch.test.ts` :

1. **Adresses privées refusées**, après résolution DNS. Vérifier le nom ne
   suffirait pas : rien n'empêche un domaine public de pointer sur 192.168.1.1.
   Sont bloqués la boucle locale, les plages du RFC 1918, le lien-local (dont
   `169.254.169.254`, les métadonnées d'hébergeur), le CGNAT et le multicast, en
   IPv4 comme en IPv6, y compris l'IPv4 encapsulée (`::ffff:127.0.0.1`).
2. **Redirections suivies une par une**, chaque étape étant revalidée. Une page
   publique qui redirige vers `127.0.0.1` est le contournement classique.
3. **Taille et durée bornées** : 3 Mo, 12 secondes, 4 redirections. Le corps est
   lu par morceaux et coupé net, un `await res.text()` avalerait tout.

S'y ajoutent : `https` et `http` seuls, refus des adresses portant un
identifiant, et une limitation à 30 imports par tranche de 5 minutes.

### Une leçon payée cher : les en-têtes ne transportent que des octets

Le premier import en production a échoué avec « le site est injoignable depuis le
serveur ». Le réseau allait très bien : le `User-Agent` du code portait une
**apostrophe typographique** « ’ » (U+2019), visuellement identique à « ' » mais
valant 8217. `fetch` refusait de construire la requête, sans jamais toucher au
réseau, et l'erreur remontait déguisée en panne réseau. **Aucun import n'avait
jamais pu aboutir, sur aucun site.**

Trois choses en sont sorties, dans `backend/src/headers.ts` :

- **Toute valeur d'en-tête construite à partir d'un texte passe par `headerSafe`**,
  qui la replie en ASCII. Le `User-Agent` est en ASCII pur, par principe : un
  en-tête est un détail de protocole, pas un texte d'interface.
- **Les noms de fichiers accentués voyagent en RFC 6266.** Même sous 255, l'accent
  ne survit pas : « à » part en octet 0xE0 et revient décodé en UTF-8, donc
  « Tarte ï¿½ l'oignon ». `contentDisposition()` émet les deux formes, `filename`
  replié et `filename*=UTF-8''…` encodé, ce que les navigateurs préfèrent. Cela
  valait aussi pour les pièces jointes du module Finances, corrigées au passage.
- **Une erreur sans `cause` n'est plus présentée comme une panne réseau.** Node
  place la raison des vraies pannes dans `error.cause` ; son absence signale que
  la requête n'a pas pu être émise, ce qui est un défaut de Foyer. Le message le
  dit désormais.

Les tests de route bouchonnent `fetch` pour rester sans appel sortant, et ne
pouvaient donc pas voir ce défaut. `backend/test/headers.test.ts` exerce le vrai
`fetch` et un vrai `res.setHeader` contre un serveur local, dans les deux sens.

### Exploitation

```bash
# Suivre les imports (chacun laisse une trace)
journalctl -u foyer -f | grep '\[foyer\] Recettes'

# Couper toute sortie réseau du module, LXC
echo 'FOYER_RECIPE_IMPORT=false' >> /etc/foyer/foyer.env && systemctl restart foyer

# Docker : la même variable dans docker-compose.yml
```

Sortie attendue d'un import réussi :

```
[foyer] Recettes : import de https://www.marmiton.org/... → « Gratin de courgettes rapide » (8 ingrédients, 7 étapes, photo).
```

Un refus est journalisé avec sa raison, et le même message s'affiche à
l'utilisateur : pas de mystère d'un côté ni de l'autre.

## Modèle de données

```ts
MealValue { items: MealItem[], pax? }         // un créneau porte plusieurs plats, et ses couverts
MealItem  { rid? } | { text? }                // recette du carnet, ou texte libre
Aisle    { id, name, color, position, kind? } // position = ordre des allées, kind = type de rayon
Article  { key, name, syn[], rayon, pantry?, allerg? }   // corrections du foyer seulement
ShopItem { id, name, qty, aisleId, state, listId, by?, at?, art?, gen? }
ShopState = 'a-prendre' | 'panier' | 'indisponible'
Recipe   { id, name, level, color, photoId?, portions?, prepMin?, cookMin?, source?, ingr: string[], steps: string[] }
```

Ce qui a changé et pourquoi :

- **`cat` → `aisleId`.** Le rayon était désigné par son **nom**. Renommer un rayon
  demandait de rattraper tous les articles, et un nom ne correspondant à aucun
  rayon produisait un groupe fantôme que l'interface ne savait ni renommer ni
  supprimer. C'est exactement ce que faisait l'ancienne génération de liste.
- **`done` → `state`.** En magasin, « je ne l'ai pas trouvé » n'est ni « à
  prendre » ni « pris ».
- **`by` / `at`.** Qui a coché et quand, pour rendre lisible ce que l'autre
  téléphone vient de faire.
- **`photo` → `photoId`.** Voir plus haut.
- **`time` → `prepMin` / `cookMin` / `portions`.** L'ancien champ était un texte
  libre unique (« 45 min ») qui ne disait même pas s'il valait la préparation, la
  cuisson ou le total. La mise à l'échelle des courses (recette pour 4, planning
  à 6) a besoin d'un nombre de portions, et l'import en fournit un. La migration
  reprend la durée en **préparation** : c'est la seule lecture qui ne fabrique
  pas une cuisson qui n'a jamais existé, et une durée illisible laisse les champs
  vides en le signalant.
- **`source`.** Page d'origine d'une recette importée, pour pouvoir y retourner.
- **Un repas devient une liste de plats.** Un créneau ne portait qu'un plat, ce
  qui interdisait entrée, plat et dessert. Il porte maintenant une liste
  ordonnée : **l'ordre du service tient lieu d'étiquette**, une taxonomie fixe
  (entrée/plat/dessert) laissant dehors l'apéritif, le fromage et
  l'accompagnement. L'enveloppe `MealValue` existe pour ce qu'elle accueillera
  ensuite sans changer de forme une seconde fois : le nombre de couverts réel et
  les convives absents, prévus au modèle cible.

  Dans la modale, un tap sur une recette l'ajoute au menu, un second l'en retire.
  La génération de la liste de courses prend les ingrédients de **tous** les
  plats du créneau : une entrée et un dessert en ont autant besoin que le plat.

## Les ingrédients : lus, jamais réécrits

`Recipe.ingr` **reste un tableau de chaînes**, et c'est délibéré.

L'évidence aurait été de convertir chaque ligne en objet structuré au moment de
l'import, une bonne fois pour toutes. C'est le choix qui a été écarté, pour trois
raisons :

1. **Aucune migration, donc aucune perte possible.** Le texte saisi reste la
   seule vérité. Une analyse ratée n'abîme rien, puisqu'elle n'écrit rien.
2. **Une recette importée hier profite de l'analyse d'aujourd'hui.** L'analyse
   étant rejouée à chaque besoin, améliorer le lecteur améliore rétroactivement
   tout le carnet, sans rien retraiter.
3. **Une correction se fait dans le référentiel, pas dans la recette.** Apprendre
   que « émincé 100% végétal ACCRO » est du tofu corrige toutes les recettes d'un
   coup, y compris celles qui n'existent pas encore. Ligne à ligne, la même
   correction serait à refaire indéfiniment.

Le coût est un calcul refait à chaque génération : 165 lignes analysées en
quelques millisecondes, sans commune mesure avec le risque évité.

### Le référentiel d'articles, à deux étages

- **Une base intégrée au code** (`frontend/src/app/core/articles.ts`), environ
  200 articles français avec leur rayon, leur statut de fond de placard et leurs
  allergènes. Elle n'est **pas** copiée dans le document : elle s'enrichit à
  chaque version sans migration et ne pèse rien dans l'état.
- **`state.articles`**, qui ne contient que ce que la base ignore ou nomme mal.
  Il gagne toujours contre elle : une correction faite à la main ne doit jamais
  être défaite par une mise à jour de l'application.

Le rayon d'un article est un **type** (`legumes`, `viande`, `frais`, `surgele`,
`boulangerie`, `epicerie`, `boisson`, `entretien`), pas un identifiant de rayon.
Le foyer renomme et réordonne ses rayons librement ; `Aisle.kind` fait le lien,
et à défaut le nom du rayon sert de repli. Un type sans rayon correspondant
retombe sur son voisin le plus proche (la boucherie va au frais), jamais dans
« À trier ».

### Ce que le lecteur sait faire, et ce qu'il ne sait pas

Mesuré sur le carnet réel du foyer (18 recettes importées de Marmiton, 165
lignes, `fixtures/cuisine-reelle.json`) : **164 lignes sur 165 rattachées à un
article**. La seule qui reste est « parures de légumes (carottes, navet,
courgettes) », qui désigne des épluchures : il n'y a rien à mettre au caddie.

La garantie qui prime sur ce taux : **aucune ligne n'est perdue**. Ce qui n'est
pas compris part quand même aux courses, avec son texte d'origine, et figure au
rapport comme non reconnu. Ne pas savoir lire une ligne n'est pas une raison de
ne pas acheter l'ingrédient.

Deux limites connues, assumées :

- **Les jaunes et les blancs comptent double.** Une recette demandant
  « 3 jaunes d'oeuf » et « 3 blancs d'oeuf » fait acheter 6 oeufs au lieu de 3.
  Acheter trop d'oeufs coûte moins cher que d'en manquer.
- **Les unités non convertibles restent côte à côte.** « 2 poignées + 150 g »
  d'emmental n'est pas additionné : la densité manque, et un total faux ne se
  verrait jamais.

### La génération rend des comptes avant d'écrire

Le bouton n'écrit plus rien directement. Il calcule et affiche : à ajouter, à
compléter, à retirer, écarté comme fond de placard, déjà sur la liste, non
reconnu. Chaque ligne dit d'où elle vient (quelle recette, quelle ligne exacte).
C'est le seul moment où une erreur de lecture se rattrape sans avoir à défaire
des courses déjà commencées.

Une régénération ne touche **que ce qu'elle a elle-même écrit** (`ShopItem.gen`) :

| Article | Régénération |
|---|---|
| Ajouté à la main | jamais touché, et jamais dupliqué |
| Généré, encore demandé, quantité changée | quantité mise à jour |
| Généré, plus demandé, jamais coché | retiré |
| Généré, déjà au panier ou marqué introuvable | conservé, quelqu'un s'en est occupé |

Elle est donc rejouable sans crainte en cours de semaine, y compris depuis un
téléphone déjà dans le magasin.

### Les couverts

Les quantités suivent le nombre de couverts : une recette pour 6 servie à 4 voit
ses nombres multipliés par 4/6. Par défaut, les couverts valent la taille du
foyer ; la modale d'un créneau permet d'y déroger, et **seule la dérogation est
enregistrée** (`MealValue.pax`), pour qu'un chiffre recopié partout ne se périme
pas au premier changement de famille. Une recette sans portions connues n'est pas
mise à l'échelle, et le rapport le dit.

## Le planning : deux fenêtres, deux mises en page

Deux réglages indépendants gouvernent cet écran, et il faut les distinguer.

**Combien de jours** : trois ou sept, au choix de l'utilisateur. Sept jours en
pile font deux écrans de téléphone à faire défiler ; trois jours en font un seul,
et c'est l'horizon utile un soir de semaine. Le réglage est vide par défaut et se
résout alors automatiquement : **trois jours sur téléphone, la semaine sur grand
écran**. Dès que l'utilisateur touche le sélecteur, son choix tient.

**Grille ou pile** : la grille jours en colonnes demandait 900 px de large, donc
sur téléphone elle défilait horizontalement, ce qui est inutilisable d'une main.
**C'est la largeur réellement disponible qui tranche**, pas celle de la fenêtre :
entre 900 et 1100 px la barre latérale occupe la place, et la grille défilait
encore. Le composant mesure son propre hôte (`ResizeObserver`, seuil 760 px)
plutôt que de se fier au point de bascule du chrome.

En pile, chaque jour est une carte et chaque créneau une ligne de 52 px, visable
au pouce. Les jours passés restent consultables mais s'effacent, et la semaine
courante s'ouvre sur le jour même : « qu'est-ce qu'on mange ce soir » ne doit pas
demander de faire défiler quatre jours révolus.

L'ancrage est **un jour**, plus un décalage de semaines : une fenêtre de trois
jours n'a pas de numéro de semaine, et la navigation avance d'autant de jours que
la fenêtre en montre.

### Recopier une période sur une autre

Une semaine ressemble à la précédente, à deux ou trois plats près. Rouvrir
quatorze créneaux un par un décourage de tenir le planning, et un planning qu'on
ne tient pas ne sert plus à faire les courses.

La recopie va toujours **vers la période affichée** : on se place là où l'on veut
des repas, puis on choisit d'où les prendre parmi les quatre périodes
précédentes, chacune annoncée avec le nombre de repas qu'elle contient. Recopier
vers l'avant se fait donc en se plaçant sur la semaine à remplir, ce qui évite
d'avoir à choisir une direction en plus d'une source.

Deux modes, et la différence n'est pas cosmétique :

| Mode | Effet | Risque |
|---|---|---|
| Compléter | ne remplit que les créneaux vides | aucun, rien n'est détruit |
| Remplacer | la période visée devient la copie exacte de la source, **trous compris** | destructeur, annoncé en rouge |

Le rapport est affiché avant d'écrire, comme pour les courses, et le bouton
change de libellé et de couleur quand la copie détruit quelque chose.

Deux détails que les tests verrouillent, parce qu'ils ne se voient pas à
l'usage :

- **Les repas sont dupliqués en profondeur.** Un partage de référence ferait
  qu'éditer une semaine change l'autre, sans aucun signe à l'écran.
- **Un créneau qui porte déjà le même menu n'est pas annoncé comme écrasé.** Sans
  cela, recopier deux fois de suite affiche « 10 créneaux seront écrasés » alors
  que rien ne changerait, et une alerte qui crie pour rien finit par ne plus être
  lue.

Seuls les créneaux affichés sont recopiés : recopier un petit-déjeuner alors que
la ligne est masquée créerait des repas que personne ne peut voir ni retirer.

**La génération des courses suit la fenêtre affichée.** En vue trois jours, le
bouton dit « Courses de ces 3 jours » et ne prend que ces repas ; en vue semaine,
les sept. Sur la semaine réelle du foyer, cela fait 13 articles contre 34 : c'est
la différence entre faire un saut au magasin et faire les courses. Les jours sont
passés explicitement à `prepareList`, et jamais déduits de ce que l'écran avait
en mémoire : un bouton ailleurs (l'accueil, l'écran Courses) demande toujours la
semaine en cours, quelle que soit la fenêtre laissée sur le planning.

Un piège qui a coûté une passe de vérification : l'hôte d'un composant Angular
est **`inline` par défaut**, donc mesuré à zéro. Sans `:host { display: block }`,
la bascule choisissait la pile à toutes les largeurs, y compris sur grand écran.

## Sortir les données, et les faire revenir

Trois formats, trois usages sans rapport, et une seule règle commune : ce qui
sort doit pouvoir revenir, ou bien être lisible par un humain.

**Le carnet en JSON** (`foyer.recettes`, version 1) transporte les recettes **et
leurs photos**, en base64. Sans les photos ce ne serait pas une sauvegarde : les
octets vivent sur le disque du serveur, qu'un export du document ne contient pas.
Le fichier porte son format et sa version, pour qu'un fichier étranger soit
refusé avec une phrase claire plutôt qu'importé de travers.

À l'import, une recette déjà présente est reconnue à **son identifiant** et
laissée tranquille : réimporter deux fois la même sauvegarde ne duplique rien,
sans quoi la sauvegarde deviendrait un piège, relue par précaution et doublant le
carnet. Une entrée abîmée est écartée avec sa raison, et **le reste du fichier
passe quand même** : un import tout ou rien perdrait dix-sept recettes pour une
ligne fautive. Une photo qui ne remonte pas ne fait pas perdre sa recette.

Le rapport s'affiche avant que quoi que ce soit ne soit créé, comme pour les
courses et la recopie.

**Une recette en texte** part dans le presse-papier, prête à être collée dans un
message. Le presse-papier n'existe pas en HTTP simple : on retombe alors sur un
fichier `.txt`, plutôt que d'échouer sans rien dire.

**La liste en CSV** sort dans l'ordre des allées, séparée par des
points-virgules (ce qu'attend un tableur français, la virgule y séparant les
décimales) et précédée d'un BOM UTF-8, sans lequel « Épicerie » s'ouvre en
« Ã‰picerie ». Les guillemets et points-virgules d'un nom d'article sont
échappés : « lardons "fumés"; 200 g » décalerait sinon toutes les colonnes.

## Déplacer un repas

Le gratin passe de mardi à jeudi : c'est le geste le plus courant après la
recopie, et il fallait retirer le repas d'un créneau pour le recomposer dans
l'autre, en perdant les couverts au passage.

**Un créneau occupé échange son repas plutôt que d'être écrasé.** Un déplacement
n'a aucune raison de détruire, et l'échange est presque toujours ce qu'on
voulait.

**L'événement d'agenda suit son repas**, jour, heure et titre. Sans cela un dîner
déplacé resterait annoncé au mauvais jour, ce qui est pire que pas d'agenda du
tout : c'est précisément là que quelqu'un se fie au calendrier. Le titre est
recomposé parce qu'il nomme le créneau (« Dîner : … ») ; le laisser tel quel
après un passage de midi au soir écrirait un mensonge.

Deux gestes, selon l'écran. Sur grand écran, le **glisser-déposer** dans la
grille, le créneau visé s'éclairant au survol. Sur téléphone, un bouton
**« Déplacer »** ouvre la liste des créneaux affichés, chacun annoncé avec ce
qu'il porte déjà : glisser au doigt dans une liste qui défile se rate une fois
sur trois et déplace le mauvais repas.

La modale du repas s'efface pendant ce choix. Deux modales empilées se
recouvrent, et les clics partent dans celle du dessus : le premier essai de
déplacement ne faisait donc rien du tout, sans le moindre message.

## Les deux liens avec le reste du foyer

Le module Cuisine vivait à côté des autres sans jamais leur parler. Deux liens le
rattachent, choisis parce qu'ils correspondent à des gestes réels : on fait les
courses, et on reçoit.

**La tâche « faire les courses »** (`TaskItem.shopListId`) ouvre sa liste et
affiche le nombre d'articles restant à prendre. Elle appartient ensuite au foyer :
personne ne la recrée, ne la coche ni ne la supprime à sa place. C'est un
raccourci, **pas un miroir de la liste** ; le module Finances suit d'ailleurs la
même règle avec ses tâches d'échéance. Rappuyer sur le bouton n'en crée pas une
seconde, il mène à celle qui existe.

**Le repas à l'agenda** (`EventItem.mealKey`) rend un repas visible à ceux qui ne
regardent que le calendrier, ce qui est le cas quand on reçoit. Le bouton
enregistre le repas **et** crée l'événement : les deux vont ensemble, un
événement décrivant un repas non enregistré mentirait dès la modale refermée.
L'heure vient du créneau (`MEAL_SLOTS[].at`), le titre nomme le menu, et les
couverts n'y figurent que s'ils ont été précisés.

`mealKey` sert deux fois, et c'est ce qui justifie de le stocker : rappuyer met
l'événement à jour au lieu d'en créer un second, et **retirer le repas retire son
événement**, un dîner annulé qui resterait à l'agenda étant pire que pas
d'événement du tout.

## Migrations du document d'état

Le document est migré par son propre jeu de transformations versionnées
(`backend/src/state/migrations.ts`), appliquées au démarrage, la version atteinte
étant retenue dans `hh_meta.state_version`.

| Version | Effet |
|---|---|
| 1 | Photos de recettes sorties du document vers le disque |
| 2 | Rayon par identifiant, rang des rayons, état à trois valeurs |
| 3 | Recettes : portions et temps séparés, à la place du texte libre |
| 4 | Planning : plusieurs plats par créneau |

Trois règles, tenues par des tests (`backend/test/state-migrations.test.ts`) :

- **Rejouable.** Chaque migration ne réagit qu'à l'ancienne forme. La relancer sur
  des données déjà migrées ne fait rien.
- **Réversible.** Le document d'origine est écrit dans `$FOYER_DATA_DIR/backups/`
  **avant** la première transformation. Voir la procédure ci-dessous.
- **Sans perte.** Une valeur non convertible est conservée telle quelle. Une photo
  illisible reste dans le document, avec un message au démarrage ; un rayon
  fantôme est **recréé** plutôt que l'article reclassé ailleurs.

### Sauvegarde avant mise à jour

À faire une fois, avant de déployer la tranche 1 sur une base qui contient déjà
des recettes.

```bash
# LXC natif : arrêt bref, archive complète du dossier de données
systemctl stop foyer
tar czf /root/foyer-avant-cuisine-$(date +%F).tar.gz -C /var/lib foyer
systemctl start foyer

# Docker : instantané cohérent sans arrêt de service
docker compose exec -T foyer sqlite3 /data/foyer.db ".backup '/data/avant-cuisine.db'"
docker compose cp foyer:/data ./foyer-data-$(date +%F)
```

### Vérifier que la migration s'est bien passée

```bash
# LXC
journalctl -u foyer -n 50 --no-pager | grep '\[foyer\] État'

# Docker
docker compose logs --tail=50 foyer | grep '\[foyer\] État'
```

Sortie attendue, du genre :

```
[foyer] État : migration 1 appliquée (photos de recettes rangées sur le disque).
[foyer] État : migration 2 appliquée (liste de courses : rayon par identifiant et état à trois valeurs).
[foyer] État : migration 5 appliquée (documents rangés sur le disque).
[foyer] État : 4 photo(s) de recette déplacée(s) hors du document.
[foyer] État : 12 document(s) déplacé(s) hors du document d'état.
[foyer] État : Rayon(s) recréé(s) depuis des articles orphelins : Depuis le planning repas.
[foyer] État : document d'origine sauvegardé dans /var/lib/foyer/backups/state-avant-migration-v0-2026-08-21T01-13-07-630Z.json
```

Un message `document(s) illisible(s)` **nomme** les fiches concernées : leurs
octets restent dans l'état et continuent d'y peser. Rouvrez la fiche dans
Documents et reposez le fichier, c'est la seule reprise possible.

Un message `photo(s) de recette illisible(s)` signale des fiches à reprendre à la
main : rouvrez la recette et reposez la photo. Rien n'a été effacé.

### Revenir en arrière

La migration est rejouable, donc un simple retour de version applicative ne
suffit pas : le document est déjà à la nouvelle forme. Pour revenir réellement,
remettez le document sauvegardé et remettez le compteur à zéro.

```bash
systemctl stop foyer
DB=/var/lib/foyer/foyer.db
SAVE=/var/lib/foyer/backups/state-avant-migration-v0-XXXX.json   # celui du journal

# Le document d'origine reprend sa place, et la version repart de zéro.
sqlite3 "$DB" "UPDATE household SET state = readfile('$SAVE') WHERE id = 1;"
sqlite3 "$DB" "DELETE FROM hh_meta WHERE key = 'state_version';"

systemctl start foyer
```

Attention : au prochain démarrage d'une version qui porte ces migrations, elles
se rejoueront. Pour rester en arrière, redéployez d'abord la version applicative
précédente. Les photos déjà rangées sur le disque restent en place ; elles seront
simplement signalées comme non référencées au démarrage, sans être supprimées.

## Exploitation courante

### Fichiers du magasin

```bash
# Combien de fichiers, quelle place
find /var/lib/foyer/pieces -type f | wc -l
du -sh /var/lib/foyer/pieces

# Diagnostic base contre disque, dans les deux sens (rien n'est supprimé)
journalctl -u foyer -n 100 --no-pager | grep '\[foyer\] Fichiers'
```

Deux écarts possibles, et ce qu'ils veulent dire :

- **Fiches sans fichier sur le disque.** Un fichier manque. Restaurez le
  répertoire `pieces` depuis une sauvegarde, ou reposez la photo depuis
  l'application. Le message nomme un exemple.
- **Fichiers que la base ne référence plus.** Sans danger. Ils sont retirés au
  démarrage suivant pour les photos de recettes ; s'ils persistent, ils viennent
  d'une restauration partielle.

Nettoyage manuel, si vous voulez récupérer la place tout de suite. **Ne le faites
qu'après avoir vérifié qu'aucune fiche ne les réclame** (le message de démarrage
le dit) :

```bash
systemctl stop foyer
# Liste ce qui serait effacé, sans rien effacer
sqlite3 /var/lib/foyer/foyer.db \
  "SELECT rel_path FROM fin_attachments UNION SELECT rel_path FROM hh_attachments" \
  > /tmp/references.txt
find /var/lib/foyer/pieces -type f -printf '%P\n' | grep -vxF -f /tmp/references.txt
systemctl start foyer
```

### Journal des opérations de courses

`hh_shop_ops` est une **mémoire courte contre les rejeux**, pas un historique :
elle est élaguée au-delà de 2000 lignes. Rien à y faire en exploitation. Pour
vérifier son état :

```bash
sqlite3 /var/lib/foyer/foyer.db "SELECT COUNT(*) FROM hh_shop_ops;"
```

### Un article n'arrive pas dans la liste

Le serveur journalise toute opération écartée avec sa raison :

```bash
journalctl -u foyer -f | grep '\[foyer\] Courses'
```

Les raisons possibles : liste ou rayon supprimé entre-temps, article sans nom,
état inconnu. L'utilisateur voit le même message dans l'application.

## Tests

Tout ce qui peut se tromper en silence est couvert. Une erreur d'agrégation ou de
concurrence ne plante pas : elle fait perdre une coche ou acheter trois kilos de
farine.

| Fichier | Ce qu'il garantit |
|---|---|
| `backend/test/shopping-ops.test.ts` | Rejeu, doublons, deux téléphones simultanés, opérations invalides écartées sans bloquer le lot |
| `backend/test/shopping-repo.test.ts` | Transaction tout ou rien, journal persistant, un `PUT` périmé n'emporte pas la liste |
| `backend/test/state-migrations.test.ts` | Rejouabilité, aucune perte, sauvegarde écrite avant transformation |
| `backend/test/household-files.test.ts` | Déduplication entre les deux tables, balayage des orphelins, cohabitation photos de recettes et documents |
| `backend/test/files-routes.test.ts` | Surface HTTP des fichiers : ce que chaque propriétaire accepte, `inline` contre `attachment`, suppression qui n'emporte pas les octets d'un voisin |
| `backend/test/recipe-import.test.ts` | Lecture du JSON-LD sur une vraie page Marmiton, et sur les formes tordues du standard |
| `backend/test/recipe-fetch.test.ts` | Refus des adresses locales, des protocoles hors web, interrupteur de configuration |
| `backend/test/recipe-routes.test.ts` | Import bout en bout avec le réseau bouchonné : photo, avertissements, refus |
| `backend/test/headers.test.ts` | Valeurs d'en-tête émises et reçues, contre un vrai serveur, sans bouchon |
| `frontend/src/app/core/recipe-search.test.ts` | Filtres lus sur la ligne entière, durée qui écarte l'inconnu, ingrédients rattachés cherchés |
| `frontend/src/app/core/recipe-text.test.ts` | Lecture avec et sans intertitres, puces et numéros retirés, ce qui manque nommé |
| `frontend/src/app/core/presence.test.ts` | Les trois niveaux de couverts, l'absence par défaut inexistante, le créneau vidé qui compte quand même un couvert |
| `frontend/src/app/core/suggest.test.ts` | Fenêtre d'anti-répétition au jour près, raisons affichées, exclusions dites, tri sans score |
| `frontend/src/app/core/diet.test.ts` | Ce qui doit alerter, ce qui ne doit surtout pas, et ce que le moteur avoue ne pas avoir vérifié |
| `frontend/src/app/core/ingredient-repair.test.ts` | Regroupement des formes, refus de deviner, article de la base jamais écrasé, et le carnet réel qui atteint 100 % une fois repris |
| `frontend/src/app/core/helpers.test.ts` | Semaine ancrée sur le jour, lundi en tête, changements d'heure |

```bash
cd backend  && npm test
cd frontend && npm test
```

## À savoir pour la suite

- La limite `express.json()` sur `/api/state` est passée de 15 Mo à **4 Mo**,
  maintenant que plus aucun octet de fichier ne transite par le document. Un
  refus renvoie un message qui nomme la cause probable (une pièce que la
  migration n'a pas su décoder) plutôt qu'une page HTML d'Express.
- Le lecteur d'ingrédients n'a été mesuré que sur des recettes **importées**,
  dont les lignes sont régulières. Il devra être éprouvé sur des fiches saisies à
  la main, qui le sont beaucoup moins ; le corpus de mesure
  (`fixtures/cuisine-reelle.json`) est fait pour grossir dans ce sens.
- Le lecteur n'a été **réglé** que sur des recettes importées, dont les lignes
  sont régulières. L'écran de reprise permet de vivre avec ses manques, il ne les
  corrige pas : ce qui rendra le lecteur meilleur, c'est un corpus de fiches
  saisies à la main, que `fixtures/cuisine-reelle.json` est fait pour accueillir.
- Les **régimes** (végétarien, sans porc) ne sont pas faits, et pas par oubli :
  le rayon est une **allée de magasin**, pas une catégorie d'aliment. Poisson et
  crevettes sont rangés en « Boucherie », thon et sardines en « Épicerie », et
  `bouillon` porte « bouillon de volaille » en synonyme d'un article générique.
  Un drapeau « végétarien » posé sur ce référentiel produirait des faux
  négatifs, c'est-à-dire exactement l'alerte silencieuse qu'on refuse. Il faudra
  un axe « catégorie d'aliment » distinct du rayon.
- Les **substitutions** ne sont pas faites non plus : le référentiel ne porte
  aucune relation de remplacement, et les dériver du rayon proposerait de la
  crème à qui ne supporte pas le lait. Il faudra une table écrite à la main.
- Les pages d'exemple servant de tests sont dans `backend/test/fixtures/recipes`,
  au format JSON-LD extrait. Pour en ajouter une :

  ```bash
  curl -sSL -A 'Mozilla/5.0' 'https://…' \
    | grep -oP '(?<=application/ld\+json">).*?(?=</script>)'
  ```
