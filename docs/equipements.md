# Équipements

Une fiche par appareil de la maison (lave-vaisselle, ampli, chaudière, alarme…) avec sa facture, la photo de sa plaque signalétique, son numéro de série, sa date d'achat et **l'état de sa garantie calculé à la date du jour**. Le jour d'une panne, on retrouve en deux gestes ce qu'il faut pour le SAV.

Le module se livre en trois tranches. Ce document décrit ce qui existe **aujourd'hui** ; l'état des lieux qui a fixé les choix est dans [`equipements-etat-des-lieux.md`](equipements-etat-des-lieux.md).

| Tranche | Contenu | État |
|---|---|---|
| 1 | Tables `eqp_*`, fichiers, API, calcul de garantie, réglages, sauvegarde | **livrée** |
| 2 | Pièces partagées avec Entretien, écran (liste groupée par pièce, recherche, filtres, fiche, prise de vue iPhone), menu « + », recherche globale | **livrée** |
| 3 | Rappels de fin de garantie, repères d'agenda, tuile d'accueil, outils d'assistant, export pour l'assurance | **livrée** |

## L'écran

Menu, groupe « Le foyer », **Équipements**.

- **En tête** : la recherche (désignation, marque, modèle, numéro de série ; casse, accents et espaces ignorés, les tirets comptent), « Ajouter un équipement », deux filtres (pièce, état de garantie) et le nombre de fiches.
- **Les cartes**, groupées par pièce dans l'ordre des pièces, puis « Sans pièce » : icône de catégorie, désignation, « marque · modèle », pastille de garantie (vert « Sous garantie jusqu'au … », orange « Garantie expire le … », gris « Hors garantie depuis le … » ou « Garantie inconnue ») et, s'il le faut, le statut (« En panne » en rouge). Un appareil remplacé, donné, jeté ou archivé est grisé.
- **Menu ⋯** : « Gérer les pièces » (adultes, mène à Paramètres) et « Voir les fiches archivées ».
- **Aucune pièce** : l'écran propose de créer les pièces de départ en un geste (Cuisine, Salon, Salle de bain, Chambre 1, Chambre 2, Bureau, Buanderie, Garage, Cave, Extérieur), ou de les choisir soi-même.
- **Aucune fiche** : un texte d'accueil explique le module.

**La fiche** s'ouvre par-dessus l'écran (le composant de fiche commun) :

- en tête la pastille de garantie et son explication (« 24 mois à partir du 12/03/2025, règle par défaut. »), puis le statut s'il n'est pas « en service » ;
- pièce, catégorie, marque et modèle, **numéro de série avec un bouton Copier**, date et prix d'achat, vendeur, état à l'achat ;
- les **pièces jointes** en vignettes (un tap ouvre la photo ou le PDF) et quatre boutons : « Photo de la plaque » (ouvre directement l'appareil photo sur iPhone), « Facture », « Notice », « Photo » ;
- l'**historique** : noter une panne, un appel au SAV, une réparation (avec son coût) sans passer en modification ;
- « Archiver » et « Modifier » en bas. En modification, la pastille de garantie se recalcule pendant qu'on tape, avec la même fonction que le serveur.

**Créer** : « + » puis « Équipement », ou « Ajouter un équipement ». Trois champs suffisent : désignation, pièce, photo de la plaque prise sur le moment. « Plus de détails » ouvre le reste, qu'on complète plus tard.

**Photos** : réduites dans le navigateur à 2 000 px de côté, en JPEG, avant l'envoi. Le redessin efface les métadonnées EXIF, position GPS comprise. Safari sur iPhone lit le HEIC et l'envoie converti ; Chrome ou Firefox sur Mac ne savent pas le lire et le disent, avec la marche à suivre (Aperçu, Exporter en JPEG).

**Menu ⋯, « Pour l'assurance »** (adultes) : la liste en PDF, la liste en tableur (CSV), ou la liste et les factures dans un zip. Voir [Export pour l'assurance](#export-pour-lassurance).

**Recherche globale** (loupe en haut) : les équipements y répondent par désignation, marque, modèle ou numéro de série ; « Somfy » trouve l'alarme.

Un enfant voit l'écran et les fiches, sans numéro de série, prix, vendeur ni coût, sans facture ni plaque, et sans aucun bouton d'écriture.

## Ce qui prévient

- **Rappel sur le téléphone**, aux adultes qui ont gardé « Sur le téléphone : fins de garantie » (Paramètres, Notifications, activé par défaut) : quand il reste moins de `eqpGarantieAlerteJours` jours (60 par défaut) avant la fin d'une garantie, à partir de 9 h. **Une seule fois par appareil et par date de fin** : la clé du journal d'envoi est `eqp-garantie|<id>|<date de fin>`, si bien qu'une garantie prolongée prévient à nouveau, et qu'un réglage changé ne fait pas repartir un rappel déjà reçu. Un tap ouvre la fiche. Un enfant n'en reçoit jamais ; « Suspendre tous les rappels du foyer » les coupe comme les autres.
- **Repère d'agenda** au dernier jour de chaque garantie en cours (« Fin de garantie », avec le nom de l'appareil), pour les appareils encore là (en service ou en panne). Ce n'est pas un événement : rien n'est écrit dans l'agenda, et le flux ICS ne le porte pas.
- **Tuile d'accueil** « Équipements » : ce qui demande d'agir d'abord (« 1 appareil en panne · 2 garanties expirent dans les 60 jours »), sinon « 12 fiches, rien à signaler ». Un tap ouvre l'écran.

Les trois disparaissent quand le module est éteint.

## Export pour l'assurance

Réservé aux adultes (un compte enfant reçoit 403). Il porte les appareils encore là : en service ou en panne, non archivés. Remplacés, donnés, vendus, jetés et archivés n'y sont pas.

| Format | Contenu |
|---|---|
| PDF | Un tableau A4 paysage : pièce, désignation, marque, modèle, numéro de série, date et prix d'achat, garantie, facture jointe ou non ; en pied, la valeur d'achat connue et le nombre d'appareils sans prix. S'ouvre sur l'iPhone. |
| CSV | Les mêmes colonnes et la catégorie, le vendeur, l'état à l'achat, le statut, et pour chaque appareil le chemin de sa facture dans le zip. Séparateur `;`, UTF-8 avec BOM, dates JJ/MM/AAAA, prix « 549,99 » : s'ouvre tel quel dans Numbers et Excel. Une valeur qui commencerait par `=`, `+`, `-` ou `@` est neutralisée (pas de formule exécutée au double-clic). |
| Zip | `equipements.csv`, `equipements.pdf`, et `factures/<pièce> - <désignation>.pdf`. **Une facture jointe à plusieurs fiches n'y est qu'une fois** ; le CSV dit, pour chaque appareil, quel fichier la porte. Une facture absente du disque est listée dans `absentes.txt` au lieu de faire échouer l'export. |

Le PDF et le zip sont écrits sans dépendance (`backend/src/export/`) : le zip n'est pas compressé (PDF et JPEG le sont déjà) et part au fil de l'eau, une facture à la fois en mémoire.

En shell, avec le jeton de session d'un adulte :

```sh
curl -s -H "Authorization: Bearer $JETON" -OJ https://foyer.example.fr/api/equipements/export/assurance.zip
unzip -l equipements-assurance-*.zip
```

## Assistant (MCP)

Six outils, décrits dans [`assistants.md`](assistants.md#équipements) : `equipements_liste`, `equipement_detail`, `equipement_pieces` (lecture), `equipement_creer`, `equipement_modifier`, `equipement_evenement` (écriture, adultes, jeton `write`). Même validation et même filtre enfant que l'écran ; aucun fichier ne sort par l'assistant. Une écriture garde le nom du jeton (`created_via`) et passe au journal du service.

## Qui voit quoi

| | Adulte | Enfant |
|---|---|---|
| Lire les fiches, les pièces, l'historique | oui | oui |
| Numéro de série, prix, vendeur, bien immobilier, coût d'une réparation | oui | **non** (absents de la réponse, pas seulement cachés) |
| Ouvrir une facture ou une photo de plaque | oui | **non** (403) |
| Ouvrir une notice ou une photo | oui | oui |
| Exporter pour l'assurance, recevoir les rappels de fin de garantie | oui | non |
| Rechercher par numéro de série | oui | non |
| Créer, modifier, archiver, joindre, noter une panne | oui | non (403) |
| Sauvegarder, restaurer le module | administrateur | non |

Le filtre est appliqué par le serveur. Les jetons d'API n'ont pas accès au module (l'assistant passera par le serveur MCP en tranche 3).

## La garantie

Calculée à chaque lecture, à la date du jour à Paris, jamais stockée. Quatre états :

| État | Pastille | Quand |
|---|---|---|
| `sous_garantie` | « Sous garantie jusqu'au 12/03/2027 » | il reste au moins `eqpGarantieAlerteJours` jours |
| `expire_bientot` | « Garantie expire le 12/03/2027 » | il reste moins de `eqpGarantieAlerteJours` jours (le dernier jour compte) |
| `hors_garantie` | « Hors garantie depuis le 13/03/2027 » | à partir du lendemain du dernier jour |
| `inconnue` | « Garantie inconnue » | pas de date d'achat, ou aucune durée connue |

La date de fin vient, dans l'ordre :

1. de la **date de fin saisie** sur la fiche (extension, contrat), qui l'emporte toujours ;
2. sinon de la **date d'achat** plus :
   - la **durée saisie** sur la fiche (en mois, durée constructeur) ;
   - sinon la **règle par défaut** selon l'état à l'achat :
     - neuf : le réglage `eqpGarantieDefautMois` (24 mois, garantie légale de conformité) ; à 0, la garantie reste inconnue ;
     - occasion achetée à un professionnel : 12 mois ;
     - occasion entre particuliers : **pas de garantie légale**, donc inconnue tant qu'aucune durée n'est saisie.

Les mois courts sont respectés : un achat le 31/01 avec 1 mois de garantie finit le 28/02 (29 les années bissextiles). Chaque fiche porte une phrase d'explication, par exemple « 24 mois à partir du 12/03/2025, règle par défaut. »

## Les fichiers

- Les octets vont dans le magasin partagé du foyer, `$FOYER_DATA_DIR/pieces/`, nommés par leur empreinte SHA-256 : un nom non devinable, et la même facture jointe à six fiches n'est stockée qu'une fois.
- Chaque fichier a une ligne dans `hh_attachments` (genre `equipment`) ; `eqp_attachments` relie une fiche à un fichier, avec son genre (`facture`, `plaque`, `notice`, `photo`, `autre`).
- Ces fichiers ne passent **que** par `/api/equipements/attachments/:id`, qui vérifie le module et le rôle à chaque requête. La route générique `/api/files/:id` répond 404 pour eux.
- Formats acceptés (reconnus d'après le contenu, pas l'extension) : JPEG, PNG, WEBP pour toutes les pièces ; PDF en plus pour une facture, une notice ou « autre ». Une plaque ou une photo est forcément une image.
- **Photos : 2 000 px au plus sur le grand côté.** L'application les réduit avant l'envoi ; le serveur lit les dimensions dans l'en-tête et refuse au-delà (422).
- **HEIC refusé** (415) avec un message qui dit quoi faire : sur iPhone, Foyer envoie du JPEG ; depuis un Mac, exporter en JPEG dans Aperçu.
- Taille : 20 Mo au plus par fichier. Une photo réduite pèse moins d'un mégaoctet, une facture scannée quelques-uns.
- Retirer une pièce jointe efface le fichier du disque dès que plus aucune fiche ne le cite. Le ménage du démarrage ne touche jamais un fichier cité par une fiche.

## Les pièces de la maison

**Une seule liste pour tout le foyer**, partagée avec Entretien : le socle Maison (`rooms` dans le document du foyer, `{ id, name, position }`). Une fiche garde l'identifiant de sa pièce (`eqp_items.room_ref`).

- Un foyer neuf n'a aucune pièce (choix d'Entretien) ; l'écran Équipements propose les pièces de départ en un geste.
- On les gère dans **Paramètres, « Pièces de la maison »** (groupe « Le foyer »), où mène aussi « Gérer les pièces » du menu ⋯ : ajouter, renommer, réordonner, supprimer. La section reste là quand les modules sont éteints, puisque les pièces appartiennent au foyer.
- Chaque pièce dit ce qu'elle contient (« 3 appareils et 1 geste d'entretien »). Supprimer une pièce qui n'est pas vide demande confirmation en le disant ; rien n'est effacé, appareils et gestes passent « Sans pièce » (un Annuler de quelques secondes la remet).
- Deux pièces ne portent jamais le même nom (casse et accents ignorés) : la création comme le renommage refusent le doublon.
- Les pièces appartiennent au foyer, pas au module : la remise à zéro d'Équipements ne les touche pas, et éteindre le module non plus.

**Reprise de la première version.** La tranche 1 rangeait les pièces dans sa propre table `eqp_rooms`. Au premier démarrage de la tranche 2, une reprise unique (drapeau `rooms_adopted` dans `eqp_meta`) :

- recopie les pièces non archivées d'`eqp_rooms` dans le socle Maison **s'il est vide**, dans leur ordre et avec leurs noms (« Chambre de Nolan » reste « Chambre de Nolan ») ;
- rattache chaque fiche à la pièce du socle qui porte le même nom (casse et accents ignorés), créée au besoin.

`eqp_rooms` et `eqp_items.room_id` restent en base, inutilisés : une migration additive ne supprime rien. Le journal le dit : `Équipements : pièces reprises dans la liste partagée du foyer (… pièce(s) recopiée(s), … fiche(s) rattachée(s)).`

## Ce qui n'est jamais supprimé

- Une fiche change de **statut** (`en_service`, `en_panne`, `remplace`, `donne_vendu`, `jete`), daté, puis s'**archive**. Elle reste lisible avec son historique.
- Noter une **panne** passe la fiche « en panne » ; noter une **réparation** d'un appareil en panne la remet « en service ».
- **Remplacer** un appareil : l'ancienne fiche passe « remplacé », pointe vers la nouvelle (`replaced_by`), et la nouvelle liste celle qu'elle remplace.
- Un événement d'historique s'archive, il ne s'efface pas.

## Réglages

| Clé | Portée | Défaut | Effet |
|---|---|---|---|
| `modEquipements` | foyer | activé | Désactivé : API en 403, section de réglages masquée ; les données restent. |
| `eqpGarantieDefautMois` | foyer | 24 (0 à 120) | Durée par défaut d'un appareil neuf sans durée saisie. 0 = pas de règle, garantie inconnue. |
| `eqpGarantieAlerteJours` | foyer | 60 (7 à 180) | Seuil de la pastille orange « Garantie expire le … », de la tuile d'accueil et du rappel sur le téléphone. |
| `eqpGarantieRappel` | personnel | activé | « Sur le téléphone : fins de garantie », dans Notifications. Coupé, ce membre ne reçoit plus ces rappels. |

## API

Tout est sous `/api/equipements`, derrière la session (cookie ou `Authorization: Bearer` de session), le drapeau `modEquipements` et l'appartenance au foyer. Montants dans les corps : euros (`"549,99"` ou `549.99`) ; dans les réponses : centimes.

| Méthode | Chemin | Qui | Rôle |
|---|---|---|---|
| GET | `/bootstrap` | membre | fiches, règles de garantie, droit d'écrire, biens immobiliers (s'il y en a plusieurs dans Finances) |
| GET | `/items?q=&room=&garantie=&categorie=&statut=&archived=1` | membre | liste filtrée ; `room` est l'identifiant d'une pièce du socle Maison, ou `none` pour les fiches sans pièce |
| GET | `/items/:id` | membre | fiche complète : pièces jointes, historique, remplacements |
| POST | `/items` | adulte | créer (seul `name` est requis ; `room_id` est l'identifiant d'une pièce du socle Maison) |
| PUT | `/items/:id` | adulte | modifier (champs présents seulement) |
| POST | `/items/:id/archive`, `/items/:id/unarchive` | adulte | archiver, désarchiver |
| POST | `/items/:id/replace` `{ by, day? }` | adulte | marquer remplacé par une autre fiche |
| POST | `/items/:id/events` `{ kind, text?, cost?, at? }` | adulte | noter une panne, un SAV, une réparation… |
| POST | `/events/:id/archive` | adulte | retirer un événement |
| POST | `/items/:id/attachments?kind=&filename=&label=` | adulte | joindre un fichier (corps brut) |
| GET | `/attachments/:id[?download=1]` | membre (enfant : notice et photo) | ouvrir |
| PUT, DELETE | `/attachments/:id` | adulte | requalifier, retirer |
| GET | `/export/assurance.csv`, `.pdf`, `.zip` | adulte | export pour l'assurance |
| GET | `/export.json` | administrateur | sauvegarde du module |
| POST | `/restore { backup, confirm: "REMPLACER" }` | administrateur | restauration du module |

Les pièces ne sont plus servies par le module (les routes `/rooms` de la tranche 1 ont disparu) : elles se lisent et s'écrivent avec le document du foyer (`GET` et `PUT /api/state`, clé `rooms`).

## Exploitation

### Avant la mise à jour qui crée les tables

La migration ne fait qu'**ajouter** les tables `eqp_*` et les dix pièces de départ ; elle ne modifie aucune table existante. Revenir à une version précédente de Foyer laisse ces tables inutilisées, sans effet. Une archive avant la mise à jour reste la règle :

```sh
# LXC
systemctl stop foyer
tar czf /root/foyer-avant-equipements-$(date +%F-%H%M).tar.gz -C /var/lib foyer
systemctl start foyer

# Docker (vérifiez le nom réel du volume : docker volume ls)
docker stop foyer
docker run --rm -v foyer-data:/data -v /root:/b alpine \
  tar czf /b/foyer-avant-equipements-$(date +%F-%H%M).tar.gz -C /data .
docker start foyer
```

Restauration de cette archive :

```sh
# LXC
systemctl stop foyer
rm -rf /var/lib/foyer
tar xzf /root/foyer-avant-equipements-AAAA-MM-JJ-HHMM.tar.gz -C /var/lib
chown -R foyer:foyer /var/lib/foyer
systemctl start foyer

# Docker
docker stop foyer
docker run --rm -v foyer-data:/data -v /root:/b alpine \
  sh -c 'rm -rf /data/* && tar xzf /b/foyer-avant-equipements-AAAA-MM-JJ-HHMM.tar.gz -C /data'
docker start foyer
```

### Vérifier que la migration est passée

```sh
journalctl -u foyer -b | grep 'Équipements'
# [foyer] Équipements : migration 1 appliquée (tables du module Équipements et pièces de départ).
# [foyer] Équipements : migration 2 appliquée (fiches rattachées aux pièces partagées du foyer).
# [foyer] Équipements : pièces reprises dans la liste partagée du foyer (10 pièce(s) recopiée(s), 0 fiche(s) rattachée(s)).

DB=/var/lib/foyer/foyer.db
sqlite3 $DB "SELECT value FROM eqp_meta WHERE key = 'schema_version';"   # 2
sqlite3 $DB "SELECT value FROM eqp_meta WHERE key = 'rooms_adopted';"    # date de la reprise
# Les pièces partagées, telles que le document du foyer les porte
sqlite3 $DB "SELECT json_extract(r.value, '$.position'), json_extract(r.value, '$.name')
             FROM household, json_each(household.state, '$.rooms') r ORDER BY 1;"
# Les fiches dont la pièce n'existe plus (elles s'affichent « Sans pièce »)
sqlite3 $DB "SELECT i.id, i.name FROM eqp_items i WHERE i.room_ref IS NOT NULL AND i.room_ref NOT IN
             (SELECT json_extract(r.value, '$.id') FROM household, json_each(household.state, '$.rooms') r);"
```

### Avant la mise à jour de la tranche 2

Elle ajoute une colonne (`eqp_items.room_ref`) et écrit dans le document du foyer (les pièces reprises). Même archive que ci-dessus, avec le même retour arrière : restaurer l'archive remet la base et le document d'avant, la reprise se rejouera au démarrage suivant.

### Sauvegarde

- **Sauvegarde globale** (bouton « Sauvegarder maintenant » ou script de [`sauvegarde-restauration.md`](sauvegarde-restauration.md)) : les tables `eqp_*` sont dans `foyer.db`, les fichiers dans `pieces/`. Rien de plus à faire, à condition d'archiver **les deux**.
- **Sauvegarde du module seul** : un fichier JSON avec les tables et la **liste** des fichiers (nom, type, empreinte), sans leurs octets.

```sh
# Le jeton de session d'un administrateur (cookie « foyer_session » du navigateur, ou réponse de /api/auth/login)
curl -s -H "Authorization: Bearer $JETON" https://foyer.example.fr/api/equipements/export.json \
  -o equipements-$(date +%F).json

# Restauration (écrase les données du module ; les fichiers sont retrouvés dans pieces/ par leur empreinte)
jq -n --slurpfile b equipements-AAAA-MM-JJ.json '{backup: $b[0], confirm: "REMPLACER"}' \
  | curl -s -X POST -H "Authorization: Bearer $JETON" -H 'content-type: application/json' \
      --data-binary @- https://foyer.example.fr/api/equipements/restore
```

La réponse de la restauration liste `missingFiles` : des fichiers cités par la sauvegarde mais absents de `pieces/`. S'il y en a, restaurez `pieces/` depuis l'archive complète.

### Requêtes utiles

```sh
DB=/var/lib/foyer/foyer.db
# Nombre de fiches, de pièces jointes, de fichiers (une facture partagée compte une fois)
sqlite3 $DB "SELECT (SELECT COUNT(*) FROM eqp_items WHERE archived_at IS NULL) AS fiches,
                    (SELECT COUNT(*) FROM eqp_attachments) AS rattachements,
                    (SELECT COUNT(*) FROM hh_attachments WHERE owner_kind = 'equipment') AS fichiers;"
# Les fichiers d'équipement absents du disque
sqlite3 $DB "SELECT rel_path, name FROM hh_attachments WHERE owner_kind = 'equipment';" \
  | while IFS='|' read -r p n; do [ -f "/var/lib/foyer/pieces/$p" ] || echo "absent : $n ($p)"; done
# Place occupée par les fichiers d'équipement
sqlite3 $DB "SELECT ROUND(SUM(size) / 1048576.0, 1) || ' Mo' FROM hh_attachments WHERE owner_kind = 'equipment';"
```

### Si ça ne va pas

| Symptôme | Cause probable | Que faire |
|---|---|---|
| `410` en ouvrant une facture | le fichier manque dans `pieces/` | restaurer `pieces/` depuis l'archive complète ; le journal de démarrage le signale aussi |
| `403 Ce module est désactivé.` | `modEquipements` éteint | Paramètres, Modules actifs |
| `422 Photo de 4032 × 3024 px` | photo envoyée sans réduction (script, ancienne version de l'app) | réduire à 2 000 px de côté avant l'envoi |
| `415` sur une photo d'iPhone envoyée depuis un Mac | HEIC | exporter en JPEG dans Aperçu |
| `413` | fichier de plus de 20 Mo | compresser le PDF (Aperçu, Exporter, filtre « Réduire la taille du fichier ») |
| Échec au démarrage « migration Équipements 1 » | base abîmée ou disque plein | `df -h /var/lib/foyer`, puis restaurer l'archive d'avant mise à jour ; la base reste en version précédente, rien n'est modifié à moitié |
