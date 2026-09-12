# Lieux : inventaires de vacances

Un **lieu** est un endroit où le foyer laisse des affaires d'une fois sur
l'autre : la maison de la montagne avec ses skis, le mobil-home du bord de mer
avec le parasol et les bouées. Son **inventaire** dit ce qui reste là-bas, et ne
se remet **jamais** à zéro, contrairement à un trousseau de départ (voir
[`taches.md`](taches.md), « Listes de préparation »).

Deux gestes suffisent à le tenir à jour, et tout le foyer les voit :

- **« J'ai laissé »** : l'affaire reste sur place (état `la-bas`).
- **« J'ai ramené »** : l'affaire repart à la maison (état `ici`).

## Le principe : les mêmes opérations que les courses

Comme la liste de courses et les tâches, les lieux et leurs affaires vivent dans
le document JSON du foyer, mais ne s'écrivent **pas** par un PUT du document
complet : chaque geste est une **opération ciblée et journalisée**. Deux
téléphones qui notent en même temps (l'un au chalet, l'autre à la maison) se
sérialisent au lieu de s'écraser. Les deux propriétés qui rendent le procédé sûr
sont celles des courses :

1. **une intention, pas une bascule** (« cette affaire est là-bas », jamais
   « inverse son état ») : une opération rejouée après une coupure réseau ne
   fait rien de travers ;
2. **un identifiant par opération**, retenu par le serveur (`hh_place_ops`), pour
   qu'un rejeu ne ressuscite pas une affaire supprimée entre-temps.

La différence avec les courses : ici un **seul flux** d'opérations porte à la
fois les lieux et leurs affaires, pour garder toute la fonctionnalité hors du
chemin du PUT.

## Le modèle

```ts
type PlaceItemState = 'la-bas' | 'ici';   // sur place / ramenée à la maison

interface Place {
  id; name; color; icon;
  position: number;
  note?: string | null;   // adresse, code de la boîte à clés…
  by?; at?;               // qui a créé le lieu, et quand
}

interface PlaceItem {
  id; placeId; name; qty;
  state: PlaceItemState;  // par défaut 'la-bas' : on note ce qui reste
  by?; at?;               // qui a posé l'état courant, et quand
}
```

`places` et `placeItems` sont deux collections du document, plafonnées comme les
autres (`validate.ts` : 500 lieux, 20 000 affaires). Une base d'avant la
fonctionnalité les ignore : les clés manquantes valent liste vide, aucune
migration du document n'est nécessaire.

## Les opérations

`POST /api/places/ops`, un lot d'opérations, via la fabrique `opsRouter` commune
aux courses et aux tâches.

| Opération | Champs | Effet |
|---|---|---|
| `place-add` | `id`, `name`, au choix `color`, `icon`, `note` | Crée le lieu, `position` à la suite. Déjà là : acquittée. |
| `place-edit` | `id` et les champs à changer | Ne touche qu'aux champs nommés. Une note vidée disparaît. |
| `place-remove` | `id` | Supprime le lieu **et ses affaires**, dans la même transaction. |
| `add` | `id`, `placeId`, `name`, au choix `qty`, `state` | Ajoute une affaire, `la-bas` par défaut. Lieu inconnu : refusée. |
| `set-state` | `id`, `state` | Les deux gestes. Affaire disparue : acquittée (sans objet). |
| `edit` | `id` et les champs à changer (`name`, `qty`, `placeId`) | Renomme, change la quantité, ou déplace vers un autre lieu. |
| `remove` | `id` | Supprime l'affaire. |

Chaque opération porte `opId` (généré par le client), `by`, `at`. Une opération
sur une affaire ou un lieu disparu est **acquittée** (sans objet), pas refusée.
Ce qui est **refusé**, avec la raison renvoyée et journalisée : un nom vide, un
lieu inconnu à l'ajout d'une affaire, un état d'affaire inconnu, une opération
inconnue.

Un lot entier tient dans une transaction SQLite : soit tout est écrit, soit rien
ne l'est. Rien de retenu ne fait pas tourner le numéro de version, pour ne pas
faire recharger les autres téléphones pour rien.

## La lecture, et la protection du PUT

Les lieux et les affaires voyagent dans le même `GET /api/live?since=<version>`
que les courses et les tâches, sous les clés `places` et `placeItems`. L'écran
Lieux le sonde toutes les cinq secondes tant qu'il est ouvert, comme Courses et
Tâches.

Un `PUT /api/state` qui porterait `places` ou `placeItems` est **ignoré** :
`preservePlaces` réinjecte les deux collections du serveur dans le document
entrant, quel que soit son âge. Un client périmé ne peut donc pas transporter
l'inventaire, et aucun geste ne s'annule tout seul. Rien à réconcilier ici,
contrairement aux courses : lieux et affaires ne citent aucune autre collection,
et la suppression d'un lieu emporte déjà ses affaires côté opérations.

## Hors ligne

Comme les courses : dans une application déjà ouverte, créer un lieu, ajouter une
affaire et poser un geste sans réseau fonctionne. La file est persistée dans le
navigateur (`localStorage`, clé `foyer.placeQueue`), survit à un onglet recyclé,
repart au retour du réseau, et la réponse du serveur fait autorité. Une opération
refusée est retirée de la file et signalée, sans tourner en boucle.

## L'écran

L'entrée « Lieux de vacances » (icône `map-pin`) est dans le groupe « Le foyer »
du menu. L'écran liste les lieux ; chaque affaire montre son état (pastille et
style), et un **geste contextuel** propose l'action inverse : « J'ai ramené »
quand elle est là-bas, « J'ai laissé » quand elle est à la maison. L'en-tête de
chaque lieu résume « X sur place · Y à la maison », les affaires ramenées
ressortant en couleur pour penser à les rapporter. Un champ d'ajout en ligne, et
deux modales (le lieu, l'affaire), complètent l'écran.

## Croisement avec les listes de préparation

Une liste de préparation peut pointer un lieu (`TaskList.placeId`). L'écran de
préparation montre alors, sous l'en-tête de départ, l'inventaire de ce lieu :

- **Déjà sur place** (affaires `la-bas`) : à ne pas emporter.
- **À remporter** (affaires `ici`, ramenées à la maison) : ajoutables à la
  préparation en un geste, dédupliquées de ce que la liste contient déjà.

Le lien est un simple champ du document, écrit par le chemin habituel des listes
(PUT `/state`) ; l'inventaire, lui, reste écrit par opérations. Un lieu supprimé
fait disparaître le panneau, la préparation reste. Voir
[`taches.md`](taches.md), « Listes de préparation ».

## Où vit le code

```
backend/src/places/
  ops.ts     # moteur pur (applyOps sur places + items), testé (places-ops.test.ts)
  repo.ts    # transaction, journal hh_place_ops, preservePlaces (places-repo.test.ts)
  routes.ts  # /api/places/ops via opsRouter
backend/src/storage/schema.ts   # migration 5 : table hh_place_ops
backend/src/server.ts           # montage, /api/live, appel à preservePlaces dans PUT /state

frontend/src/app/core/
  models.ts        # Place, PlaceItem, PlaceItemState
  api.service.ts   # placesOps, PlacesApplied, LiveSnapshot étendu
  foyer.store.ts   # file foyer.placeQueue, application locale, envoi, adoption, méthodes publiques
frontend/src/app/screens/lieux.ts   # l'écran
```

Attention au voisinage de noms : `backend/src/places.ts` (au singulier, un
fichier) est l'autocomplétion d'adresse via la Base Adresse Nationale pour le
champ « lieu » d'un événement d'agenda, sans rapport avec ce dossier
`backend/src/places/` (les inventaires de vacances).
