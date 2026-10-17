# Équipements

Une fiche par appareil de la maison (lave-vaisselle, ampli, chaudière, alarme…) avec sa facture, la photo de sa plaque signalétique, son numéro de série, sa date d'achat et **l'état de sa garantie calculé à la date du jour**. Le jour d'une panne, on retrouve en deux gestes ce qu'il faut pour le SAV.

Le module se livre en trois tranches. Ce document décrit ce qui existe **aujourd'hui** ; l'état des lieux qui a fixé les choix est dans [`equipements-etat-des-lieux.md`](equipements-etat-des-lieux.md).

| Tranche | Contenu | État |
|---|---|---|
| 1 | Tables `eqp_*`, pièces de départ, fichiers, API, calcul de garantie, réglages, sauvegarde | **livrée** |
| 2 | Écran (liste groupée par pièce, recherche, filtres, fiche, prise de vue iPhone), menu « + », recherche globale | à venir |
| 3 | Rappels de fin de garantie, repères d'agenda, tuile d'accueil, outils d'assistant, export pour l'assurance | à venir |

Tant que la tranche 2 n'est pas livrée, le module n'a **pas d'écran** : seuls son interrupteur (Paramètres, « Modules actifs ») et sa section de réglages sont visibles, et l'API répond.

## Qui voit quoi

| | Adulte | Enfant |
|---|---|---|
| Lire les fiches, les pièces, l'historique | oui | oui |
| Numéro de série, prix, vendeur, bien immobilier, coût d'une réparation | oui | **non** (absents de la réponse, pas seulement cachés) |
| Ouvrir une facture ou une photo de plaque | oui | **non** (403) |
| Ouvrir une notice ou une photo | oui | oui |
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
- **Photos : 2 000 px au plus sur le grand côté.** L'application les réduit avant l'envoi (tranche 2) ; le serveur lit les dimensions dans l'en-tête et refuse au-delà (422).
- **HEIC refusé** (415) avec un message qui dit quoi faire : sur iPhone, Foyer envoie du JPEG ; depuis un Mac, exporter en JPEG dans Aperçu.
- Taille : 20 Mo au plus par fichier. Une photo réduite pèse moins d'un mégaoctet, une facture scannée quelques-uns.
- Retirer une pièce jointe efface le fichier du disque dès que plus aucune fiche ne le cite. Le ménage du démarrage ne touche jamais un fichier cité par une fiche.

## Les pièces de la maison

Une donnée du foyer, pas du code : table `eqp_rooms`. Dix pièces sont posées à la création du module et à chaque remise à zéro : Cuisine, Salon, Salle de bain, Chambre 1, Chambre 2, Bureau, Buanderie, Garage, Cave, Extérieur. On les renomme, réordonne et archive. Une pièce qui contient encore des appareils ne s'archive pas : il faut d'abord les déplacer.

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
| `eqpGarantieAlerteJours` | foyer | 60 (7 à 180) | Seuil de la pastille orange « Garantie expire le … ». |

Le réglage personnel de rappel (`eqpGarantieRappel`) arrive avec les rappels, en tranche 3 : le déclarer avant qu'un rappel existe serait un réglage sans effet.

## API

Tout est sous `/api/equipements`, derrière la session (cookie ou `Authorization: Bearer` de session), le drapeau `modEquipements` et l'appartenance au foyer. Montants dans les corps : euros (`"549,99"` ou `549.99`) ; dans les réponses : centimes.

| Méthode | Chemin | Qui | Rôle |
|---|---|---|---|
| GET | `/bootstrap` | membre | pièces, fiches, règles de garantie, biens immobiliers (s'il y en a plusieurs dans Finances) |
| GET | `/items?q=&room=&garantie=&categorie=&statut=&archived=1` | membre | liste filtrée |
| GET | `/items/:id` | membre | fiche complète : pièces jointes, historique, remplacements |
| POST | `/items` | adulte | créer (seul `name` est requis) |
| PUT | `/items/:id` | adulte | modifier (champs présents seulement) |
| POST | `/items/:id/archive`, `/items/:id/unarchive` | adulte | archiver, désarchiver |
| POST | `/items/:id/replace` `{ by, day? }` | adulte | marquer remplacé par une autre fiche |
| POST | `/items/:id/events` `{ kind, text?, cost?, at? }` | adulte | noter une panne, un SAV, une réparation… |
| POST | `/events/:id/archive` | adulte | retirer un événement |
| POST | `/items/:id/attachments?kind=&filename=&label=` | adulte | joindre un fichier (corps brut) |
| GET | `/attachments/:id[?download=1]` | membre (enfant : notice et photo) | ouvrir |
| PUT, DELETE | `/attachments/:id` | adulte | requalifier, retirer |
| GET, POST | `/rooms` | membre, adulte | lister, créer |
| PUT | `/rooms/:id`, `/rooms-order { ids }` | adulte | renommer, réordonner |
| POST | `/rooms/:id/archive`, `/rooms/:id/unarchive` | adulte | archiver (pièce vide), désarchiver |
| GET | `/export.json` | administrateur | sauvegarde du module |
| POST | `/restore { backup, confirm: "REMPLACER" }` | administrateur | restauration du module |

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

sqlite3 /var/lib/foyer/foyer.db "SELECT value FROM eqp_meta WHERE key = 'schema_version';"   # 1
sqlite3 /var/lib/foyer/foyer.db "SELECT position, name FROM eqp_rooms ORDER BY position;"
```

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
