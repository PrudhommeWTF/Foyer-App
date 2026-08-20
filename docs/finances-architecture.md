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

**Le solde d'ouverture peut porter une date, et cette date filtre.** Sans date, le solde
d'ouverture s'ajoute à toutes les opérations du compte. Avec une date, il ne s'ajoute qu'aux
opérations **postérieures** : le montant saisi est réputé contenir déjà le jour même et tout ce
qui précède, comme un solde de fin de journée sur un relevé bancaire. C'est ce qui permet de
recaler un compte sur son solde réel sans purger l'historique importé.

Les opérations écartées restent en base, dans la liste et dans le bilan : seul le solde les
ignore. Comme ce filtre pourrait donner l'impression que de l'argent a disparu, la carte du
compte l'annonce (« Solde constaté le 20/08/2026, 3 opérations antérieures déjà comprises »).
`repo.opsBeforeOpening()` fournit ce compteur, exposé sous `ignoredOps` par `/bootstrap` et
`/accounts`.

**Un compte de crédit ne tient pas de registre.** Un prêt amortissable à taux fixe est
entièrement déterminé par quatre chiffres de l'offre de prêt (capital, taux, mensualité, date de
première échéance) : le capital restant dû à n'importe quelle date s'en déduit. Y écrire aussi des
opérations créerait une seconde source de vérité, et les deux divergeraient dès la première
échéance, puisque la mensualité contient des intérêts. L'API refuse donc toute opération sur un
compte de crédit, avec un message qui dit quoi faire à la place, et ces comptes sortent des
sélecteurs d'opération, d'import et de règle.

**Un remboursement anticipé ou une renégociation se saisit en recalant.** On recopie le capital
restant dû du relevé annuel dans le champ « à la date du », et le tableau d'amortissement repart
de là. C'est le même mécanisme de solde ancré que pour un compte ordinaire, avec le même sens.

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
backend/src/
  ics.ts           flux ICS : mise en forme seule, testable sans base
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
  loans.ts         prêts amortissables : capital restant dû, échéancier, intérêts
  contracts-routes.ts /api/finances/contracts et /assets
  attachments.ts   pièces jointes : octets sur disque, métadonnées en base
  attachments-routes.ts /api/finances/attachments
  energy.ts        relevés de compteur et consommation dérivée
  energy-routes.ts /api/finances/readings
  savings.ts       pistes d'économies, cumul de ce qui reste à aller chercher
  backup.ts        sauvegarde et restauration du seul module
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

### Qui est concerné

Un compte joint a **deux** titulaires, une mutuelle peut couvrir **toute la famille** : une colonne
unique ne pouvait pas le dire. La migration 4 crée `fin_account_members` et `fin_contract_members`,
**recopie le titulaire unique déjà saisi** puis supprime la colonne. Rien à ressaisir sur une base
existante, et une seule source de vérité pour la question « à qui est-ce ».

Les identifiants de membres viennent du **document du foyer**, pas d'une table : ils ne peuvent pas
être vérifiés par clé étrangère, seulement nettoyés (dédoublonnés, bornés). L'affichage est donc
tolérant : un membre supprimé du foyer laisse son identifiant en base, et l'interface l'ignore
plutôt que d'afficher un vide entre deux virgules.

**La restauration signale les colonnes qu'elle ignore.** Restaurer une sauvegarde d'avant la
migration 4 rapporte `fin_accounts (member_id)` : la colonne n'existe plus, son contenu vit
ailleurs, et le taire ferait perdre une donnée sans que personne le sache.

### Rattacher les opérations

Trois chemins, du plus manuel au plus automatique : le sélecteur du formulaire d'opération,
l'action de règle « rattacher au contrat », et le filtre « opérations de ce contrat » qui part du
contrat pour vérifier ce qu'il a réellement capté.

La fiche du contrat propose de **créer la règle directement**, pré-remplie : le libellé bancaire
ressemble au **fournisseur** bien plus qu'au nom que vous avez donné au contrat, et c'est la
**fourchette de montant** qui distingue deux contrats du même assureur. Ces deux critères
deviennent les conditions, le rattachement au contrat devient l'action, et la règle se teste avant
d'être enregistrée comme n'importe quelle autre. L'action de règle utilise le même moteur que
le reste : elle se prévisualise, se rejoue et se protège comme les autres.

**Supprimer ne défait rien.** Supprimer un bien libère ses contrats, supprimer un contrat détache
ses opérations : l'argent a bien été dépensé, seule l'explication disparaît. Un contrat terminé
se passe en « résilié » plutôt que de se supprimer, pour garder son historique lisible.

### Où les échéances apparaissent

Une échéance n'existe qu'une fois, dans `contracts.ts`. Elle est **lue** à quatre endroits, et
stockée à aucun.

| Endroit | Ce qu'il en fait |
|---|---|
| Écran Contrats | Les six prochains mois, la fenêtre de préavis en rouge quand elle approche |
| Calendrier partagé | Un repère par date, passées comprises, poussé dans `FoyerStore.externalDayExtras` |
| Notifications | Les seules fenêtres de résiliation, dans les trente jours |
| Flux ICS | Le même horizon que le calendrier, avec un rappel à J-7 sur les résiliations |

**L'horizon de calcul est `DEADLINE_HORIZON_DAYS = 400`, un peu plus d'un an.** C'est la seule
valeur qui garantit qu'une reconduction annuelle est **toujours** dans la liste, quelle que soit la
date du jour : avec six mois, un contrat qui se reconduisait dans huit n'apparaissait nulle part,
ni dans le calendrier, ni dans le flux ICS. L'écran Contrats garde sa fenêtre courte en filtrant
lui-même (`daysAway <= 185`) : au-delà, il n'y a rien à faire aujourd'hui. Le calendrier, lui,
montre tout : on y navigue justement pour voir loin.

**Le calendrier affiche aussi les échéances passées.** Elles sont sur une date révolue, donc seule
une navigation en arrière les fait apparaître, et une fenêtre de résiliation manquée explique
pourquoi rien n'est possible cette année. L'écran Contrats les montre déjà ; le calendrier ne peut
pas dire l'inverse.

La case d'un jour, en vue mois, n'affiche que deux événements et deux repères ; le badge
`+N autres` compte **les deux**. Sans cela, une échéance tombant un jour déjà chargé (un férié et
un anniversaire, par exemple) disparaissait sans laisser de trace.

Le passage par `externalDayExtras` reprend exactement le montage des notifications : `FinancesStore`
dépend de `FoyerStore`, jamais l'inverse. Les repères sont **calculés** dans le store Finances et
poussés dans un signal que le calendrier fusionne, ce qui évite la dépendance circulaire et
garantit qu'aucune date ne se dédouble.

**Les identifiants ICS sont stables par contrat et par type** (`fin-preavis-12@foyer`). Quand une
reconduction est reportée d'un an, l'agenda **déplace** l'entrée au lieu d'en accumuler une par
année. Seule la date limite de résiliation porte une `VALARM` : c'est la seule qui coûte de
l'argent si elle passe, et un rappel sur chaque date apprendrait surtout à les ignorer.

**Une tâche créée depuis une échéance est une copie ponctuelle**, pas un miroir. Elle passe par
`FoyerStore.addExternalTask`, l'utilisateur peut la cocher, la déplacer, la supprimer, et elle ne
réapparaît pas. Si la date du contrat change ensuite, la tâche ne suit pas : une tâche qui
change toute seule sous les doigts de celui qui l'a cochée serait pire que pas de tâche du tout.

`buildIcs` vit dans `src/ics.ts` et **ne fait que mettre en forme** : les échéances lui sont
passées en argument. C'est ce qui permet de le tester sans base, et un fichier ICS mérite des
tests parce que personne ne le relit : seuls des agendas le lisent, et ils refusent en silence ce
qu'ils ne comprennent pas.

## 10 bis. Crédits

`loans.ts` ne stocke rien. Comme les échéances de contrats, tout se recalcule : capital restant
dû, décomposition de chaque échéance, date de fin, intérêts de l'année, coût total. Un tableau
d'amortissement figé en base serait faux dès le premier remboursement anticipé, et personne ne
saurait pourquoi.

Le calcul est celui d'un prêt amortissable à taux fixe, le cas de la quasi-totalité des crédits
immobiliers et à la consommation français : intérêts du mois = capital restant dû × taux / 12,
capital amorti = mensualité moins ces intérêts. **La dernière échéance est ajustée** pour solder
exactement, sinon les arrondis mensuels laissent toujours un centime traîner. C'est ce que fait un
prêteur.

Deux garde-fous. **Une mensualité qui ne couvre pas les intérêts du premier mois est refusée à la
saisie**, avec le chiffre qui manque : sans ce contrôle, le capital monterait à chaque échéance et
le tableau ne se terminerait jamais. Et `loanView()` renvoie `null` plutôt que de propager une
exception : un écran ne doit pas tomber à cause d'une ligne de base douteuse, il doit le dire.

Le taux est stocké en **points de base** (`loan_rate_bp`, 345 pour 3,45 %), pour rester en entiers
partout, comme les montants sont en centimes.

### Ce que le crédit ne fait pas

La mensualité qui sort du compte courant reste une **dépense entière** dans le bilan : c'est bien
de l'argent qui quitte le foyer. La décomposition capital / intérêts est affichée à part, sur le
prêt, sans toucher aux recettes et dépenses. Sortir la part capital des dépenses serait plus juste
économiquement, mais rendrait des totaux mensuels déjà connus dépendants de l'exactitude de
l'échéancier.

Ne sont pas modélisés : taux variable, différé d'amortissement, renégociation. Chacun se rattrape
en recalant le capital restant dû. La dernière échéance n'est pas non plus poussée dans le
calendrier ni dans le flux ICS : le type `Deadline` est taillé pour les contrats, et lui faire
porter un prêt demanderait de le généraliser proprement plutôt que d'inventer un contrat fantôme.

## 11. Pièces jointes

**Les octets sur le disque, les métadonnées dans SQLite.** Le choix a été pris en comparant les
deux options, et il tient à un fait vérifiable : `better-sqlite3` **n'expose pas** l'API blob
incrémentale de SQLite. Un PDF rangé en base est donc chargé intégralement en mémoire à chaque
téléchargement, ce qui met un LXC modeste à genoux dès que deux personnes ouvrent une facture en
même temps. Sur disque, `res.sendFile` sert en flux.

Trois autres arguments ont pesé, tous vérifiés plutôt que supposés :

- **L'effacement est réel.** `secure_delete` et `auto_vacuum` valent zéro par défaut : un `DELETE`
  laisse les octets dans les pages libres jusqu'à un `VACUUM` complet. `rm` rend la place tout de
  suite, ce qui comptera le jour où le foyer rangera ici autre chose que des factures.
- **Le répertoire peut vivre à part**, sur un volume chiffré avec sa propre politique de
  snapshots, sans emporter toute la base.
- **Le dépannage reste possible sans SQL** : `ls`, `file`, `cp` suffisent à ressortir une facture
  même application arrêtée.

Le prix à payer est double, et il est assumé explicitement dans le code : deux sources de vérité
peuvent diverger, et une suppression n'est pas transactionnelle.

### Ce qui protège du désordre

**Le nom du fichier ne vient jamais de l'utilisateur.** Une pièce est rangée sous
`pieces/<2 premiers caractères de l'empreinte>/<empreinte><extension>`. Pas de traversée de
chemin possible, pas de collision, pas de caractère exotique. Le nom d'origine reste en base,
pour l'affichage et pour le téléchargement.

**Le type est reconnu au contenu**, jamais à l'extension, comme pour l'import de relevés. PDF,
JPEG, PNG, WEBP, GIF et HEIC (les photos d'iPhone) sont acceptés ; le reste est refusé en 415
avec un message qui dit pourquoi.

**Les octets identiques ne sont stockés qu'une fois.** La même facture rattachée au contrat et à
son opération occupe un seul fichier. La suppression d'une fiche ne retire le fichier que
lorsque plus aucune autre ne pointe dessus.

**L'écriture passe par un fichier temporaire** renommé ensuite : un envoi interrompu ne laisse
jamais un fichier à demi écrit sous son nom définitif.

**Supprimer un contrat, un bien ou une opération emporte ses pièces.** Les garder produirait des
fiches que plus rien ne peut atteindre. La fenêtre de confirmation annonce le nombre de pièces
qui vont disparaître.

### Divergence entre la base et le disque

Un balayage tourne au démarrage et compte l'écart **dans les deux sens** :

| Cas | Ce qui se passe |
|---|---|
| Fiche sans fichier | Comptée et signalée dans les logs, avec un exemple. Le téléchargement répond **410** avec la marche à suivre. La fiche est conservée : une restauration peut encore la sauver. |
| Fichier sans fiche | Compté et signalé. **Rien n'est supprimé** : effacer ce que l'administrateur n'a pas vu serait exactement le mauvais réflexe. |

`GET /api/finances/attachments-check` rend le même diagnostic à la demande.

Nettoyer les fichiers orphelins, une fois le diagnostic lu et assumé :

```bash
# Lister ce que la base ne référence plus, sans rien supprimer
sqlite3 /var/lib/foyer/foyer.db "SELECT rel_path FROM fin_attachments;" | sort > /tmp/connus.txt
find /var/lib/foyer/pieces -type f -printf '%P\n' | sort > /tmp/disque.txt
comm -13 /tmp/connus.txt /tmp/disque.txt

# Les supprimer, après avoir regardé la liste ci-dessus
comm -13 /tmp/connus.txt /tmp/disque.txt | while read -r f; do rm -v "/var/lib/foyer/pieces/$f"; done
```

## 12. Relevés de compteur

Le module ne cherche pas à facturer : le fournisseur le fait déjà, et mieux. Il répond à une
seule question, celle qu'aucune facture ne répond : **est-ce que je consomme plus qu'avant, et
depuis quand ?**

D'où le parti pris : tout est ramené à une **consommation par jour**. C'est la seule grandeur
comparable entre deux relevés espacés de trois semaines et deux relevés espacés de deux mois, et
la seule qui rende une dérive visible.

**La comparaison se fait à la même fenêtre de calendrier un an plus tôt**, jamais à la période
précédente. Comparer janvier à avril ne dit rien d'un foyer qui se chauffe.

Deux façons de saisir, les deux acceptées : l'**index** du compteur (simple, ou heures pleines et
creuses) ou la **consommation** lue sur une facture. Quand la facture donne le chiffre, il fait
foi : aucune soustraction à se tromper. Le montant de la période est facultatif et ne sert qu'à
calculer le prix du kWh.

### Ce qui n'est pas mesurable n'est pas affiché

Une consommation négative présentée comme un fait serait pire qu'une absence de chiffre. Quatre
cas sont donc nommés plutôt que calculés :

| Cas | Ce qui est affiché |
|---|---|
| Premier relevé | « premier relevé, rien à comparer » : il n'y a rien avant à soustraire |
| Index inférieur au précédent | « compteur remplacé ? » : un compteur ne recule pas |
| Deux relevés le même jour | « même jour que le relevé précédent » : pas de division par zéro |
| Ni index ni consommation | « consommation non calculable » |

Les relevés appartiennent au contrat et disparaissent avec lui (`ON DELETE CASCADE`).

### Pistes d'économies

Une piste n'est ni une opération ni un contrat : c'est une **intention chiffrée**. « Renégocier
l'assurance habitation, 240 € par an. »

Le module ne prétend pas mesurer l'économie réellement obtenue, seul le coût réel du contrat une
fois la piste appliquée le dira. Il tient la liste, sépare ce qui reste à faire de ce qui est
fait, et en donne le cumul annuel. C'est déjà ce qu'on oublie le plus.

**Une piste abandonnée ne compte nulle part.** La garder dans un total gonflerait un chiffre que
rien ne viendra jamais réaliser.

**Le gain annuel est obligatoire**, même approximatif : sans lui la piste ne se compare à rien et
la liste devient un pense-bête de plus.

**La tâche créée depuis une piste est mémorisée** dans `task_id`, mais l'interface vérifie qu'elle
existe encore dans le document du foyer avant d'afficher « tâche créée ». Une tâche supprimée
ailleurs délie la piste, qui repropose le bouton. Promettre une tâche disparue serait pire que ne
rien promettre.

Supprimer un contrat détache ses pistes (`ON DELETE SET NULL`) sans les emporter : l'idée
d'économiser survit au contrat qu'elle visait.

## 13. Sauvegarde du seul module

`GET /api/finances/export.json` rend un fichier JSON portant toutes les tables `fin_*`, une
version de format et la **version de schéma** en vigueur. `POST /api/finances/restore` le relit.

Ce n'est **pas** un remplacement de la sauvegarde du fichier SQLite, qui reste la référence et qui
emporte tout. C'est l'outil du cas précis : rejouer une manipulation qui a mal tourné, ou
déménager les finances vers une autre instance, sans toucher au reste du foyer.

**Les pièces jointes n'y sont pas.** Le JSON porte leurs métadonnées, les octets restent sur le
disque. Restaurer sur la même machine les retrouve ; restaurer ailleurs demande de copier le
répertoire `pieces` en plus, et le démarrage signale ce qui manque.

La restauration **écrase**, d'où quatre garde-fous :

- **Confirmation explicite** dans le corps de la requête (`confirm: "REMPLACER"`), qu'aucun appel
  accidentel ne portera ;
- **transaction unique**, avec `defer_foreign_keys` : une sauvegarde incohérente est refusée en
  bloc, la base reste exactement comme avant ;
- **refus d'une sauvegarde plus récente** que le schéma en place, qui pourrait porter des colonnes
  que cette version ne sait pas lire, et les perdre en silence ;
- **acceptation d'une sauvegarde plus ancienne**, les migrations du module étant additives : les
  colonnes ajoutées depuis prennent leur valeur par défaut.

En ligne de commande :

```bash
TOKEN=$(curl -s -X POST http://localhost:8099/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"vous@exemple.fr","password":"…"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')

# Sauvegarder
curl -s http://localhost:8099/api/finances/export.json -H "Authorization: Bearer $TOKEN" \
  -o foyer-finances-$(date +%F).json

# Restaurer (écrase le module)
python3 -c "import json,sys; b=json.load(open('foyer-finances-2026-08-19.json')); \
  print(json.dumps({'confirm':'REMPLACER','backup':b}))" > /tmp/restore.json
curl -s -X POST http://localhost:8099/api/finances/restore -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data-binary @/tmp/restore.json
```

## 14. Sauvegarde et restauration

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

# Les pièces jointes vivent à côté de la base : VACUUM INTO ne les prend pas.
docker compose exec -T foyer tar czf - -C /data pieces > ./pieces-$STAMP.tar.gz
```

> **En LXC, rien ne change** : `tar czf ... -C /var/lib/foyer .` prend déjà tout le répertoire de
> données, base et pièces comprises. Seule la méthode Docker demande les deux commandes
> ci-dessus, parce que `VACUUM INTO` ne connaît que la base.

Restauration :

```bash
docker compose stop foyer
docker compose cp ./foyer-2026-08-17-1430.db foyer:/data/foyer.db
docker compose cp ./pieces-2026-08-17-1430.tar.gz foyer:/data/pieces.tar.gz
docker compose exec -T foyer sh -c 'rm -f /data/foyer.db-wal /data/foyer.db-shm'
docker compose exec -T foyer sh -c 'rm -rf /data/pieces && tar xzf /data/pieces.tar.gz -C /data && rm /data/pieces.tar.gz'
docker compose start foyer
docker compose logs -f foyer
```

Le démarrage compte les écarts entre la base et le répertoire des pièces, et les affiche. Une
restauration cohérente n'affiche rien à ce sujet.

Supprimer les fichiers `-wal` et `-shm` est indispensable : laissés en place, ils réappliquent
des écritures qui ne correspondent plus à la base restaurée.

### Vérifier une sauvegarde

```bash
sqlite3 foyer-2026-08-17-1430.db "PRAGMA integrity_check;"
sqlite3 foyer-2026-08-17-1430.db "SELECT value FROM fin_meta WHERE key='schema_version';"
sqlite3 foyer-2026-08-17-1430.db "SELECT COUNT(*) FROM fin_transactions;"
sqlite3 foyer-2026-08-17-1430.db "SELECT COUNT(*) FROM fin_attachments;"
tar tzf pieces-2026-08-17-1430.tar.gz | wc -l   # doit couvrir les pièces ci-dessus
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

## 15. Tests

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
