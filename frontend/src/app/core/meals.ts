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
