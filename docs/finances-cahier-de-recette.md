# Module Finances, cahier de recette de l'import

Ce document décrit les anomalies réelles que le moteur d'import doit absorber, sur des cas
observés dans les exports Bankin' du foyer. Il sert de spécification **et** de liste de tests.
Chaque anomalie est décrite avec le cas réel, la conséquence si elle n'est pas traitée, le
traitement retenu et l'assertion qui le vérifie.

Il est volontairement écrit à partir de fichiers fournis, pas de généralités : les décomptes
attendus sont vérifiables.

## 1. Jeu de données de référence

Trois fichiers composent le jeu de référence.

| Fichier | Période | Rôle | Statut |
|---|---|---|---|
| `export_banks_<déc>_20260728.csv` | décembre 2025 au 28/07/2026 | export brut Bankin', doublons intacts | **manquant** |
| `export_banks_20260728_20260831.csv` | 28/07/2026 au 17/08/2026 | export brut Bankin', doublons intacts | fourni |
| Résultat attendu, 807 opérations | décembre 2025 à août 2026 | oracle du décompte final | **manquant** |

**État de la recette au terme de la tranche 2.** Toutes les assertions ci-dessous tournent en
CI (`backend/test/import.test.ts`), sur un extrait anonymisé du fichier fourni. Les seules qui
restent en attente sont celles qui exigent le second export et l'oracle des 807, signalées
comme telles.

Les deux exports se chevauchent volontairement sur la **journée du 28/07/2026**, ce qui teste
le cas de l'export incrémental.

Les fichiers de référence complets ne sont pas versionnés (données personnelles). Les tests
automatisés utilisent des extraits anonymisés stockés dans `backend/test/fixtures/`, qui
reproduisent chaque anomalie à l'identique sur des libellés et des montants neutralisés.

## 2. Format Bankin' observé

```
Date;Description;Compte;Montant;Catégorie;Sous-Catégorie;Note;Pointée
"17/08/2026";"Prlv Direction Generale Des Fin";"Compte Courant …";"-562.0";"Impôts & Taxes";"Impôts fonciers";"";"Non"
```

- Séparateur point-virgule, **tous** les champs entre guillemets doubles.
- Date en `JJ/MM/AAAA`. Montant décimal **signé**, séparateur point.
- Encodage UTF-8 (vérifié sur le fichier fourni). Le lecteur reniflera quand même l'encodage :
  Bankin' a exporté du Windows-1252 par le passé, et la bascule serait indétectable à l'œil.
- Des champs contiennent le séparateur entre guillemets (`"Retraits, Chq. et Vir."`) et des
  apostrophes (`Prud'Homme`, `Pil'vite`) : le parseur doit gérer les guillemets, pas découper
  naïvement.
- Le fichier est une **concaténation de blocs**, un par couple (connexion bancaire, compte).
  Un bloc est une suite de lignes consécutives portant la même valeur dans la colonne `Compte`.
  Cette structure de blocs est la clé de tout le dédoublonnage, voir anomalie 1.

### Mojibake d'origine bancaire

Deux libellés du fichier fourni contiennent un `?` littéral à la place d'un caractère accentué :

```
Paiement Psc N?mes Spl Eclat Muroma
CB N?mes Spl Eclat Muroma
```

La perte vient de la banque, en amont de Bankin'. L'import **ne corrige pas** ces libellés :
l'empreinte de déduplication doit rester stable dans le temps, et « réparer » un libellé la
ferait changer d'un import à l'autre. Le nettoyage se fait au niveau des règles, qui écrivent
le libellé propre dans un champ séparé (`label`), en conservant `label_raw` intact.

## 3. Les six anomalies

### Anomalie 1, la triplication du compte perso et la duplication du joint

**Le cas réel.** Dans l'export du 28/07 au 31/08 :

- le compte personnel de Thomas apparaît **3 fois**, en 3 blocs de 24 lignes identiques
  (lignes 42-65, 106-129, 201-224) ;
- le compte joint apparaît **3 fois** aussi, en 3 blocs de 40 lignes, dont **deux blocs sous
  un libellé rigoureusement identique** (lignes 2-41 et 66-105) et un troisième sous un autre
  libellé (voir anomalie 2).

Cause : plusieurs connexions bancaires sont synchronisées et le foyer a un droit de regard
mutuel, donc le même compte remonte par plusieurs chemins.

**Si ce n'est pas traité.** 223 lignes deviennent 223 opérations. Le solde du joint est
multiplié par 3, chaque budget mensuel est faux d'un facteur 3, et le tableau de bord est
inexploitable.

**Piège à éviter.** Deux blocs du même compte peuvent porter un libellé **identique**. Une
règle du type « ne fusionner que si les libellés de compte diffèrent » ne marche pas ici :
c'est le découpage en blocs qui porte l'information, pas le libellé.

**Traitement retenu.**

1. Découper le fichier en blocs contigus sur la colonne `Compte`.
2. Résoudre le libellé de chaque bloc vers un compte réel (table d'alias, anomalie 2).
3. Pour chaque compte réel, calculer la signature de chaque ligne :
   `(date, montant en centimes, libellé brut normalisé)`.
4. Retenir, pour chaque signature, le **maximum** du nombre d'occurrences observé **dans un
   seul bloc**, et non la somme sur tous les blocs.

Le « maximum et non somme » est ce qui préserve les doublons légitimes. Cas réel dans le
fichier fourni : deux `Retrait Dab Remoulins Brinks` de 50,00 € le 05/08 sur le joint, présents
2 fois dans chacun des 3 blocs. Maximum = 2, les deux retraits sont conservés. Une
déduplication par simple ensemble de signatures rendrait 94 opérations au lieu de 95 et
avalerait un vrai retrait de 50 €.

**Tests.**

- `R1.1` [vérifié] 223 lignes brutes donnent 95 opérations.
- `R1.2` [vérifié] Décompte par compte : joint 40, Thomas 24, Nolwenn perso 6, Nolwenn pro 25.
- `R1.3` [vérifié] Les deux retraits DAB de 50 € du 05/08 sont tous les deux présents après import.
- `R1.4` [vérifié] Deux blocs de libellé strictement identique du même compte ne produisent pas de
  doublon (régression de la règle « libellés différents » abandonnée).

### Anomalie 2, le compte joint sous deux libellés

**Le cas réel.** Le compte joint apparaît sous deux libellés, à cause du changement de nom de
Nolwenn au mariage :

```
Compte Courant Mme N Prud Homme OU M T Prud'Homme     (80 lignes, 2 blocs)
Compte Courant Mle N Favier OU M T Prud'Homme         (40 lignes, 1 bloc)
```

Les 40 opérations sont les mêmes, ligne pour ligne. Rien dans le fichier ne relie les deux
libellés : ni identifiant de compte, ni IBAN, ni numéro.

**Si ce n'est pas traité.** Le joint est scindé en deux comptes dans l'application, chacun avec
la moitié de l'historique et un solde faux. Le problème est permanent, pas ponctuel : chaque
futur export ramènera les deux libellés.

**Traitement retenu.** Table d'alias persistante `fin_account_aliases` : un libellé normalisé
pointe vers un compte réel. Un libellé inconnu ne provoque **jamais** de création automatique
de compte : il est listé dans la section « comptes inconnus » du rapport d'import, et l'écran
propose de le rattacher à un compte existant ou d'en créer un. L'alias est mémorisé, les
imports suivants n'en reparlent plus.

Aucune heuristique de rapprochement automatique par similarité de nom. Deviner que
« Mle N Favier » et « Mme N Prud Homme » sont la même personne serait plus dangereux qu'utile :
en cas d'erreur, deux comptes réels fusionneraient sans que ce soit détectable.

**Tests.**

- `R2.1` [vérifié] Sans alias déclaré, l'import signale 5 comptes inconnus et n'écrit rien en base.
- `R2.2` [vérifié] Avec les deux libellés du joint pointant sur le même compte, le total tombe à 95.
- `R2.3` [vérifié] Un libellé inconnu ne crée jamais de compte tout seul.

### Anomalie 3, le chevauchement des exports

**Le cas réel.** L'export de décembre à juillet s'arrête au 28/07/2026 inclus. L'export de
juillet à août commence au 28/07/2026 inclus. La journée du 28/07 est donc dans les deux
fichiers. Elle contient **12 opérations** : 5 sur le joint, 3 sur le compte de Thomas, 4 sur le
compte professionnel.

**Si ce n'est pas traité.** Chaque export incrémental réinjecte sa zone de recouvrement. Sur
une pratique mensuelle, c'est une journée de doublons par mois, indétectable à l'œil dans une
liste de plusieurs milliers de lignes.

**Traitement retenu.** Empreinte de déduplication figée, calculée à l'import :

```
dedupe_key = hash(compte_réel, date, montant_centimes, libellé_brut_normalisé)
dedupe_seq = numéro d'occurrence pour cette empreinte
```

À chaque import, pour chaque empreinte : si le fichier en apporte N et que la base en contient
déjà M, on insère `max(0, N - M)` lignes. Réimporter le même fichier donne 0 nouvelle
opération. Un export qui chevauche n'apporte que son delta.

Point critique : l'empreinte est calculée sur le libellé **brut** et **stockée en dur** dans la
ligne. Si tu renommes ou recatégorises une transaction après coup, son empreinte ne bouge pas,
donc un réimport ultérieur ne la ressuscite pas en double. C'est le bug classique des outils
qui recalculent la clé à la volée.

**Tests.**

- `R3.1` [vérifié] Importer le fichier de juillet-août deux fois de suite : le second import annonce
  0 nouvelle opération et 95 doublons écartés.
- `R3.2` [vérifié sur un fichier tronqué, à rejouer sur le vrai export] Importer déc-juillet puis juillet-août : le second import écarte exactement les
  **12** opérations du 28/07 et n'en perd aucune autre.
- `R3.3` [vérifié sur un fichier tronqué, à rejouer sur le vrai export] Importer dans l'ordre inverse donne le même total final.
- `R3.4` [vérifié] Modifier le libellé et la catégorie d'une transaction, réimporter son fichier
  d'origine : aucune ligne créée, la modification est préservée.

### Anomalie 4, les virements internes

**Le cas réel.** Trois virements internes dans le fichier fourni, avec des libellés **différents
de chaque côté** :

| Montant | Débit | Crédit |
|---|---|---|
| 2 000 € | Thomas 05/08 `Vir Compte Commun` | joint 05/08 `Vir De M Prud Homme Thomas` |
| 2 000 € | Nolwenn pro 03/08 `Vir Compte Pro` | Nolwenn perso 03/08 `Compte Perso` |
| 1 700 € | Nolwenn perso 08/08 `Vir Correction Virement Rejete` | joint 08/08 `Correction Virement Rejete` |

Aucune paire ne partage de libellé commun exploitable. Le cas « un jour d'écart » est présent
dans l'export de décembre à juillet.

**La sous-catégorie Bankin' n'est pas un signal fiable.** Dans ce même fichier :

- `Vir De M Prud Homme Thomas` +2 000 €, vrai virement interne, est rangé en
  « Entrées d'argent / Remboursements » ;
- `Vir Loyer` +366 €, qui est un loyer encaissé et **pas** un virement interne, est rangé en
  « Entrées d'argent / Virements internes ».

La sous-catégorie est donc au mieux un indice pondéré, jamais une décision.

**Si ce n'est pas traité.** Chaque virement compte double : une fois en dépense, une fois en
recette. Le total des dépenses du foyer est gonflé de 5 700 € sur trois semaines dans ce seul
fichier, et le tableau de bord mensuel devient faux.

**Traitement retenu.** Détection par montants opposés, comptes différents, écart de date
inférieur ou égal à 3 jours, appariement au plus proche. Puis notation de confiance :

- **forte** : même jour, et au moins un côté porte un marqueur de virement (`Vir`, `Virement`,
  `Prlv` interne) ou nomme l'autre compte ;
- **moyenne** : 1 à 3 jours d'écart avec marqueur de virement ;
- **faible** : montants opposés sans marqueur, ou un côté est un retrait d'espèces, un chèque
  ou une remise de carte.

**Les candidats sont proposés, jamais fusionnés silencieusement.** Seuls les candidats de
confiance forte sont pré-cochés. Les faibles sont affichés décochés, repliés derrière
« rapprochements douteux ».

Cette prudence n'est pas théorique. Le détecteur prototype a proposé ce rapprochement sur le
fichier fourni :

```
50,00 €  Nolwenn pro  03/08  « Remcb00677 »
      -> joint        05/08  « Retrait Dab Remoulins Brinks »   [2 jours d'écart]
```

Un retrait d'espèces et une remise de carte sans aucun rapport, appariés par coïncidence de
montant. Une fusion automatique aurait détruit deux opérations réelles.

Une fois validée, une paire partage un `transfer_group` : les deux lignes restent en base
(les soldes de compte doivent rester justes) mais l'opération s'affiche une seule fois et
n'entre ni dans les dépenses ni dans les recettes du foyer.

**Tests.**

- `R4.1` [vérifié] Les trois virements réels sont détectés, tous en confiance forte.
- `R4.2` [vérifié] La paire `Remcb00677` / `Retrait Dab` est classée en confiance faible et **non
  pré-cochée**.
- `R4.3` [vérifié] Aucune fusion n'a lieu sans validation explicite.
- `R4.4` [vérifié] Après validation, les deux lignes sont conservées, le total des dépenses du mois
  baisse de 5 700 €, et les soldes des deux comptes sont inchangés.
- `R4.5` [vérifié] `Vir Loyer` +366 €, étiqueté « Virements internes » par Bankin', n'est pas proposé
  comme virement interne (pas de contrepartie).

### Anomalie 5, la couverture inégale des comptes

**Le cas réel.** Les comptes ne couvrent pas tous la même période :

- le compte **TPH-IT** s'arrête au **19/03/2026** (connexion bancaire rompue depuis) ;
- les **livrets** (LDDS, livrets enfants) s'arrêtent au **31/12/2025**.

**Si ce n'est pas traité.** Le tableau de bord d'avril affiche des dépenses en baisse et un
solde en hausse, alors qu'il manque simplement un compte. Pire : la comparaison d'une année
sur l'autre est faussée sans qu'aucun chiffre ne paraisse anormal. C'est le mode de panne le
plus vicieux du module, parce qu'il produit des nombres plausibles.

**Traitement retenu.** Le module calcule, pour chaque compte, la date de sa dernière opération
connue. Un mois est déclaré **incomplet** dès qu'un compte actif non archivé n'a aucune
opération après le début de ce mois. Le tableau de bord affiche alors un bandeau explicite du
type « mois incomplet : TPH-IT s'arrête au 19/03, LDDS au 31/12 », avec le détail compte par
compte.

Un compte que tu ne veux plus suivre se marque **archivé** : il sort du calcul de complétude
sans que son historique soit supprimé. C'est le seul moyen de faire taire l'alerte, et c'est
volontaire : elle doit être fermée par une décision, pas par un oubli.

**Tests.**

- `R5.1` [vérifié] Après import des deux fichiers, la couverture par compte est exacte au jour près.
- `R5.2` [vérifié] Un mois postérieur à l'arrêt d'un compte actif est marqué incomplet, avec le nom du
  compte et sa date de fin dans le message.
- `R5.3` [vérifié] Archiver le compte retire l'alerte sans modifier les totaux historiques.
- `R5.4` [vérifié] Un mois où tous les comptes actifs ont des opérations n'est pas marqué incomplet.

### Anomalie 6, les catégories Bankin' peu fiables

**Le cas réel.** Quatre prélèvements AXA, tous rangés en « Auto & Transports / Assurance
véhicule » :

| Date | Montant | Libellé | Réalité probable |
|---|---|---|---|
| 10/08 | -139,12 € | `Prlv Sepa Axa France Vie Sa` | assurance vie, pas auto |
| 10/08 | -635,46 € | `Prlv Sepa Axa` | montant incompatible avec une prime auto mensuelle |
| 05/08 | -81,69 € | `Prlv Sepa Axa` | à qualifier |
| 05/08 | -40,63 € | `Prlv Sepa Axa` | à qualifier |

Trois de ces lignes portent un libellé **strictement identique** (`Prlv Sepa Axa`) pour trois
montants différents, donc probablement trois contrats différents. C'est exactement le cas
Engie décrit dans le brief (deux contrats, même libellé `Prlv Sepa Engie Mandat`, distingués
par la fourchette de montant), mais présent noir sur blanc dans le fichier fourni.

Autres incohérences relevées dans le même fichier :

- `Paiement Psc N?mes Spl Eclat Muroma` -30,00 € en « Entretien véhicule » et
  `CB N?mes Spl Eclat Muroma` -14,15 € en « Logement », **même commerçant, même jour**, deux
  catégories différentes ;
- `Paiement Psc /orange Stationnement Or` -2,20 €, du stationnement, rangé en
  « Abonnements / Téléphonie mobile » ;
- `CB Orange Aura Monuments` -10,00 €, une visite de monument dans la ville d'Orange, rangée
  elle aussi en « Téléphonie mobile ».

Dans les deux derniers cas, Bankin' a confondu le nom de la commune avec l'opérateur télécom.

**Si ce n'est pas traité.** Le poste « Auto & Transports » absorbe des assurances vie et des
sorties culturelles. Les budgets de référence par catégorie deviennent inatteignables et
l'écart au budget ne veut plus rien dire.

**Traitement retenu.** Les colonnes `Catégorie` et `Sous-Catégorie` de Bankin' sont importées
comme **suggestion de départ**, jamais comme vérité, et sont écrasées par le moteur de règles
dès qu'une règle correspond. Le rejeu des règles sur l'historique permet de corriger le passé
d'un coup après avoir écrit une règle.

Le moteur doit donc savoir distinguer par le **montant** deux opérations de libellé identique :
condition `libellé contient` combinée en ET avec `montant entre X et Y`, action
`rattacher au contrat`. C'est le besoin structurant du module, pas une option.

**Tests.**

- `R6.1` Une règle `libellé contient "Prlv Sepa Axa"` ET `montant entre 600 et 700` rattache
  la ligne à -635,46 € et **elle seule** parmi les quatre AXA. **Vert.**
- `R6.2` Deux règles concurrentes sur le même libellé, distinguées par fourchette de montant,
  n'affectent chacune que leurs lignes. **Vert**, sur les trois AXA au libellé identique.
- `R6.3` La prévisualisation d'une règle liste exactement les lignes qui seront modifiées,
  avant enregistrement. **Vert**, et rien n'est écrit tant qu'on n'a pas enregistré.
- `R6.4` Le rejeu sur l'historique est idempotent : rejouer deux fois donne le même résultat.
  **Vert**, y compris pour une règle qui ne pose qu'une étiquette.
- `R6.5` L'ordre des règles et l'option « arrêter le traitement » sont respectés. **Vert**,
  de même que la protection des catégories corrigées à la main.

Le rattachement à un contrat n'est pas encore une action disponible : les contrats arrivent en
tranche 5. Proposer le choix aujourd'hui afficherait une liste vide. Les cinq critères et les
quatre actions livrés couvrent le besoin de tri ; l'action « rattacher au contrat » s'ajoutera
au même moteur, sans migration de règles.

## 4. L'oracle

Le test d'intégration part des **deux fichiers bruts**, dans l'ordre chronologique, avec les
alias de compte déclarés, et vérifie le décompte final **compte par compte**.

| Vérification | Attendu |
|---|---|
| Total des opérations après les deux imports | **807** |
| Décompte par compte | à figer depuis le fichier oracle |
| Import du fichier juillet-août seul | 223 lignes brutes, **95** opérations |
| Décompte par compte sur ce fichier | joint 40, Thomas 24, Nolwenn perso 6, Nolwenn pro 25 |
| Opérations du 28/07 écartées au second import | **12** |
| Réimport de l'un ou l'autre fichier | 0 nouvelle opération |

Le décompte global de 807 ne suffit pas comme test : deux erreurs opposées peuvent se
compenser. Le décompte **par compte** est l'assertion qui compte, et les décomptes par compte
du fichier de juillet-août sont déjà figés ci-dessus.

> **À jour au 19/08/2026 :** l'oracle des 807 reste en attente. Les fichiers fournis depuis
> couvrent la même période dans deux formats, pas deux fenêtres qui se chevauchent, donc ils ne
> peuvent pas le remplacer. Voir la section 6.

## 5. Ce qui est automatisé

`backend/test/import.test.ts` rejoue le pipeline complet sur l'extrait anonymisé
(`backend/test/fixtures/bankin-aout.csv`, 223 lignes) et vérifie :

| Assertion | Attendu | Statut |
|---|---|---|
| Découpage en blocs | 40, 24, 40, 24, 6, 25, 40, 24 | vert |
| Total après effondrement | **95** | vert |
| Décompte par compte | joint 40, perso 24, conjoint 6, cabinet 25 | vert |
| Doublons légitimes conservés | les 2 retraits de 50 € du 05/08 | vert |
| Réimport du même fichier | 0 nouvelle opération | vert |
| Chevauchement du 28/07 | **12** opérations de delta | vert |
| Virements détectés | 3, tous en confiance forte | vert |
| Faux rapprochement retrait/remise | classé douteux, jamais pré-coché | vert |
| Effet d'une fusion sur le mois | dépenses **−5 700 €**, soldes inchangés | vert |
| Libellés AXA identiques | 3 lignes, 3 montants, aucune catégorie appliquée | vert |
| Mojibake `N?mes` conservé | libellé brut intact | vert |

`backend/test/rules.test.ts` construit ses règles sur les mêmes lignes et vérifie :

| Assertion | Attendu | Statut |
|---|---|---|
| `R6.1` libellé ET fourchette de montant | 1 ligne sur 4, la bonne | vert |
| `R6.2` trois règles sur le libellé identique | 3 catégories distinctes | vert |
| `R6.3` prévisualisation fidèle, sans écriture | annoncé = appliqué | vert |
| `R6.4` rejeu idempotent | 0 modification au second passage | vert |
| `R6.5` ordre des règles et « arrêter là » | dernière décision retenue | vert |
| Catégorie corrigée à la main | conservée, et comptée dans le rapport | vert |
| Étiquette posée deux fois | une seule occurrence, ligne non appropriée | vert |
| Réécriture de libellé | `label` change, `label_raw` intact | vert |
| Marquage en virement interne | la ligne sort des dépenses du mois | vert |
| Suppression d'une règle | catégorie conservée, provenance libérée | vert |

`backend/test/parsers.test.ts` couvre les formats : CSV (Bankin et anglais, débit/crédit
séparés), OFX 1.x et 2.x, CAMT.053, .xlsx réel, faux .xls HTML et texte, refus du binaire
Excel 97-2003, et les encodages UTF-8, UTF-16 et Windows-1252.

## 6. Le grand export, et ce qu'il apprend

Un export couvrant **du 01/01/2025 au 17/08/2026** a été fourni, en CSV et en XLS. Le pipeline
l'encaisse sans rien rejeter :

| Mesure | Valeur |
|---|---|
| Lignes lues | **5 333** |
| Lignes rejetées | 0 |
| Libellés de compte distincts | 11, en **14 blocs** |
| Lignes effondrées (copies du même relevé) | **2 213** |
| Opérations réelles obtenues | **3 120** |

Le compte le plus synchronisé apparaît en trois blocs de 303, 909 et 638 lignes et donne
**909** opérations : la règle du maximum par bloc tient à cette échelle, là où la somme en
aurait inventé 941 et où un simple ensemble d'empreintes en aurait perdu.

Trois constats, sans détour :

- **L'oracle des 807 ne s'applique pas à ces fichiers.** Il supposait deux exports de périodes
  différentes se chevauchant sur le 28/07. Ici les deux fichiers couvrent la **même** période :
  c'est un seul export dans deux formats, pas un export incrémental. `R3.2` et `R3.3` restent
  donc à vérifier sur un vrai second export, plus tardif, quand il y en aura un.
- **Le XLS n'est pas un export Bankin'**, c'est une conversion du CSV : ses métadonnées portent
  `Last Saved By: cloudconvert_18`. C'est un classeur **Excel 97-2003 binaire (BIFF8)**, le seul
  format que le module refuse, avec le message qui dit de réexporter en CSV ou en .xlsx.
  Autrement dit, Bankin' exporte en CSV, et le CSV se lit.
- **Le fichier n'est pas versionné.** Il contient des données bancaires réelles et des noms de
  famille : le dépôt n'accueille que l'extrait anonymisé de 223 lignes. Figer un oracle à
  3 120 opérations demanderait d'anonymiser d'abord les 5 333 lignes, ce qui est faisable mais
  n'a pas été fait sans arbitrage.

## 7. Ce qui reste à fournir

- Un **second export plus tardif**, chevauchant celui-ci, pour vérifier `R3.2`, `R3.3`, `R5.1`
  et `R5.2` sur des données réelles.
- Un vrai export **XLS de banque** (pas une conversion), si un établissement en produit : le
  lecteur de faux .xls (tableau HTML, texte tabulé) n'a pas encore rencontré de cas réel.
