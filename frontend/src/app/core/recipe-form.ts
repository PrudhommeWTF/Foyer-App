// Le formulaire d'une recette, sans Angular : ce qu'il montre à l'ouverture,
// ce qu'il enregistre, et s'il a changé quelque chose.
import { Recipe } from './models';

/** Une ligne d'ingrédient ou d'étape. L'identifiant sert au suivi des lignes à l'écran. */
export interface IngrRow { id: string; val: string; }

/** Les champs tels que saisis. Durées et portions restent du texte : ce sont des champs numériques vides possibles. */
export interface RecipeFields {
  name: string; level: string; color: string; photoId: number | null;
  portions: string; prepMin: string; cookMin: string; source: string;
  tags: string[]; rating: number; ingr: IngrRow[]; steps: IngrRow[];
}

/** Ce qu'une recette enregistre, hors identifiant. */
export type RecipeData = Pick<Recipe, 'name' | 'level' | 'color' | 'photoId' | 'portions' | 'prepMin' | 'cookMin' | 'source' | 'tags' | 'rating' | 'ingr' | 'steps'>;

const num = (n?: number | null): string => (n ? String(n) : '');

/** Le formulaire pré-rempli, ou vierge (une ligne d'ingrédient et une d'étape à remplir). */
export function recipeFields(r: Recipe | null, rowId: (prefix: string) => string): RecipeFields {
  if (!r) {
    return { name: '', level: 'Facile', color: '#7A9B76', photoId: null, portions: '', prepMin: '', cookMin: '', source: '',
      tags: [], rating: 0, ingr: [{ id: rowId('i'), val: '' }], steps: [{ id: rowId('p'), val: '' }] };
  }
  return {
    name: r.name, level: r.level, color: r.color, photoId: r.photoId ?? null,
    portions: num(r.portions), prepMin: num(r.prepMin), cookMin: num(r.cookMin), source: r.source || '',
    tags: [...(r.tags || [])], rating: r.rating || 0,
    ingr: r.ingr.map((val) => ({ id: rowId('i'), val })), steps: r.steps.map((val) => ({ id: rowId('p'), val })),
  };
}

/** Les champs mis au propre : lignes vides retirées, nombres positifs ou rien. Null sans nom. */
export function recipeData(f: RecipeFields): RecipeData | null {
  const name = f.name.trim(); if (!name) return null;
  const int = (v: string): number | null => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
  return {
    name, level: f.level, color: f.color, photoId: f.photoId,
    portions: int(f.portions), prepMin: int(f.prepMin), cookMin: int(f.cookMin),
    source: f.source.trim() || null, tags: [...f.tags], rating: f.rating > 0 ? f.rating : null,
    ingr: f.ingr.map((x) => x.val.trim()).filter(Boolean), steps: f.steps.map((x) => x.val.trim()).filter(Boolean),
  };
}

const shape = (d: RecipeData): string => JSON.stringify([d.name, d.level, d.color, d.photoId ?? null, d.portions ?? null, d.prepMin ?? null,
  d.cookMin ?? null, d.source ?? null, d.tags || [], d.rating ?? null, d.ingr, d.steps]);
/** L'enregistrement changerait-il la recette ? Rien de changé : rien n'est écrit. */
export function recipeChanges(r: Recipe, d: RecipeData): boolean { return shape(r) !== shape(d); }
