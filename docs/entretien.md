# Entretien de la maison

Les gestes d'entretien qui reviennent et que personne ne note : la cartouche de
la carafe toutes les 4 semaines, le test des détecteurs de fumée tous les 6 mois,
la chaudière chaque année. Chaque geste dit quoi, à quelle fréquence, où, quand
il a été fait et par qui, quand il revient, et ce qu'il reste en stock.

Cadrage et choix : `docs/entretien-etat-des-lieux.md`.

> État : le socle (PR 1) et l'écran Entretien (PR 2) sont livrés. Suivent
> (PR 3) : « J'en ai racheté » et l'ajout aux courses, la tuile d'accueil, les
> outils d'assistant.

## L'écran

Menu « Le foyer » → **Entretien**. Par défaut, les gestes par date :

| Groupe | Ce qui y est |
|---|---|
| En retard | Échéance (plus sa souplesse) dépassée. |
| Dans les N jours | À faire d'ici l'horizon du réglage `entretienHorizonJours` (14 par défaut). |
| Plus tard | Au-delà, et les gestes en pause. |
| Pas encore noté | Jamais faits : pas de date, jamais en retard. |
| Archivés | Repliés en bas, avec « Réactiver ». |

Le segment **Par pièce** range les mêmes gestes par pièce (« Sans pièce » en
dernier). Chaque ligne dit le geste, son détail, la pièce, la fréquence en
clair (« toutes les 4 semaines »), « Fait le … par … » ou « Pas encore noté »,
la prochaine date ou la pause, le stock, et porte **Fait aujourd'hui** : un
tap, annulable quelques secondes (le bouton devient « ✓ Fait aujourd'hui »).
Le menu « … » propose **Fait un autre jour** (date, et qui : un membre ou « le
foyer »), **Modifier**, **Mettre en pause** jusqu'à une date (ou **Reprendre
maintenant**), **Archiver**, et la fiche avec l'historique complet.

**Nouveau geste** ouvre le catalogue (recherche, rangé par famille) ou une
fiche libre. Depuis le catalogue, tout est prérempli, pièce comprise (créée si
elle n'existe pas) : choisir, puis « Créer le geste ». On y règle la
fréquence (semaines, mois, années, ou date fixe avec souplesse), la pièce, le
détail, le stock, qui s'en charge, le rappel, et « Dernière fois » quand on la
connaît (le geste part alors de cette date au lieu de rester « Pas encore
noté »). La quantité d'un stock existant ne se modifie pas dans la fiche.

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
module Équipements y range aussi ses appareils, et c'est depuis son écran
(menu ⋯, « Gérer les pièces ») qu'on les renomme, réordonne ou supprime.
Une pièce supprimée fait passer ses gestes « Sans pièce », elle ne les
supprime pas. Un téléphone resté
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
`piece` (suggérée), `rec` (`freq`, `every`, `base`, `grace`), et `article`
éventuel (`nom`, `unite`, `use`, `seuil`). `pieces` : les pièces proposées au
premier usage.

### L'adapter à votre foyer

Créez un fichier **du même nom dans le dossier des données**, avec seulement ce
qui change. Il est fusionné avec le catalogue livré par identifiant : une
entrée de même `id` remplace, une nouvelle s'ajoute, `"retire": true` masque,
et `pieces`, s'il est présent, remplace la liste des pièces. Il est relu dès
qu'il change, sans redémarrer, et une mise à jour de Foyer ne l'écrase pas.

```json
{
  "pieces": ["Cuisine", "Salle de bain", "Buanderie", "Atelier", "Jardin"],
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

## Réglages

| Clé | Portée | Défaut | Effet |
|---|---|---|---|
| `modEntretien` | foyer | activé | Module activable. Éteint : écran, tuile et section de réglages disparaissent, liste cachée dans Tâches, rappels des gestes tus, catalogue fermé. Les gestes et leur historique sont conservés. |
| `entretienRappel` | personnel | activé | Recevoir les rappels des gestes d'entretien, indépendamment des rappels de ses autres tâches. |
| `entretienHorizonJours` | foyer | 14 (7 à 90) | L'horizon du groupe « Dans les N jours » de l'écran. |

Registre complet : `docs/parametres.md`. La remise à zéro du module
(`POST /api/modules/entretien/reset`, confirmation « SUPPRIMER ») efface les
gestes et leur historique ; la liste et les pièces restent.

## Sauvegarde et retour arrière

Aucune table nouvelle : tout est dans le document du foyer, donc dans la
sauvegarde habituelle (`docs/sauvegarde-restauration.md`). La migration 14 est
additive et rejouable ; le serveur dépose une copie du document d'avant
migration dans `backups/`. Le fichier de surcharge du catalogue est dans le
dossier des données, il part avec lui.

Revenir à une version antérieure à Entretien demande de restaurer la sauvegarde
d'avant la mise à jour : une ancienne version ne connaît pas la liste de type
`entretien` ni les champs des gestes.
