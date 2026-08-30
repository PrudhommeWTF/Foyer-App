/**
 * Quoi mettre dans un créneau vide, et **pourquoi**.
 *
 * Aucun appel à un service extérieur, aucun score : de la rotation, des dates,
 * et ce qui est déjà sur la liste de courses. Une suggestion qu'on ne sait pas
 * expliquer ne se discute pas, donc ne se corrige pas, donc finit ignorée.
 * Chaque proposition porte donc ses raisons en toutes lettres, et le tri suit
 * exactement l'ordre de ces raisons plutôt qu'un total pondéré.
 *
 * Deux choses ne sont jamais proposées : une recette servie dans les quinze
 * derniers jours (c'est l'anti-répétition), et une recette qui ne convient pas
 * à quelqu'un attendu à ce créneau. La seconde exclusion est **dite** plutôt que
 * silencieuse : écarter sans le dire ferait croire à un carnet plus pauvre
 * qu'il n'est.
 */
import { MealValue, Member, Recipe, ShopItem } from './models';
import { ArticleIndex, parseIngredient } from './ingredients';
import { conflicts, recipeContent } from './diet';
import { presenceAt } from './presence';
import { normaliseName } from './articles';

/** Fenêtre d'anti-répétition, en jours. Deux semaines pleines, plus le jour même. */
export const REPEAT_DAYS = 15;
/** Au-delà, la recette est « oubliée » et mérite d'être remise en avant. */
const OUBLI_DAYS = 21;
/** Ce qu'on appelle une recette rapide, préparation et cuisson comprises. */
const RAPIDE_MIN = 25;

export interface Suggestion {
  recipe: Recipe;
  /** Jours depuis la dernière fois, ou null si jamais servie. */
  since: number | null;
  /** Raisons affichables, dans l'ordre où elles ont pesé. */
  reasons: string[];
  /** Ingrédients déjà présents sur la liste de courses visée. */
  onList: number;
}

export interface SuggestInput {
  recipes: Recipe[];
  /** Tout le planning, pour savoir quand chaque recette a été servie. */
  meals: Record<string, MealValue>;
  members: Member[];
  index: ArticleIndex;
  /** Articles de la liste visée, pour la raison « déjà sur la liste ». */
  shop: ShopItem[];
  /** Créneau à remplir. */
  dateStr: string;
  slot: string;
  limit?: number;
}

export interface SuggestReport {
  suggestions: Suggestion[];
  /** Recettes écartées parce qu'elles ne conviennent pas à un convive attendu. */
  excluded: { name: string; why: string }[];
  /** Recettes écartées par l'anti-répétition, comptées seulement. */
  recent: number;
}

/** Dernier jour où une recette a été servie, au format ISO, ou null. */
export function lastServed(rid: string, meals: Record<string, MealValue>): string | null {
  let dernier: string | null = null;
  for (const [key, value] of Object.entries(meals || {})) {
    if (!value?.items?.some((i) => i.rid === rid)) continue;
    const jour = key.slice(0, 10);
    if (!dernier || jour > dernier) dernier = jour;
  }
  return dernier;
}

/** Écart en jours entre deux dates ISO. Positif quand `to` est après `from`. */
export function daysBetween(from: string, to: string): number {
  const j = (s: string): number => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); };
  return Math.round((j(to) - j(from)) / 86400000);
}

export function suggestMeals(input: SuggestInput): SuggestReport {
  const { recipes, meals, members, index, shop, dateStr, slot } = input;
  const presents = presenceAt(members, dateStr, slot, meals[dateStr + '-' + slot]).present;

  // Les noms de la liste sont normalisés une fois : la comparaison a lieu une
  // fois par ingrédient et par recette, ce qui monte vite sur un gros carnet.
  const surListe = new Set(shop.filter((i) => i.state !== 'panier').map((i) => normaliseName(i.name)));

  const excluded: SuggestReport['excluded'] = [];
  let recent = 0;
  const out: Suggestion[] = [];

  for (const r of recipes || []) {
    const dernier = lastServed(r.id, meals);
    const since = dernier ? daysBetween(dernier, dateStr) : null;
    // Servie dans la fenêtre, ou déjà planifiée plus tard : dans les deux cas on
    // ne la propose pas, et un écart négatif veut dire « prévue après ».
    if (since !== null && since < REPEAT_DAYS) { recent++; continue; }

    const gene = conflicts(recipeContent(r, index), presents, index);
    if (gene.length) {
      excluded.push({ name: r.name, why: gene.map((c) => c.name).join(', ') });
      continue;
    }

    const onList = compteSurListe(r, index, surListe);
    const total = (r.prepMin || 0) + (r.cookMin || 0);
    const reasons: string[] = [];
    if (since === null) reasons.push('jamais encore faite');
    else if (since >= OUBLI_DAYS) reasons.push('pas faite depuis ' + semaines(since));
    if (onList) reasons.push(onList + (onList > 1 ? ' ingrédients déjà sur la liste' : ' ingrédient déjà sur la liste'));
    if (total && total <= RAPIDE_MIN) reasons.push('prête en ' + total + ' min');
    if ((r.rating || 0) >= 4) reasons.push('bien notée');
    out.push({ recipe: r, since, reasons, onList });
  }

  // Tri par les raisons, dans leur ordre d'importance, et non par un total
  // pondéré : c'est ce qui rend le classement lisible et discutable.
  out.sort((a, b) =>
    (b.since === null ? 1e9 : b.since) - (a.since === null ? 1e9 : a.since)
    || b.onList - a.onList
    || duree(a.recipe) - duree(b.recipe)
    // La note vient en dernier, et à dessein : une bonne note qui l'emporterait
    // sur « pas faite depuis trois semaines » ferait manger toujours la même chose.
    || (b.recipe.rating || 0) - (a.recipe.rating || 0)
    || a.recipe.name.localeCompare(b.recipe.name));

  return { suggestions: out.slice(0, input.limit ?? 6), excluded, recent };
}

const duree = (r: Recipe): number => (r.prepMin || 0) + (r.cookMin || 0) || 1e6;

function compteSurListe(r: Recipe, index: ArticleIndex, surListe: Set<string>): number {
  const vus = new Set<string>();
  for (const ligne of r.ingr || []) {
    for (const p of parseIngredient(ligne, index)) {
      const nom = index.byKey.get(p.art || '')?.name ?? p.name;
      const n = normaliseName(nom);
      if (n && surListe.has(n)) vus.add(n);
    }
  }
  return vus.size;
}

/** « trois semaines », « un mois », plutôt qu'un nombre de jours qu'il faut diviser. */
export function semaines(jours: number): string {
  if (jours >= 60) return Math.floor(jours / 30) + ' mois';
  if (jours >= 30) return 'un mois';
  // Sous trente jours, le compte de semaines ne peut valoir que 1 à 4.
  const s = Math.max(Math.floor(jours / 7), 1);
  return ['', 'une semaine', 'deux semaines', 'trois semaines', 'quatre semaines'][s];
}
