// La fiche d'élément : un seul composant, hébergé par le shell, pour voir puis
// modifier n'importe quel élément du foyer sans quitter l'écran courant.
//
// Chaque type d'élément se déclare une fois. Ce fichier en porte la partie
// pure (identité, libellés, écran du module, mode de suppression), testable
// sans Angular ; le descripteur complet (lecture dans le store, composants de
// vue et de formulaire, actions) vit avec son module et s'inscrit dans
// `shell/item-registry.ts`. La fiche compose ces descripteurs et ne connaît
// aucun module.
import type { Signal, Type } from '@angular/core';
import type { ModuleFlag } from './modules';

/** Les types d'élément qui passent par la fiche. Un module s'y ajoute en déclarant le sien. */
export type ItemKindId = 'event' | 'task' | 'meal' | 'recipe' | 'slot' | 'shop' | 'shopList' | 'aisle' | 'place' | 'placeItem' | 'contact' | 'card';

export type SheetMode = 'vue' | 'edition';

/**
 * Ce que la fiche montre. `id` vide = création (la fiche s'ouvre alors
 * directement en édition). `ctx.occ` désigne l'occurrence touchée d'une série ;
 * `ctx.date` (et `ctx.slot` pour un repas, `ctx.time` pour un créneau) ce
 * qu'une création reçoit d'office, `ctx.copy` l'élément qu'elle recopie ;
 * `ctx.prev` la fiche qu'on
 * retrouve au retour (deux niveaux au plus).
 */
export interface ItemRef { kind: ItemKindId; id: string | null; mode: SheetMode; ctx?: ItemCtx; }
export interface ItemCtx { occ?: string; date?: string; slot?: string; time?: string; copy?: string; prev?: ItemRef; }

/** La partie pure d'un type : ce que les tests vérifient et ce que le shell lit sans charger l'élément. */
export interface ItemKindMeta {
  kind: ItemKindId;
  /** « Événement » : annoncé en tête de fiche. */
  label: string;
  /** Titres de la fiche en édition. */
  newTitle: string; editTitle: string;
  /** L'écran où « Ouvrir dans … » emmène, et le libellé du lien. */
  screen: string; openLabel: string;
  /** Le type a-t-il un formulaire ? Sans formulaire, `readOnlyReason` dit pourquoi. */
  editable: boolean; readOnlyReason?: string;
  /** Suppression : annulation de quelques secondes, confirmation (perte lourde), ou aucune. */
  removeMode: 'undo' | 'confirm' | null;
  /** Le mot du bouton quand « Supprimer » ne convient pas (un repas se retire du planning). */
  removeLabel?: string;
  /** Le module dont dépend le type : éteint, ses fiches ne s'ouvrent pas. */
  module?: ModuleFlag;
  /** Réservé aux adultes. */
  adultOnly?: boolean;
}

export const ITEM_KINDS: Readonly<Record<ItemKindId, ItemKindMeta>> = {
  event: {
    kind: 'event', label: 'Événement', newTitle: 'Nouvel événement', editTitle: 'Modifier l’événement',
    screen: 'calendar', openLabel: 'Ouvrir dans Agenda', editable: true, removeMode: 'undo',
  },
  task: {
    kind: 'task', label: 'Tâche', newTitle: 'Nouvelle tâche', editTitle: 'Modifier la tâche',
    screen: 'taches', openLabel: 'Ouvrir dans Tâches', editable: true, removeMode: 'undo',
  },
  meal: {
    kind: 'meal', label: 'Repas', newTitle: 'Prévoir le repas', editTitle: 'Modifier le repas',
    screen: 'repas', openLabel: 'Ouvrir dans Planning des repas', editable: true, removeMode: 'undo', removeLabel: 'Retirer', module: 'modRepas',
  },
  recipe: {
    kind: 'recipe', label: 'Recette', newTitle: 'Nouvelle recette', editTitle: 'Modifier la recette',
    screen: 'recettes', openLabel: 'Ouvrir dans Carnet de recettes', editable: true, removeMode: 'confirm', module: 'modRepas',
  },
  slot: {
    kind: 'slot', label: 'Créneau', newTitle: 'Nouveau créneau', editTitle: 'Modifier le créneau',
    screen: 'planning', openLabel: 'Ouvrir dans Emploi du temps', editable: true, removeMode: 'undo',
  },
  shop: {
    kind: 'shop', label: 'Article de courses', newTitle: 'Nouvel article', editTitle: 'Modifier l’article',
    screen: 'courses', openLabel: 'Ouvrir dans Courses', editable: true, removeMode: 'undo',
  },
  // Une liste emporte ses articles, un rayon renvoie les siens au repli : on confirme.
  shopList: {
    kind: 'shopList', label: 'Liste de courses', newTitle: 'Nouvelle liste', editTitle: 'Modifier la liste',
    screen: 'courses', openLabel: 'Ouvrir dans Courses', editable: true, removeMode: 'confirm',
  },
  aisle: {
    kind: 'aisle', label: 'Rayon', newTitle: 'Nouveau rayon', editTitle: 'Modifier le rayon',
    screen: 'courses', openLabel: 'Ouvrir dans Courses', editable: true, removeMode: 'confirm',
  },
  // Un lieu emporte son inventaire : on confirme. Une affaire se remet d'un Annuler.
  place: {
    kind: 'place', label: 'Lieu', newTitle: 'Nouveau lieu', editTitle: 'Modifier le lieu',
    screen: 'lieux', openLabel: 'Ouvrir dans Lieux de vacances', editable: true, removeMode: 'confirm',
  },
  placeItem: {
    kind: 'placeItem', label: 'Affaire', newTitle: 'Nouvelle affaire', editTitle: 'Modifier l’affaire',
    screen: 'lieux', openLabel: 'Ouvrir dans Lieux de vacances', editable: true, removeMode: 'undo',
  },
  contact: {
    kind: 'contact', label: 'Contact', newTitle: 'Nouveau contact', editTitle: 'Modifier le contact',
    screen: 'contacts', openLabel: 'Ouvrir dans Contacts', editable: true, removeMode: 'undo',
  },
  card: {
    kind: 'card', label: 'Carte de fidélité', newTitle: 'Nouvelle carte', editTitle: 'Modifier la carte',
    screen: 'fidelite', openLabel: 'Ouvrir dans Cartes de fidélité', editable: true, removeMode: 'undo', module: 'modFidelite',
  },
};

/**
 * Ce que rend un enregistrement ou une suppression : fait, refusé (le
 * formulaire a dit pourquoi), ou une question à poser avant d'agir (« cette
 * occurrence ou toute la série »). La fiche pose la question elle-même, puis
 * rappelle avec le choix retenu.
 */
export type ItemResult =
  /** `id` : l'élément enregistré n'est plus celui qu'on éditait (une occurrence détachée de sa série). */
  | { kind: 'done'; id?: string }
  | { kind: 'invalid' }
  | { kind: 'ask'; question: string; choices: ItemChoice[] };
export interface ItemChoice { scope: string; label: string; danger?: boolean; }

/** Le contrat d'un composant de formulaire branché dans la fiche. */
export interface ItemForm {
  /** Quelque chose a-t-il changé depuis l'ouverture ? Décide de « Abandonner les modifications ? ». */
  readonly dirty: Signal<boolean>;
  /** Enregistre, ou dit ce qu'il faut demander d'abord. */
  submit(scope?: string): ItemResult;
}

/** Une action propre au type, montrée en vue (« Fait », « Déplacer »…). */
export interface ItemAction { label: string; icon: string; run(): void; }

/**
 * Le descripteur complet d'un type, déclaré par son module. `S` est le store
 * (passé par la fiche) : le typer ici créerait une dépendance de `core` vers
 * le store qui importe déjà ce fichier.
 */
export interface ItemKind<T, S> {
  meta: ItemKindMeta;
  /** Lit l'élément dans le store. Lu dans un contexte réactif : la fiche suit les changements, y compris venus d'un autre téléphone. */
  load(s: S, id: string, ctx?: ItemCtx): T | null;
  title(it: T): string;
  /** Composant de vue : entrées `item` et `ctx`. */
  view: Type<unknown>;
  /** Composant de formulaire : entrées `item` (null à la création) et `ctx`. */
  form?: Type<ItemForm>;
  /** Supprime, ou pose d'abord une question. Absent : pas de bouton Supprimer. */
  remove?(s: S, it: T, ctx: ItemCtx | undefined, scope?: string): ItemResult;
  /**
   * Cet élément-ci se modifie-t-il, se supprime-t-il ? Pour un type modifiable
   * dont certains éléments ne le sont pas (un devoir venu d'ÉcoleDirecte parmi
   * les tâches). Absent : oui. Jamais de bouton sans effet.
   */
  canEdit?(it: T, s: S): boolean;
  canRemove?(it: T, s: S): boolean;
  /** Actions propres, en vue. */
  actions?(s: S, it: T, ctx?: ItemCtx): ItemAction[];
  /** Emmène dans le module, sur le bon contexte (le mois de l'événement). */
  openIn(s: S, it: T, ctx?: ItemCtx): void;
  /** Un autre module que celui du type pour cet élément-ci (un devoir : « Voir dans École »). Absent : `meta`. */
  openTarget?(it: T, s: S): { label: string; screen: string } | null;
  /** Empreinte de l'élément : sert à voir qu'un autre appareil l'a modifié pendant l'édition. */
  fingerprint(it: T): string;
  /** Qui l'a modifié en dernier, pour le dire. */
  changedBy?(it: T): { by: string | null; at: string | null };
}
