# Entretien de la maison

Les gestes d'entretien qui reviennent et que personne ne note : la cartouche de
la carafe toutes les 4 semaines, le test des détecteurs de fumée tous les 6 mois,
la chaudière chaque année. Chaque geste dit quoi, à quelle fréquence, où, quand
il a été fait et par qui, quand il revient, et ce qu'il reste en stock.

Cadrage et choix : `docs/entretien-etat-des-lieux.md`.

> État : livré en trois tranches (socle, écran, puis stock et courses, accueil,
> équipements et assistant), puis les gestes saisonniers et à fenêtre, et le
> coût des gestes avec leur total annuel dans Finances.

## L'écran

Menu « Le foyer » → **Entretien**. Par défaut, les gestes par date :

| Groupe | Ce qui y est |
|---|---|
| En retard | Échéance (plus sa souplesse) dépassée. |
| Dans les N jours | À faire d'ici l'horizon du réglage `entretienHorizonJours` (14 par défaut). |
| Plus tard | Au-delà, les gestes en pause, et ceux de saison en attendant la reprise. |
| Pas encore noté | Jamais faits : pas de date, jamais en retard. |
| Archivés | Repliés en bas, avec « Réactiver ». |

Le segment **Par pièce** range les mêmes gestes par pièce (« Sans pièce » en
dernier). Chaque ligne dit le geste, son détail, la pièce, la fréquence en
clair (« toutes les 4 semaines »), « Fait le … par … » ou « Pas encore noté »,
la prochaine date (« Reprend le 01/05/2027 » hors saison, « Entre le 01/09 et le
31/10 » puis « À faire d'ici le 31/10 » pour une fenêtre) ou la pause, le stock, et porte **Fait** : un
tap, annulable quelques secondes (le bouton devient « ✓ Fait aujourd'hui »). La case ronde
devant le geste fait la même chose ; son anneau se remplit d'une réalisation à l'autre
(vide juste après « Fait », plein à l'échéance, rouge en retard).
Le menu « … » propose **Fait un autre jour** (date, et qui : un membre ou « le
foyer »), **Modifier**, **Mettre en pause** jusqu'à une date (ou **Reprendre
maintenant**), **Archiver**, et la fiche avec l'historique complet.

**Nouveau geste** ouvre le catalogue (recherche, rangé par famille) ou une
fiche libre. Depuis le catalogue, tout est prérempli, pièce comprise (créée si
elle n'existe pas) : choisir, puis « Créer le geste ». On y règle la
fréquence (semaines, mois, années, ou date fixe), la pièce, le
détail, le stock, qui s'en charge, le rappel, et « Dernière fois » quand on la
connaît (le geste part alors de cette date au lieu de rester « Pas encore
noté »). La quantité d'un stock existant ne se modifie pas dans la fiche.

### Saisons et fenêtres

Deux besoins différents, deux réglages de la fiche :

| Besoin | Exemple | Dans la fiche |
|---|---|---|
| Répété, mais seulement une partie de l'année | Le pH de la piscine chaque semaine, de mai à septembre | Semaines, mois ou années, puis « Seulement une partie de l'année » : de tel mois à tel mois. |
| Une fois par an, dans une fenêtre | Ramoner entre le 1er septembre et le 31 octobre | « Date fixe », « À partir du » et « Au plus tard le ». |

Un geste de **saison** ne revient pas hors saison : fait le 28 septembre, le
suivant tombe le 1er mai, pas le 5 octobre, et il attend dans « Plus tard » en
disant « Reprend le … », sans rappel d'ici là. Créé hors saison, il prend
directement la date de reprise. La saison remplace la pause pour ce qui revient
chaque année ; la pause reste pour l'imprévu (absence, appareil en panne).

Un geste à **fenêtre** n'est en retard qu'après la fin de la fenêtre. C'est la
souplesse du moteur de récurrence, saisie par sa date de fin (voir
`docs/taches.md`, « La saison » et « La tolérance »). Fait dans la fenêtre, il
revient au début de la fenêtre de l'année suivante.

Dans **Tâches**, la liste Entretien a son onglet ; la fiche d'un geste y montre
la pièce, le stock, le détail et toutes ses réalisations, avec « Ouvrir dans
Entretien ».

## Le principe : pas un moteur de plus

Un geste d'entretien **est une tâche** de la liste Entretien. Il hérite de tout
ce que Tâches sait faire : récurrence (`base: 'done'` pour repartir du jour du
geste, `base: 'due'` pour une date fixe), tolérance, rappels, historique de qui
l'a fait et quand, opérations journalisées et rejouées hors ligne. Entretien
ajoute une liste à part, quelques champs, et trois règles sur la coche.

### La liste

Une seule par foyer, `kind: 'entretien'`, d'identifiant fixe `entretien`,
partagée. Créée par la migration 14 (foyers existants) et à l'onboarding. Elle
ne se renomme, ne se supprime ni ne s'archive : le serveur la remet en place si
un enregistrement du document l'omet, sans quoi ses gestes partiraient avec
elle. Elle ne compte pas dans « Aujourd'hui » (comme les corvées).

### Les champs d'un geste

```ts
maintenance?: {
  roomId?: string;        // pièce du socle Maison (rooms)
  howto?: string;         // le détail du geste
  stock?: { qty, unit, use, threshold, article, countedAt };
  pausedUntil?: string;   // en pause jusqu'à ce jour
  catalogId?: string;     // geste type du catalogue dont il est une copie
}
```

Refusés hors de la liste Entretien. Validés dans `backend/src/tasks/ops.ts`
(les tâches ne passent pas par la validation du document). La pièce n'est pas
vérifiée contre `rooms` : une pièce créée avec le geste part par
l'enregistrement du document, qui peut arriver après lui (hors ligne) ; une
pièce qui n'arrive jamais est retirée à l'enregistrement suivant du document.
Une quantité ou une date mal formée est refusée et nommée.

`use` est ce qu'un geste consomme (un test des quatre détecteurs prend quatre
piles). `countedAt` est le jour du dernier changement connu de la quantité :
c'est ce que l'écran affiche en « Stock au … ».

### Les pièces (socle Maison)

`rooms: { id, name, position }[]` dans le document, hors de tout module : le
module Équipements y range aussi ses appareils. On les gère dans **Paramètres,
« Pièces de la maison »** (lien « Gérer les pièces » sous « Par pièce »), même
quand Entretien et Équipements sont éteints. Une pièce supprimée fait passer
ses gestes « Sans pièce », elle ne les supprime pas. Un téléphone resté
sur une version antérieure, qui ne connaît pas `rooms`, ne les efface pas en
enregistrant.

## « Fait aujourd'hui »

C'est la coche ordinaire (opération `done`), la même depuis Entretien, depuis
Tâches ou depuis un assistant. Dans la liste Entretien, elle fait en plus :

| Règle | Pourquoi |
|---|---|
| **Une réalisation par jour** (heure de Paris). La seconde est acquittée sans effet. | Deux téléphones qui notent le même geste le même jour : une réalisation, un seul consommable en moins. Un téléphone périmé est déjà écarté par l'échéance qu'il croit solder. |
| **La date suivante est calculée par le serveur**, depuis le jour du geste. | Pas de retard cumulé : fait le 20/11 au lieu du 14/11, la suivante est le 18/12. Et un assistant n'a personne pour la calculer. |
| **Le stock baisse dans la même opération**, plancher zéro. La ligne d'historique retient ce qui a été pris. | Atomique, journalisé, rejoué une seule fois ; l'annulation rend exactement ce qui a été pris. |
| Une réalisation **antérieure à la dernière notée** est refusée, avec la date. | Elle ferait reculer la prochaine échéance. |
| Fait pendant une **pause** : la pause s'arrête. | Le geste a eu lieu. |

« Fait un autre jour » est la même opération, avec la date choisie et le membre
choisi, ou personne (« par le foyer », pour les grands-parents).

**Annuler** (l'opération `reopen`) rétablit l'échéance soldée, y compris
« Pas encore noté » après une première réalisation, et rend le stock.

### « Pas encore noté »

Un geste jamais fait n'a **pas d'échéance**. Pas de date inventée, donc jamais
« en retard », rien sur l'accueil, et aucun rappel (on ne réclame pas un geste
dont on ignore quand il a été fait). Le rappel choisi à la création est gardé et
sonne dès la première réalisation.

### Le stock

L'opération `stock` dit une intention : `add` (« j'en ai racheté 6 ») ou `set`
(« j'en compte 4 »), avec la date. Modifier la fiche d'un geste ne réécrit
jamais la quantité d'un stock existant : un formulaire ouvert sur un téléphone
remettrait sinon la quantité d'avant le geste noté entre-temps sur l'autre.

## Le catalogue des gestes

Une trentaine de gestes courants proposés à la création, jamais imposés : un
geste choisi est une copie modifiable. Livré dans
`backend/config/entretien-catalogue.json`, servi par `GET /api/entretien/catalogue`
(tout membre, 403 quand le module est éteint).

Chaque entrée : `id`, `titre`, `howto`, `famille` (regroupe la liste de choix),
`piece` (suggérée), `rec` (`freq`, `every`, `base`, `grace`, `season`), et
`article` éventuel (`nom`, `unite`, `use`, `seuil`). `season`
(`{ "from": "05-01", "to": "09-30" }`) est la saison d'un geste répété
(`base: "done"`), ou la **fenêtre** d'un geste à date fixe (`base: "due"`) :
à la création, elle devient la prochaine échéance (la fenêtre qui court, sinon
la suivante) et sa souplesse. La pièce d'un geste se propose par son nom
(`piece`) : retrouvée dans les pièces du foyer, ou créée avec le geste.

### L'adapter à votre foyer

Créez un fichier **du même nom dans le dossier des données**, avec seulement ce
qui change. Il est fusionné avec le catalogue livré par identifiant : une
entrée de même `id` remplace, une nouvelle s'ajoute, `"retire": true` masque.
Il est relu dès qu'il change, sans redémarrer, et une mise à jour de Foyer ne
l'écrase pas. Une clé `pieces` laissée par une version précédente est ignorée.

```json
{
  "gestes": [
    { "id": "piscine-ph", "retire": true },
    { "id": "carafe-filtrante", "titre": "Carafe Brita : changer la cartouche", "famille": "Eau", "piece": "Cuisine",
      "rec": { "freq": "weekly", "every": 4, "base": "done" },
      "article": { "nom": "Cartouche Brita MAXTRA PRO", "unite": "cartouche", "use": 1, "seuil": 1 } },
    { "id": "aquarium", "titre": "Aquarium : changer un quart de l’eau", "famille": "Maison",
      "rec": { "freq": "weekly", "every": 2, "base": "done" } }
  ]
}
```

```bash
# LXC (dossier des données par défaut)
nano /var/lib/foyer/entretien-catalogue.json
chown foyer:foyer /var/lib/foyer/entretien-catalogue.json   # si le service tourne sous l'utilisateur foyer
python3 -m json.tool /var/lib/foyer/entretien-catalogue.json >/dev/null && echo "JSON valide"
journalctl -u foyer --since "10 min ago" | grep Entretien

# Docker (volume monté sur /data)
docker cp entretien-catalogue.json foyer:/data/entretien-catalogue.json
docker logs --since 10m foyer 2>&1 | grep Entretien
```

Une entrée mal formée est écartée et nommée au journal (« geste écarté du
catalogue (surcharge) : … »), les autres restent. Un fichier qui n'est pas du
JSON valide est ignoré en entier, avec un message, et le catalogue livré
s'applique seul : rien ne casse, mais vos ajouts n'apparaissent pas.

## Le stock et les courses

Sur la ligne d'un geste qui consomme quelque chose : **J'en ai racheté**
(« 6 de plus ») ou **J'ai compté** (« il en reste 4 »), daté, annulable. Le
stock baisse tout seul à chaque geste fait.

Au seuil ou en dessous, la ligne propose **Ajouter aux courses** : l'article
part dans la liste principale (la première), sans doublon (un article déjà « à
prendre » du même nom n'est pas ajouté de nouveau), et dans un vrai rayon :
celui où le foyer l'a déjà rangé (mémoire des courses), sinon le rayon de type
« entretien », sinon le repli. Le bouton devient « Dans les courses ».

Avec le réglage `entretienCoursesAuto`, l'article part **seul** au passage sous
le seuil : une fois par passage (`stock.alerted`, posé par le serveur au
passage et levé quand le stock remonte au-dessus du seuil), pas à chaque geste
fait sous le seuil. L'ajout se fait hors de la transaction du geste : s'il
échoue, le geste reste noté et le journal le dit (« Entretien : ajout aux
courses impossible… »). Le chemin est le même que l'outil d'assistant
`courses_ajouter` (`backend/src/shopping/add.ts`).

## L'accueil

Une carte « Entretien » (bandeau sur ordinateur, carrousel sur téléphone)
n'apparaît que s'il y a quelque chose à dire : « Entretien : 1 en retard, 2
dans les 14 jours », trois gestes au plus avec **Fait aujourd'hui**, et les
stocks bas avec **Ajouter aux courses**. Tout à jour : pas de carte, jamais de
zéro. Les gestes jamais notés n'y comptent pas.

## Avec Équipements

Un geste peut être rattaché à un appareil (`maintenance.equipmentId`), au choix
dans sa fiche quand le module Équipements est allumé (l'appareil range aussi le
geste dans sa pièce si aucune n'est choisie). La ligne porte alors le nom de
l'appareil, qui ouvre sa fiche (notice, numéro de série) ; le segment **Par
équipement** range les gestes par appareil. La fiche d'un appareil montre ses
gestes avec leur prochaine date et **Fait aujourd'hui**. Quand un appareil passe
« remplacé », « donné ou vendu » ou « jeté », Foyer propose d'archiver ses
gestes en cours (jamais d'office, une annulation pour tous).

## L'assistant

Cinq outils (voir `docs/assistants.md`), ouverts à tout membre, l'écriture à un
jeton `write`, et retirés quand le module est éteint : `entretien_liste`,
`entretien_fait`, `entretien_creer`, `entretien_stock`, `entretien_pause`. Ils
passent par les mêmes opérations que l'écran, donc les mêmes règles (une
réalisation par jour, date suivante calculée par le serveur, stock). Un geste
noté par l'assistant garde la trace dans son historique (« via un assistant »).

## Ce que coûte l'entretien

Pour les **adultes** seulement : un enfant ne voit aucun montant, ni à l'écran,
ni par l'API (`/api/entretien/couts` lui répond 403). Il peut toujours noter un
geste, et son montant est compté quand même.

**Dans la fiche d'un geste**, « Coût » : un montant **à chaque fois** (la
cartouche à 15,90 €, le ramonage à 70 €), ou, quand Finances est allumé, **le
contrat qui le couvre** (l'entretien annuel de la chaudière). La fiche annonce
aussitôt la prévision (« Environ 207 € par an, 13 fois »).

| Ce qui se voit | Où |
|---|---|
| « ≈ 207 €/an » ou « sous contrat » sur la ligne | Écran Entretien |
| « Environ X € par an prévus, Y € dépensés sur 12 mois », et le lien vers Finances | En tête de l'écran Entretien, dès qu'un geste est chiffré |
| Le coût, le montant à chaque fois, le dépensé sur 12 mois | Fiche du geste (Tâches) |
| « Entretien · environ X € par an » | Fiche d'un équipement |
| Le bilan : prévu sur un an, dépensé sur 12 mois, par geste, par pièce, et les contrats rattachés | Finances → Contrats → **Entretien** |

**Comment c'est compté.**

- **Le réel** : chaque réalisation est notée **au prix du moment**, dans la même
  transaction que la coche (`ent_spend`). Changer le prix ensuite ne réécrit pas
  le passé ; rouvrir un geste retire son montant ; supprimer un geste emporte
  les siens. « Dépensé sur 12 mois » est leur somme sur douze mois glissants,
  gestes archivés compris.
- **La prévision** : le montant × le nombre de passages par an, déduit de la
  récurrence (`occurrencesPerYear` du moteur partagé) : toutes les 4 semaines,
  13 fois ; tous les 2 ans, 0,5 ; la piscine chaque semaine de mai à septembre,
  environ 22 fois.
- **Un contrat** qui couvre des gestes compte **une seule fois**, à son coût
  réel sur douze mois (les opérations rattachées au contrat dans Finances), dans
  le réel comme dans la prévision. Le geste n'a alors pas de montant propre :
  il serait compté deux fois. Sans opération rattachée, le contrat compte 0 €.

**Limites connues.** Un coût saisi pour un geste déjà fait ne chiffre pas ses
réalisations passées : le réel commence au premier geste fait après. Les outils
de l'assistant ne disent pas les montants (ils servent aussi les enfants).

## Réglages

| Clé | Portée | Défaut | Effet |
|---|---|---|---|
| `modEntretien` | foyer | activé | Module activable. Éteint : écran, tuile et section de réglages disparaissent, liste cachée dans Tâches, rappels des gestes tus, catalogue fermé. Les gestes et leur historique sont conservés. |
| `entretienRappel` | personnel | activé | Recevoir les rappels des gestes d'entretien, indépendamment des rappels de ses autres tâches. |
| `entretienHorizonJours` | foyer | 14 (7 à 90) | L'horizon du groupe « Dans les N jours » de l'écran et de la carte d'accueil. |
| `entretienCoursesAuto` | foyer | désactivé | L'article d'un geste part seul aux courses au passage sous le seuil, une fois par passage. Désactivé, un bouton le propose. |

Registre complet : `docs/parametres.md`. La remise à zéro du module
(`POST /api/modules/entretien/reset`, confirmation « SUPPRIMER ») efface les
gestes et leur historique ; la liste et les pièces restent.

## Sauvegarde et retour arrière

Les gestes sont dans le document du foyer ; leurs coûts dans deux tables du
même fichier de base, `ent_costs` (le coût prévu de chaque geste) et `ent_spend`
(le montant de chaque réalisation), schéma versionné par `ent_meta`
(`backend/src/entretien/schema.ts`). Tout part donc dans la sauvegarde
habituelle (`docs/sauvegarde-restauration.md`). Les migrations sont additives et
rejouables ; le serveur dépose une copie du document d'avant migration dans
`backups/`. Le fichier de surcharge du catalogue est dans le dossier des
données, il part avec lui.

Avant la mise à jour qui crée les tables de coûts, un instantané suffit :

```bash
# LXC
sqlite3 /var/lib/foyer/foyer.db "VACUUM INTO '/root/foyer-avant-couts.db'"
# Docker (l'image n'a pas sqlite3 : la copie passe par le module SQLite de l'application)
docker exec foyer node -e "require('better-sqlite3')('/data/foyer.db',{readonly:true}).backup('/data/foyer-avant-couts.db').then(()=>console.log('sauvegarde faite'))"
```

Revenir en arrière : arrêter le service, remettre ce fichier à la place de
`foyer.db`, réinstaller la version précédente. Une version antérieure ignore
simplement les tables `ent_*`.

Revenir à une version antérieure à Entretien demande de restaurer la sauvegarde
d'avant la mise à jour : une ancienne version ne connaît pas la liste de type
`entretien` ni les champs des gestes.
