# Module Finances, architecture et décisions

Pourquoi le module Finances ne ressemble pas au reste de Foyer, et ce qu'il faut savoir
avant d'y toucher. Le cahier de recette de l'import vit à côté, dans
[`finances-cahier-de-recette.md`](finances-cahier-de-recette.md).

## 1. Deux modèles de persistance, volontairement

| | Reste du foyer | Module Finances |
|---|---|---|
| Stockage | un document JSON dans `household.state` | tables `fin_*` dans le même fichier SQLite |
| API | `GET/PUT /api/state` | `/api/finances/*`, opérations granulaires |
| Écriture | tout le document renvoyé, 700 ms après la frappe | un `INSERT` ou un `UPDATE` ciblé |
| Front | `foyer.store.ts` | `finances.store.ts` |

Le document JSON convient parfaitement aux modules légers (courses, menus, tâches, agenda) :
peu de données, écriture rare, pas d'agrégat. Il ne convient pas aux finances :

- **Volume** : environ 1 200 opérations par an, 6 000 à cinq ans, rechargées et resérialisées
  à chaque écriture de n'importe quel module.
- **Pièces jointes** : `express.json({ limit: '15mb' })` s'applique au document entier. Des
  factures stockées en data-URL dedans finissent par faire échouer **toutes** les sauvegardes,
  de tous les modules, en HTTP 413.
- **Concurrence** : un `PUT` de l'état complet est du dernier arrivé gagne. Deux utilisateurs
  simultanés, l'un perd son travail.
- **Requêtes** : aucun filtre, aucun agrégat, aucun index côté serveur.

Les deux modèles cohabitent. Ce n'est pas une étape intermédiaire vers une migration complète :
c'est le bon outil pour chaque type de données.

## 2. Décisions structurantes

**Les montants sont des entiers, en centimes.** Jamais de nombre à virgule flottante. Sur
plusieurs milliers d'additions, les flottants dérivent (0,1 + 0,2 = 0,30000000000000004). La
conversion se fait une seule fois, à la frontière (saisie ou fichier importé), via
`parseCents()`. L'affichage repasse en euros au dernier moment.

**Les migrations sont versionnées, jamais modifiées après coup.** `fin_meta.schema_version`
porte le numéro appliqué. Au démarrage, `migrateFinances()` applique les migrations manquantes,
chacune dans sa propre transaction. Une migration qui échoue laisse la base sur la version
précédente et écrit un message explicite dans le journal. **Ne modifiez jamais une migration
déjà publiée** : ajoutez-en une nouvelle, sinon les installations existantes divergent.

**Les clés étrangères sont actives** (`PRAGMA foreign_keys = ON`). Supprimer une catégorie
détache ses opérations (`SET NULL`) au lieu de les perdre ; supprimer une catégorie parente
emporte ses sous-catégories (`CASCADE`) mais jamais les opérations.

**Un compte qui porte des opérations ne peut pas être supprimé.** L'API répond 409 avec un
message qui explique quoi faire (archiver). Archiver conserve tout l'historique et sort le
compte des alertes de mois incomplet.

**Les références aux membres sont molles.** `fin_accounts.member_id` pointe vers un
`state.members[].id`, sans contrainte SQL : les deux mondes ne peuvent pas se contraindre l'un
l'autre. Retirer un membre du foyer laisse le compte en place, simplement sans titulaire.

**Les virements internes sortent des recettes et des dépenses**, mais leurs deux lignes restent
en base : les soldes de compte doivent rester justes. Un virement porte `kind = 'virement'` et,
une fois apparié, un `transfer_group` commun aux deux lignes.

**L'empreinte de déduplication est figée à l'écriture.** `dedupe_key` est calculée sur le
libellé **brut** et stockée en dur. Renommer ou recatégoriser une opération ne la change pas,
donc un réimport ultérieur ne la ressuscite pas en double. Les saisies manuelles reçoivent une
empreinte aléatoire (`m:<uuid>`) : elles ne sont jamais dédoublonnées.

## 3. Mois incomplets

Un mois est signalé incomplet dès que la période du mois n'est pas **entièrement** couverte pour
un compte **actif**, en s'arrêtant à aujourd'hui pour le mois en cours. Le bandeau nomme le
compte et la date où ses données s'arrêtent, et regroupe les comptes qui s'arrêtent le même jour.

« Entièrement » veut dire ce qu'il dit : une fin de données prématurée, mais aussi un **trou au
milieu** entre deux imports non jointifs. Voir la section 9 pour le détail du calcul, partagé
avec le tableau de bord afin que la carte du mois et le graphique annuel ne se contredisent
jamais.

C'est le mode de panne le plus vicieux du module : sans ce signal, un mois auquel il manque un
compte affiche des chiffres **plausibles** et faux. Le seul moyen d'éteindre l'alerte est
d'archiver le compte, c'est-à-dire de prendre une décision explicite.

La couverture ne se déduit **pas** de la dernière opération : chaque import enregistre la
fenêtre de dates qu'il couvre, par compte (`fin_import_coverage`). Un export dit « voici tout ce
que j'ai pour ces comptes sur cette période », ce qui est une affirmation de complétude ; taper
des opérations à la main n'en est pas une.

Deux conséquences voulues :

- un livret qui ne bouge que deux fois par an, mais présent dans un import récent, **n'est plus
  signalé** ;
- un compte que vous n'avez **jamais importé** n'est jamais signalé non plus. L'alerte ne sert
  que si elle reste rare, et une saisie manuelle n'affirme rien sur ce qui manque.

Un compte dont la connexion bancaire meurt disparaît des exports suivants : il garde donc sa
vieille couverture et continue d'être signalé, ce qui est exactement le cas TPH-IT.

**Limite résiduelle** : si votre agrégateur continue d'inclure la section d'un compte tout en
n'ayant plus rien à y mettre, la couverture s'étendra à tort. Rien dans le fichier ne permet de
distinguer « aucune activité » de « plus de données ». Archivez le compte le cas échéant.

## 4. Découpage du code

```
backend/src/finances/
  schema.ts        migrations versionnées, appliquées au démarrage par db.ts
  money.ts         centimes, dates, normalisation de libellé (aucune dépendance)
  repo.ts          accès SQLite : requêtes préparées, agrégats, export CSV
  routes.ts        /api/finances, validation et messages d'erreur en français
  types.ts         formes échangées avec le frontend
  import-repo.ts   imports, virements internes, couverture
  import-routes.ts /api/finances/imports et /transfers
  rules.ts         moteur de décision pur : aucune base, aucun effet de bord
  rules-repo.ts    stockage des règles, étiquettes, rejeu et prévisualisation
  rules-routes.ts  /api/finances/rules et /tags
  dashboard.ts     agrégats mensuels et annuels, calculés en SQL
  contracts.ts     biens, contrats, échéances dérivées, coût réel
  contracts-routes.ts /api/finances/contracts et /assets
  import/
    parse.ts   détection de format d'après les octets, pas l'extension
    decode.ts  UTF-8, UTF-16, repli Windows-1252
    csv.ts     texte délimité, colonnes reconnues par nom normalisé
    ofx.ts     OFX 1.x (SGML) et 2.x (XML)
    camt.ts    CAMT.053
    xlsx.ts    .xlsx, faux .xls HTML, refus explicite du binaire 97-2003
    zip.ts     lecture ZIP minimale (zlib), pour l'.xlsx
    xml.ts     lecteur XML minimal, partagé par OFX et CAMT
    blocks.ts  découpage en blocs et effondrement intra-fichier
    dedupe.ts  déduplication contre la base
    transfers.ts détection et notation des virements internes
    run.ts     orchestration : résolution, préparation, rapport
backend/test/  tests node:test (aucune dépendance ajoutée)

frontend/src/app/core/finances.api.ts     client HTTP
frontend/src/app/core/finances.store.ts   état, adossé au serveur
frontend/src/app/screens/finances/        un fichier par onglet
```

Deux entorses assumées aux conventions du dépôt, justifiées par la taille du module :
`screens/finances/` est un dossier alors que les autres écrans sont un fichier, et l'état d'UI
des Finances vit dans `FinancesUi` plutôt que dans le `UiState` commun (qui aurait gagné
soixante champs).

## 5. Pas de dépendance circulaire entre les stores

`FinancesStore` dépend de `FoyerStore` (membres, couleurs, toasts, fuseau). L'inverse est
interdit. Deux conséquences visibles dans le code :

- les alertes de budget dépassé et de mois incomplet sont **calculées** par `FinancesStore` et
  poussées dans `FoyerStore.externalNotifs`, que le panneau de notifications fusionne ;
- la recherche globale des opérations passe par `FinancesStore.search()` (appel serveur,
  antirebond de 220 ms), et la palette de recherche fusionne les deux listes de résultats.

## 6. Import : ce qui se passe, dans l'ordre

1. **Décodage** des octets. L'encodage est reniflé (UTF-8, UTF-16, repli Windows-1252) et
   reporté dans le rapport.
2. **Détection du format** d'après le contenu, jamais l'extension : un « .xls » d'agrégateur est
   souvent un tableau HTML ou du texte tabulé.
3. **Découpage en blocs** : suites de lignes consécutives partageant le même libellé de compte.
4. **Résolution** de chaque bloc vers un compte réel, via la table d'alias. Un libellé inconnu
   **bloque** l'import : aucun compte n'est créé automatiquement. Quand le libellé porte
   exactement le nom d'un compte actif (casse, accents et espaces mis à part), ce compte est
   **proposé** dans le rapport, pré-sélectionné ; il reste à confirmer, parce qu'un
   rattachement crée un alias mémorisé pour de bon. Un nom porté par deux comptes, ou par un
   seul compte archivé, ne propose rien : sur des données d'argent, une suggestion approximative
   coûte plus cher qu'une absence de suggestion.
5. **Effondrement** des blocs redondants d'un même compte, au **maximum** d'occurrences par bloc
   et non à la somme.
6. **Déduplication** contre la base, par empreinte figée et rang d'occurrence.
7. **Rapport**, affiché avant toute écriture.
8. **Validation** explicite, en une transaction.
9. **Virements internes** proposés, jamais fusionnés d'office.

Le fichier n'est jamais conservé : seules les lignes lues sont stockées dans le brouillon
(`fin_imports.payload`), le temps que vous rattachiez les comptes inconnus sans avoir à
redéposer le fichier. Le brouillon est vidé à la validation, et les brouillons abandonnés depuis
plus de 24 h sont purgés au premier import suivant.

**Annuler un import** supprime uniquement les lignes qu'il a créées (`DELETE WHERE import_id`).
Si l'une d'elles faisait partie d'un virement validé, la jambe survivante est dégroupée plutôt
que laissée en demi-virement. L'écran annonce combien de lignes ont été retouchées à la main
depuis l'import, et donc ce que vous perdriez. Valider un virement ne compte pas comme une
retouche : c'est un changement de structure, pas de contenu.

## 7. Formats acceptés

| Format | Reconnaissance | Remarques |
|---|---|---|
| CSV, TSV | séparateur et colonnes reniflés | Bankin' (`Date;Description;Compte;Montant;…`) et en-têtes anglais |
| OFX 1.x | `OFXHEADER:` ou `<OFX>` | dialecte SGML aux balises non fermées, normalisé avant lecture |
| OFX 2.x | `<?xml>` + `<OFX>` | |
| CAMT.053 | espace de noms ISO 20022 | un compte par `<Stmt>`, une ligne par `<Ntry>` |
| .xlsx | signature ZIP | lu avec `zlib`, sans bibliothèque de tableur |
| faux .xls HTML | `<table>` | cas fréquent des agrégateurs |
| faux .xls texte | à défaut | traité comme du délimité |
| .xls binaire (BIFF8) | signature OLE2 | **refusé**, avec le message qui indique de réexporter en CSV |

Décoder le BIFF8 à la main serait déraisonnable, et une bibliothèque pour ce seul cas ne vaut
pas la dépendance. C'est une dette assumée, et le message d'erreur le dit.

## 8. Règles de catégorisation

Le cas qui commande le reste : deux contrats d'un même fournisseur, au libellé bancaire
rigoureusement identique, que **seul le montant** distingue. Quatre prélèvements AXA sur le
même compte, dont trois libellés exactement `Prlv Sepa Axa` pour -635,46 €, -81,69 € et
-40,63 €. Un moteur incapable de combiner « libellé contient » **et** « montant entre » ne sert
à rien ici.

**Critères disponibles** : libellé (contient, ne contient pas, égal, commence par, expression
régulière), montant (supérieur, inférieur, entre, égal), sens (dépense ou recette), compte,
jour du mois, date. Combinés en **toutes** ou **au moins une**.

**Actions** : ranger dans une catégorie, réécrire le libellé, ajouter une étiquette, marquer
comme virement interne (la ligne sort alors des dépenses et des ressources du mois).

Quelques décisions qui se voient à l'usage :

- **Les montants se comparent en valeur absolue, en euros, des deux côtés.** On décrit un
  prélèvement comme « entre 600 et 700 », et l'interface affiche « -635,46 € » : les bornes
  saisies en négatif donnent donc exactement le même résultat. Le signe est porté par le critère
  « sens », par lui seul.
- **Les règles sont ordonnées** et évaluées de haut en bas. La dernière qui décide d'un champ
  l'emporte ; les étiquettes, elles, s'accumulent. Une règle peut porter « arrêter là », qui
  interrompt l'évaluation pour les lignes qu'elle a retenues.
- **Une règle sans condition ne retient rien.** Elle repeindrait tout l'historique en silence,
  l'API la refuse et le moteur ne la ferait de toute façon correspondre à aucune ligne.
- **Une catégorie corrigée à la main n'est jamais écrasée par un rejeu.** C'est la colonne
  `fin_transactions.rule_id` qui tranche : renseignée, la ligne appartient à une règle ;
  `NULL`, elle a été classée à la main. Le rapport de rejeu annonce combien de lignes ont été
  protégées à ce titre. La case « écraser aussi les catégories corrigées à la main » lève la
  protection, explicitement.
- **Une règle qui ne pose qu'une étiquette ne s'approprie pas la ligne** : elle laisse
  `rule_id` intact, donc une catégorie manuelle garde son bouclier et le rejeu suivant annonce
  bien zéro modification.
- **Supprimer une règle ne défait rien.** Les lignes gardent leur catégorie, `rule_id` repasse
  à `NULL` (clé étrangère `ON DELETE SET NULL`) : elles basculent en classement manuel.
- **La prévisualisation emprunte exactement le même chemin de décision** que le rejeu et
  n'écrit rien. Elle compare les valeurs, jamais la provenance, parce qu'un brouillon n'a pas
  encore d'identifiant.

Les règles tournent aussi **à la validation d'un import**, sur les seules lignes créées
(`applyRules({ importId })`) : le message de fin annonce combien ont été rangées.

`rules.ts` est **pur** : il décide, il n'écrit pas. C'est ce qui permet de le tester sans base
et garantit que l'aperçu et le rejeu ne divergent jamais.

## 9. Tableau de bord

Un seul appel, `GET /api/finances/dashboard?month=AAAA-MM`, renvoie tout ce que l'onglet Bilan
affiche : le mois, ses douze prédécesseurs, l'année en cours et les plus grosses dépenses. Les
sommes sont faites **en SQL**, jamais dans le navigateur : c'est précisément ce pour quoi le
module a des tables plutôt qu'un document JSON.

**Les douze points sont toujours rendus**, mois vides compris, à zéro. Un trou dessiné comme un
trou est honnête ; un trou silencieusement sauté ferait mentir le graphique sur la période
couverte.

**La moyenne mensuelle ignore les mois incomplets et les mois vides.** Les inclure tirerait la
référence vers le bas et ferait passer chaque mois normal pour un excès.

**Le budget de référence est mis à l'échelle des mois écoulés** dans la vue annuelle : comparer
un cumul de trois mois à douze fois un budget mensuel ne dirait rien.

### Couverture : la fin, mais aussi le début et les trous

Le drapeau « mois incomplet » ne se contente plus de regarder si les données s'arrêtent avant la
fin du mois. `coverageIntervals()` fusionne les fenêtres déclarées par les imports, compte par
compte, et `gapsOver(from, to)` vérifie que la période demandée est **entièrement** couverte.
Trois conséquences :

- un **trou au milieu** (janvier à mars importés, juin à août importés, rien entre les deux) rend
  les mois manquants incomplets, alors que l'ancien test les déclarait bons ;
- deux imports **jointifs** (fin au 30/04, reprise au 01/05) se recollent, sans faux trou d'un
  jour ;
- rien n'est affirmé sur la période **antérieure au premier import** d'un compte : un livret
  ouvert cette année ne rend pas incomplets tous les mois de l'an dernier.

Un compte tenu uniquement à la main ne rend jamais un mois incomplet : une saisie manuelle ne
prétend pas à l'exhaustivité, seul un import déclare une période.

`monthSummary()` et le tableau de bord partagent ce test. C'est délibéré : la carte du mois et le
graphique annuel ne doivent jamais se contredire sur le même mois.

### Couleurs du graphique

Deux séries, donc la couleur **est** le canal d'identité et doit survivre au daltonisme. Le vert
maison contre le terracotta se sépare de ΔE 4,8 pour un deutéranope, là où le plancher est de 8 :
illisible pour environ 8 % des hommes. Le bleu maison, d'un cran plus soutenu (`#3B8CBD`),
atteint 16,1 et passe les six contrôles dans les deux thèmes. Le vert reste sur les lignes
d'opération, où le signe et le « + » portent déjà le sens sans dépendre de la couleur.

Les mois incomplets sont **hachurés et légendés**, jamais distingués par la seule couleur.

## 10. Biens, contrats et échéances

Un contrat n'est pas une opération : c'est ce qui les explique. Le module sert deux besoins
concrets, et rien d'autre.

**Ne pas rater une date limite de résiliation.** Un contrat tacitement reconduit et manqué d'un
jour coûte une période entière de plus. C'est la seule échéance qui coûte vraiment de l'argent,
et c'est pour elle que le reste existe.

**Savoir ce qu'un contrat coûte réellement**, en confrontant la fourchette annoncée aux
opérations qui lui sont rattachées. « Ton assurance annonce 70 à 76 €, elle en prélève 81,69 »
est un fait que la liste d'opérations seule ne fait jamais remonter.

Cette tranche **n'ajoute aucune table** : `fin_assets`, `fin_contracts` et `fin_contract_refs`
ont été posées par la migration 1 et attendaient d'être utilisées.

### Les échéances sont dérivées, jamais stockées

Trois dates sortent d'un contrat actif, calculées à la volée :

| Échéance | Calcul |
|---|---|
| Dernier jour pour résilier | reconduction moins le préavis |
| Reconduction tacite | date de reconduction, reportée sur son prochain anniversaire |
| Fin du contrat | date de fin, si elle est à venir |

Rien n'est matérialisé : changer une date de reconduction change ses échéances, sans copie
périmée qui traîne. Une date de reconduction vieille de trois ans reste la bonne date, elle est
simplement due à nouveau : elle est reportée d'année en année jusqu'à retomber dans le futur.
Un 29 février sur une année commune tombe au 1er mars, comme à la banque.

Une fenêtre de préavis déjà fermée reste affichée, en grisé, jusqu'à la reconduction elle-même :
c'est ce qui explique pourquoi rien ne peut être fait cette année.

### Coût réel

Le total des opérations rattachées sur douze mois glissants, et le dernier prélèvement confronté
à la fourchette. Sortir de la fourchette est **signalé**, pas corrigé : c'est une information,
la décision reste au foyer.

Une **fourchette** plutôt qu'un montant exact, parce que les cotisations bougent de quelques
centimes et qu'un signalement à chaque centime ne serait plus lu.

### Rattacher les opérations

Trois chemins, du plus manuel au plus automatique : le sélecteur du formulaire d'opération,
l'action de règle « rattacher au contrat », et le filtre « opérations de ce contrat » qui part du
contrat pour vérifier ce qu'il a réellement capté. L'action de règle utilise le même moteur que
le reste : elle se prévisualise, se rejoue et se protège comme les autres.

**Supprimer ne défait rien.** Supprimer un bien libère ses contrats, supprimer un contrat détache
ses opérations : l'argent a bien été dépensé, seule l'explication disparaît. Un contrat terminé
se passe en « résilié » plutôt que de se supprimer, pour garder son historique lisible.

## 11. Sauvegarde et restauration

Le fichier SQLite est en mode WAL : **copier `foyer.db` seul pendant que le service tourne
donne une sauvegarde corrompue.** Deux méthodes sûres.

### LXC natif

```bash
systemctl stop foyer
tar czf /root/foyer-$(date +%F-%H%M).tar.gz -C /var/lib/foyer .
systemctl start foyer
```

Restauration :

```bash
systemctl stop foyer
rm -rf /var/lib/foyer/*
tar xzf /root/foyer-2026-08-17-1430.tar.gz -C /var/lib/foyer
chown -R foyer:foyer /var/lib/foyer
systemctl start foyer
journalctl -u foyer -n 50 --no-pager
```

### Docker, sans arrêt de service

`VACUUM INTO` écrit un instantané cohérent pendant que la base est utilisée.

```bash
STAMP=$(date +%F-%H%M)
docker compose exec -T foyer node -e "
const db = require('better-sqlite3')('/data/foyer.db');
db.exec(\"VACUUM INTO '/data/foyer-$STAMP.db'\"); db.close();"
docker compose cp foyer:/data/foyer-$STAMP.db ./foyer-$STAMP.db
```

Restauration :

```bash
docker compose stop foyer
docker compose cp ./foyer-2026-08-17-1430.db foyer:/data/foyer.db
docker compose exec -T foyer sh -c 'rm -f /data/foyer.db-wal /data/foyer.db-shm'
docker compose start foyer
docker compose logs -f foyer
```

Supprimer les fichiers `-wal` et `-shm` est indispensable : laissés en place, ils réappliquent
des écritures qui ne correspondent plus à la base restaurée.

### Vérifier une sauvegarde

```bash
sqlite3 foyer-2026-08-17-1430.db "PRAGMA integrity_check;"
sqlite3 foyer-2026-08-17-1430.db "SELECT value FROM fin_meta WHERE key='schema_version';"
sqlite3 foyer-2026-08-17-1430.db "SELECT COUNT(*) FROM fin_transactions;"
```

### Export de secours, sans outil

Le bouton « Exporter en CSV » de l'écran Finances rend toutes les opérations, séparateur
point-virgule, UTF-8 avec BOM (Excel FR et LibreOffice l'ouvrent sans boîte de dialogue).
En ligne de commande :

```bash
TOKEN=$(curl -s -X POST http://localhost:8099/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"vous@example.com","password":"…"}' | jq -r .token)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8099/api/finances/export.csv -o finances.csv
```

## 12. Tests

```bash
cd backend
npm test        # tests node:test (import, agrégats, migrations)
npm run typecheck   # tsc --noUnusedLocals --noUnusedParameters sur src/ et test/
```

Le lanceur est celui intégré à Node 22, exécuté via `tsx` (déjà présent) : aucune dépendance
ajoutée. La CI exécute les deux à chaque push et à chaque pull request.

`npm test` commence par `scripts/check-tests.js`, qui échoue si le dossier `test/` ne contient
aucun fichier `*.test.ts`. Sans ce garde-fou, `tsx --test test/*.test.ts` sort en code 0 quand
le motif ne correspond à rien : un dossier renommé laisserait la CI au vert en n'exécutant
aucun test.
