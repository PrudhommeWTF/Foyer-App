// Comment un créneau de repas s'intitule.
//
// Un créneau porte plusieurs plats, chacun étant soit une recette du carnet,
// soit un texte libre. Recomposer cet intitulé ailleurs (dans une tuile, dans
// un événement d'agenda) revient à recopier la règle : ces fonctions existent
// pour qu'il n'y en ait qu'une, et qu'une recette supprimée se dise partout de
// la même façon.
import { MealItem, MealValue, Recipe } from './models';

/** Intitulé d'un plat : le nom de la recette, ou le texte saisi. */
export function mealItemName(it: MealItem, recipes: Recipe[]): string {
  if (it.rid) return recipes.find((x) => x.id === it.rid)?.name ?? 'Recette supprimée';
  return it.text || '';
}

/** Intitulés d'un créneau, dans l'ordre du service. Vide quand rien n'est prévu. */
export function mealNames(v: MealValue | undefined | null, recipes: Recipe[]): string[] {
  return (v?.items || []).map((it) => mealItemName(it, recipes)).filter(Boolean);
}

/** Durée totale d'une recette, pour les vignettes et l'accueil. */
export function recipeTime(r: { prepMin?: number | null; cookMin?: number | null }): string {
  const total = (r.prepMin || 0) + (r.cookMin || 0);
  if (!total) return '—';
  return total < 60 ? total + ' min' : Math.floor(total / 60) + ' h' + (total % 60 ? ' ' + (total % 60) : '');
}

/** « 2026-10-20-soir » : le jour et le moment d'un créneau de repas. */
export function splitMealKey(key: string): { dateStr: string; slot: string } {
  return { dateStr: key.slice(0, 10), slot: key.slice(11) };
}

// Forme comparable d'un repas : sans couverts ni absents posés, rien ; l'ordre
// des absents ne compte pas, celui des plats si (c'est l'ordre du service).
const mealShape = (v: MealValue | null | undefined): string => JSON.stringify(v?.items?.length
  ? [v.items.map((i) => (i.rid ? { rid: i.rid } : { text: i.text || '' })), v.pax || null, [...(v.away || [])].sort()]
  : null);
/** Deux repas identiques ? Enregistrer sans rien changer ne doit rien écrire. */
export function sameMeal(a: MealValue | null | undefined, b: MealValue | null | undefined): boolean { return mealShape(a) === mealShape(b); }

/** Un créneau de repas tel que la fiche le montre : sa clé, son jour, son moment, ce qui y est prévu. */
export interface MealSlotRef { key: string; dateStr: string; slot: string; value: MealValue; }
