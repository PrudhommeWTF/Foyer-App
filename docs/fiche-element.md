# Fiche d'élément

Un tap sur un élément, d'où qu'il vienne (accueil, agenda, recherche, notification), ouvre sa **fiche** par-dessus l'écran courant, **sans changer d'écran**. On lit, on modifie dans la même fiche, on ferme : on est toujours là où l'on était, au même endroit du défilement, sur le même mois de l'agenda.

Types passés par la fiche à ce jour : **événement**, **tâche** (y compris préparation et devoirs, voir [`taches.md`](taches.md#fiche-dune-tâche)), **repas** (un créneau d'un jour), **recette**, **créneau d'emploi du temps** (voir [`emploi-du-temps.md`](emploi-du-temps.md#fiche-dun-créneau)), **article de courses**, **liste de courses**, **rayon**, **lieu**, **affaire** (voir [`lieux.md`](lieux.md#lécran)), **contact**, **carte de fidélité** (voir [`cartes-fidelite.md`](cartes-fidelite.md#la-fiche-dune-carte)) et **liste de tâches** (voir [`taches.md`](taches.md#fiche-dune-liste)). Les autres modules suivent (employé, devoir, note).

Sur une carte de contact, « Appeler » reste un lien direct ; le haut de la carte ouvre la fiche, où le téléphone et l'email sont aussi des liens.

Sur la liste de courses, la **case** d'un article se coche toujours d'un tap direct (en magasin, une fiche par article serait un geste de trop) ; c'est le **nom** qui ouvre la fiche. Le nom de la liste ouverte mène à la fiche de la liste (et de là à la tâche qui l'ouvre, par-dessus) ; le crayon d'un rayon, dans « Ordre des rayons », à la fiche du rayon, par-dessus cette fenêtre. Un article créé dans la fiche suit le rayon que son nom évoque, comme à la saisie rapide, tant qu'on n'en choisit pas un à la main.

Un lieu mène à ses affaires de la même façon : un tap dans son inventaire ouvre l'affaire par-dessus, le retour ramène au lieu.

Un repas mène à ses recettes : un tap sur l'une d'elles ouvre sa fiche **par-dessus** (pile de deux niveaux), et le retour ramène au repas. Un créneau vide s'ouvre directement en saisie, le jour et le moment passés dans `ctx.date` et `ctx.slot`.

## Ce que voit l'utilisateur

| Moment | Ce qui se passe |
|---|---|
| Tap sur un élément | Fiche en **vue** : titre, quand, où, qui, détails, « Créé par … il y a … ». Boutons **Supprimer** et **Modifier** en bas, lien « Ouvrir dans … » (absent quand on est déjà dans ce module). |
| Modifier | Les champs deviennent éditables **dans la même fiche** ; boutons **Annuler** (retour à la vue, rien d'enregistré) et **Sauvegarder**. Sur téléphone, la fiche passe en plein écran. |
| Sauvegarder | Retour à la vue, l'élément à jour. Sauvegarder sans rien changer n'écrit rien. |
| Création (menu +, tap sur un jour libre) | La fiche s'ouvre directement en édition, bouton **Créer** ; elle se referme une fois créé. |
| Supprimer | Pas de confirmation : l'élément disparaît, le toast propose **Annuler** quelques secondes (un repas se « Retire », avec son événement d'agenda, et revient avec lui). Les types à perte lourde se confirment dans la fiche, sans annulation : la recette, la liste de courses (elle emporte ses articles) et le rayon (ses articles passent au rayon de repli ; l'annuler demanderait d'écrire à la fois le document et la file d'opérations des courses, sans garantie d'ordre), puis le lieu avec son inventaire. Le rayon de repli n'a pas de bouton Supprimer. Sur téléphone, le toast passe en haut de l'écran tant qu'une fiche est ouverte, pour ne pas masquer ses boutons. |
| Série (événement récurrent, créneau hebdomadaire) | Enregistrer ou supprimer depuis une occurrence demande la portée au moment d'agir : « Cette occurrence » ou « Toute la série » pour un événement ; « Ce jour seulement », « À partir du … » ou « À toute la série » pour un créneau. |
| Notification | Un tap sur un rappel de tâche ouvre sa fiche : sur l'écran en cours si l'application était ouverte, sur l'accueil sinon. |
| Retour | Bouton retour Android, glissé de Safari, **Échap** sur Mac, ou poignée glissée vers le bas (seul geste retour d'une PWA installée sur iPhone) : de l'édition à la vue, de la vue à l'écran. Si quelque chose a été saisi, « Abandonner les modifications ? » d'abord. |
| Modifié ailleurs | La vue suit l'élément. En édition, un bandeau dit « Modifié par Nolwenn à l'instant », et Sauvegarder demande avant d'écraser. |
| Supprimé ailleurs | « Cet élément n'existe plus », avec un bouton Fermer. |

## Comment c'est construit

- **Un seul état** : `ui.item = { kind, id, mode: 'vue' | 'edition', ctx? } | null` dans `core/ui-state.ts`. Il n'est jamais retenu d'un chargement à l'autre. Les tampons d'édition vivent dans le composant de formulaire, pas dans `UiState`.
- **Machine d'état pure** : `core/item-sheet.ts` (`sheetOpen`, `sheetEdit`, `sheetBack`, `sheetSaved`, `sheetDepth`), testée seule. Le store n'en est que le relais : `openItem(kind, id, ctx?, stack?)`, `closeItem()`, `editItem()`, `backItem()`, `itemSaved(id?)`.
- **Pile** : ouvrir un élément depuis une fiche (la recette d'un repas) avec `stack` garde la fiche précédente dans `ctx.prev`, deux niveaux au plus ; le retour y ramène.
- **Historique** : chaque niveau (et l'édition) occupe une entrée `history.pushState`. Un retour système recule d'un cran dans la fiche ; fermer par un bouton consomme ces entrées. Voir `shell/item-sheet.ts`.
- **Cadre** : `f-sheet` (`shared/sheet.ts`), distinct de `f-modal` pour ne pas toucher aux modales existantes.
- **Fiche générique** : `app-item-sheet` (`shell/item-sheet.ts`), rendue par le shell au-dessus de tout écran. Elle ne connaît aucun module.
- **Fraîcheur** : tant qu'une fiche est ouverte, l'application sonde le serveur toutes les 5 s et relit le document quand sa version a changé (même chemin qu'un conflit d'enregistrement : ce qui n'est pas encore parti est rejoué par-dessus). Elle relit aussi juste avant d'enregistrer. Sur l'accueil, même relecture à la cadence de l'accueil (15 s).

## Déclarer un type

1. Ajouter l'identifiant à `ItemKindId` et sa partie pure à `ITEM_KINDS` (`core/items.ts`) : libellés, écran du module, `editable` (sinon `readOnlyReason`), mode de suppression (`undo`, `confirm` ou `null`), module et réservé aux adultes le cas échéant.
2. Écrire, dans le dossier du module, un composant de **vue** (entrées `item`, `ctx`, lecture seule) et, si le type est modifiable, un composant de **formulaire** qui implémente `ItemForm` (`dirty` et `submit(scope?)`, qui appelle les méthodes existantes du store et rend `done`, `invalid` ou une question).
3. Déclarer le descripteur (`ItemKind`) : `load`, `title`, `view`, `form`, `remove`, `actions`, `openIn`, `fingerprint`, `changedBy`, et au besoin `canEdit` / `canRemove` (un élément du type qui ne se modifie pas, comme un devoir parmi les tâches) et `openTarget` (« Voir dans École »). Exemples : `screens/calendar/event.item.ts`, `screens/taches/task.item.ts`.
4. L'inscrire dans `shell/item-registry.ts` (le typage refuse un type sans descripteur).
5. Remplacer **tous** les points d'entrée du type par `store.openItem(...)` et supprimer l'ancienne modale dans la même PR : jamais deux comportements pour un même type.

Les tests `core/item-sheet.test.ts` vérifient que chaque type mène à un écran qui existe, dépend du même module que cet écran, et qu'un type sans formulaire dit pourquoi et n'est pas supprimable.
