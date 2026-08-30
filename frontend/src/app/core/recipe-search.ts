/**
 * Retrouver une recette : « qu'est-ce que je fais avec des courgettes et vingt
 * minutes ». Trois axes, tous cumulables, tous lus dans une seule ligne de
 * saisie plutôt que dans trois champs.
 *
 * La recherche ne devine rien : un mot est cherché dans le nom, les étiquettes
 * et les **ingrédients rattachés**, ce qui fait que « courgette » trouve aussi
 * « 2 courgettes moyennes ». Une durée écrite « 20 min » ou « -20 min » filtre
 * sur le temps total. Ce qui n'est ni l'un ni l'autre reste un mot à chercher :
 * mieux vaut un filtre ignoré qu'un filtre inventé.
 */
import { Recipe } from './models';
import { ArticleIndex, parseIngredient } from './ingredients';
import { normaliseName } from './articles';

export interface Query {
  /** Mots à retrouver, normalisés. */
  words: string[];
  /** Durée totale maximale en minutes, quand la requête en donne une. */
  maxMin: number | null;
  /** Note minimale, quand la requête en donne une (« 4 étoiles »). */
  minRating: number | null;
}

// Lus sur la ligne entière et non sur des mots découpés : « 30 min » et
// « 4 étoiles » s'écrivent en deux morceaux, et découper d'abord les rendait
// illisibles. Ce qui reste après extraction est cherché comme du texte.
const MINUTES = /(?:moins\s+de\s+|[-<])?(\d{1,3})\s*(?:min\b|mn\b|minutes?\b|')/gi;
const HEURES = /(?:moins\s+de\s+|[-<])?(\d{1,2})\s*(?:h(?![a-zà-ÿ])|heures?\b)\s*(\d{1,2})?/gi;
const ETOILES = /(\d)\s*(?:\*|étoiles?\b|etoiles?\b)/gi;

/** Lit la ligne de recherche. Les filtres reconnus sortent, le reste sont des mots. */
export function parseQuery(raw: string): Query {
  const q: Query = { words: [], maxMin: null, minRating: null };
  let reste = String(raw ?? '');
  const plusCourt = (n: number): void => { q.maxMin = q.maxMin === null ? n : Math.min(q.maxMin, n); };

  // Les heures d'abord : « 1h30 » ne doit pas laisser « 30 » derrière lui.
  reste = reste.replace(HEURES, (_m, h: string, mn?: string) => {
    plusCourt(parseInt(h, 10) * 60 + (mn ? parseInt(mn, 10) : 0));
    return ' ';
  });
  reste = reste.replace(MINUTES, (_m, n: string) => { plusCourt(parseInt(n, 10)); return ' '; });
  reste = reste.replace(ETOILES, (_m, n: string) => {
    const v = parseInt(n, 10);
    q.minRating = q.minRating === null ? v : Math.max(q.minRating, v);
    return ' ';
  });

  for (const part of reste.split(/[\s,]+/).filter(Boolean)) {
    const w = normaliseName(part);
    if (w) q.words.push(w);
  }
  return q;
}

/** Durée totale d'une recette, ou null quand elle n'est pas renseignée. */
export const totalMin = (r: Recipe): number | null => {
  const t = (r.prepMin || 0) + (r.cookMin || 0);
  return t > 0 ? t : null;
};

/**
 * Tout ce qui est cherchable dans une recette, normalisé une fois. Les
 * ingrédients passent par le lecteur : le nom d'article rattaché est ajouté à
 * la ligne brute, ce qui fait que « pomme de terre » trouve « 4 patates ».
 */
export function searchText(r: Recipe, index: ArticleIndex): string {
  const bouts = [r.name, ...(r.tags || [])];
  for (const ligne of r.ingr || []) {
    bouts.push(ligne);
    for (const p of parseIngredient(ligne, index)) {
      const a = p.art ? index.byKey.get(p.art) : undefined;
      if (a) bouts.push(a.name);
    }
  }
  return normaliseName(bouts.join(' '));
}

export interface Hit { recipe: Recipe; total: number | null; }

/**
 * Filtre le carnet. Une durée demandée écarte les recettes qui ne disent pas la
 * leur : sans durée connue, on ne peut pas affirmer qu'elle tient en vingt
 * minutes, et l'affirmer quand même serait le genre de promesse qui se paie à
 * dix-neuf heures trente.
 */
export function searchRecipes(recipes: Recipe[], q: Query, index: ArticleIndex): Hit[] {
  const vide = !q.words.length && q.maxMin === null && q.minRating === null;
  const out: Hit[] = [];
  for (const r of recipes || []) {
    const total = totalMin(r);
    if (!vide) {
      if (q.maxMin !== null && (total === null || total > q.maxMin)) continue;
      if (q.minRating !== null && (r.rating || 0) < q.minRating) continue;
      if (q.words.length) {
        const texte = searchText(r, index);
        if (!q.words.every((w) => texte.includes(w))) continue;
      }
    }
    out.push({ recipe: r, total });
  }
  // La plus rapide d'abord quand une durée est demandée : c'est la question
  // posée. Sinon l'ordre du carnet, que l'utilisateur connaît.
  if (q.maxMin !== null) out.sort((a, b) => (a.total ?? 1e6) - (b.total ?? 1e6) || a.recipe.name.localeCompare(b.recipe.name));
  return out;
}
