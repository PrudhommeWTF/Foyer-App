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
| 2 | Ingrédients structurés, référentiel d'articles, génération avec rapport | À venir |
| 3 | Planning iPhone, semaine type des convives, duplication, suggestions | À venir |
| 4 | Import de recettes, recherche, historique | À venir |
| 5 | Contraintes alimentaires, stock de placard | À venir |

## Le principe directeur

Le foyer est **un seul document JSON** dans SQLite, exposé par
`GET/PUT /api/state`. Le module Cuisine y reste : quelques centaines de recettes,
un planning glissant et quelques dizaines d'articles ne justifient pas des tables
dédiées, et une archive du répertoire de données demeure une sauvegarde complète.

Deux choses seulement en sortent, chacune pour une raison précise.

### 1. Les octets des photos ne sont plus dans le document

Une photo rangée en data-URL dans l'état n'était pas un problème de place, mais
de **débit** : le document entier repart à chaque enregistrement. Trente recettes
photographiées, ce sont plusieurs mégaoctets renvoyés en 4G à chaque coche d'un
article dans un magasin.

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

## Ce que voit l'API

| Route | Rôle |
|---|---|
| `GET /api/shopping?since=<version>` | Instantané de la liste. Répond `{ version, unchanged: true }` quand rien n'a bougé. |
| `POST /api/shopping/ops` | Applique un lot (`add`, `set-state`, `edit`, `remove`). Rend les articles, la version, les opérations retenues et celles écartées avec leur raison. |
| `POST /api/files?owner=recipe&id=<id>&filename=<nom>` | Range une photo. Corps : les octets bruts. |
| `GET /api/files/<id>` | Sert la photo, en flux. |
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
MealValue { items: MealItem[] }               // un créneau porte plusieurs plats
MealItem  { rid? } | { text? }                // recette du carnet, ou texte libre
Aisle    { id, name, color, position }        // position = ordre des allées du magasin
ShopItem { id, name, qty, aisleId, state, listId, by?, at? }
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

`ingr` reste un tableau de chaînes : les ingrédients structurés sont le sujet de
la tranche 2.

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
[foyer] État : 4 photo(s) de recette déplacée(s) hors du document.
[foyer] État : Rayon(s) recréé(s) depuis des articles orphelins : Depuis le planning repas.
[foyer] État : document d'origine sauvegardé dans /var/lib/foyer/backups/state-avant-migration-v0-2026-08-21T01-13-07-630Z.json
```

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
| `backend/test/household-files.test.ts` | Déduplication entre les deux tables, balayage des orphelins |
| `backend/test/recipe-import.test.ts` | Lecture du JSON-LD sur une vraie page Marmiton, et sur les formes tordues du standard |
| `backend/test/recipe-fetch.test.ts` | Refus des adresses locales, des protocoles hors web, interrupteur de configuration |
| `backend/test/recipe-routes.test.ts` | Import bout en bout avec le réseau bouchonné : photo, avertissements, refus |
| `backend/test/headers.test.ts` | Valeurs d'en-tête émises et reçues, contre un vrai serveur, sans bouchon |
| `frontend/src/app/core/helpers.test.ts` | Semaine ancrée sur le jour, lundi en tête, changements d'heure |

```bash
cd backend  && npm test
cd frontend && npm test
```

## À savoir pour la suite

- Le module **Documents** range encore ses fichiers en data-URL dans le document
  (`files[].data`). Le magasin est maintenant disponible pour lui ; c'est un
  chantier à part, non traité ici.
- La limite `express.json({ limit: '15mb' })` sur `/api/state` reste dimensionnée
  pour ces documents-là. Elle pourra baisser quand ils auront migré.
- `ingr` reste du texte libre. La tranche 2 le structure, en conservant toujours
  la ligne d'origine à côté de la forme analysée. Les lignes qui sortent de
  l'import sont régulières : le moteur d'analyse devra aussi être éprouvé sur des
  fiches saisies à la main, qui le sont beaucoup moins.
- Les pages d'exemple servant de tests sont dans `backend/test/fixtures/recipes`,
  au format JSON-LD extrait. Pour en ajouter une :

  ```bash
  curl -sSL -A 'Mozilla/5.0' 'https://…' \
    | grep -oP '(?<=application/ld\+json">).*?(?=</script>)'
  ```
