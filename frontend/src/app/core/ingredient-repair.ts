/**
 * Reprise des lignes d'ingrédients que le lecteur n'a pas su rattacher.
 *
 * Le lecteur (`ingredients.ts`) fait ce qu'il peut avec le français écrit à la
 * main ; ce qui lui échappe n'est pas une erreur à corriger dans le code, mais
 * un mot que le foyer emploie et que la base intégrée ignore. Ce module donne
 * la vue d'ensemble (« ces sept lignes ne se rattachent à rien, et voici où
 * elles apparaissent ») et les deux gestes qui la referment : rattacher la
 * forme à un article déjà connu, ou créer l'article manquant.
 *
 * Deux règles tenues ici :
 *
 *   - **Rien n'est deviné.** Une forme n'est jamais rattachée automatiquement à
 *     l'article qui lui ressemble : un rattachement faux se propage à tout le
 *     carnet et à toutes les listes de courses suivantes, sans que personne le
 *     remarque.
 *   - **Une correction du foyer gagne toujours.** Rattacher une forme à un
 *     article de la base intégrée en fabrique une copie côté foyer, que les
 *     mises à jour de l'application ne réécriront pas.
 */
import { Allergene, normaliseName } from './articles';
import { Article, Rayon, Recipe } from './models';
import { ArticleIndex, parseIngredient } from './ingredients';

/** Une apparition d'une forme non reconnue, dans une recette précise. */
export interface RepairUse { recipeId: string; recipeName: string; raw: string; }

export interface RepairGroup {
  /** Forme normalisée : c'est elle qui regroupe « Farine T55 » et « farine t55 ». */
  form: string;
  /** Produit tel que le lecteur l'a isolé, affiché et proposé en nom d'article. */
  name: string;
  count: number;
  uses: RepairUse[];
}

export interface RepairReport {
  /** Produits lus dans tout le carnet. Une ligne « thym + laurier » en compte deux. */
  total: number;
  matched: number;
  /** Taux de rattachement, entier. Vaut 100 quand il n'y a rien à lire. */
  rate: number;
  /** Formes non reconnues, de la plus fréquente à la plus rare. */
  groups: RepairGroup[];
  /**
   * Lignes dont aucun produit n'a pu être isolé (« 3 », « pour la sauce : »).
   * Elles ne se réparent pas ici : il faut rouvrir la recette.
   */
  unreadable: RepairUse[];
}

/**
 * Parcourt le carnet et rend ce qui reste à rattacher. Le tri met le plus
 * fréquent en tête : c'est ce qui rapporte le plus par geste.
 */
export function scanRecipes(recipes: Recipe[], idx: ArticleIndex): RepairReport {
  const groups = new Map<string, RepairGroup>();
  const unreadable: RepairUse[] = [];
  let total = 0;
  let matched = 0;

  for (const r of recipes || []) {
    for (const line of r.ingr || []) {
      for (const p of parseIngredient(line, idx)) {
        total++;
        if (p.status === 'article') { matched++; continue; }
        const use: RepairUse = { recipeId: r.id, recipeName: r.name, raw: p.raw };
        if (p.status === 'illisible') { unreadable.push(use); continue; }
        const form = normaliseName(p.name);
        if (!form) { unreadable.push(use); continue; }
        const g = groups.get(form);
        if (g) { g.count++; g.uses.push(use); }
        else groups.set(form, { form, name: p.name, count: 1, uses: [use] });
      }
    }
  }

  return {
    total,
    matched,
    rate: total ? Math.round((matched / total) * 100) : 100,
    groups: [...groups.values()].sort((a, b) => b.count - a.count || a.form.localeCompare(b.form)),
    unreadable,
  };
}

export interface ArticleDraft { name: string; rayon: Rayon; pantry: boolean; allerg: Allergene[]; }

/**
 * Clé d'article, au format de la base intégrée. Les clés déjà prises sont
 * évitées : réutiliser celle d'un article de la base l'écraserait en silence,
 * et le foyer perdrait ses synonymes d'origine.
 */
export function articleKey(name: string, taken: Set<string>): string {
  const base = normaliseName(name).replace(/ /g, '-') || 'article';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(base + '-' + n)) return base + '-' + n;
}

/**
 * Apprend une forme à un article déjà connu. Quand l'article vient de la base
 * intégrée, il est d'abord recopié côté foyer : c'est la seule façon de lui
 * ajouter un synonyme sans toucher à l'application.
 *
 * Rend le tableau d'articles du foyer, inchangé si la forme y était déjà.
 */
export function linkForm(articles: Article[], key: string, form: string, idx: ArticleIndex): Article[] {
  const connu = idx.byKey.get(key);
  if (!connu) return articles;
  const propre = form.trim();
  if (!propre) return articles;

  const i = articles.findIndex((a) => a.key === key);
  const actuel: Article = i >= 0 ? articles[i]
    : { key: connu.key, name: connu.name, syn: [], rayon: connu.rayon, ...(connu.pantry ? { pantry: true } : {}), ...(connu.allerg.length ? { allerg: [...connu.allerg] } : {}) };

  const deja = new Set([actuel.name, ...actuel.syn].map(normaliseName));
  if (deja.has(normaliseName(propre))) return articles;

  const maj: Article = { ...actuel, syn: [...actuel.syn, propre] };
  return i >= 0 ? articles.map((a, n) => (n === i ? maj : a)) : [...articles, maj];
}

/**
 * Crée l'article manquant, en lui apprenant du même coup la forme qui l'a fait
 * découvrir. Le nom saisi et la forme lue diffèrent souvent (« Farine T55 » vue
 * comme « farine t55 »), et perdre la seconde rendrait le geste inopérant.
 */
export function createArticle(articles: Article[], draft: ArticleDraft, form: string, idx: ArticleIndex): Article[] {
  const name = draft.name.trim();
  if (!name) return articles;
  const taken = new Set([...idx.byKey.keys(), ...articles.map((a) => a.key)]);
  const propre = form.trim();
  const syn = propre && normaliseName(propre) !== normaliseName(name) ? [propre] : [];
  return [...articles, {
    key: articleKey(name, taken),
    name,
    syn,
    rayon: draft.rayon,
    ...(draft.pantry ? { pantry: true } : {}),
    ...(draft.allerg.length ? { allerg: [...draft.allerg] } : {}),
  }];
}

/**
 * Articles proposés au rattachement, filtrés sur ce qui est tapé. Le nom et les
 * synonymes sont cherchés : « gousse d'ail » doit trouver « Ail ».
 */
export function searchArticles(idx: ArticleIndex, articles: Article[], q: string, limit = 12): { key: string; name: string; rayon: Rayon }[] {
  const n = normaliseName(q);
  const syn = new Map(articles.map((a) => [a.key, a.syn]));
  const out: { key: string; name: string; rayon: Rayon }[] = [];
  for (const a of idx.byKey.values()) {
    if (n) {
      const formes = [a.name, ...(syn.get(a.key) || [])].map(normaliseName);
      if (!formes.some((f) => f.includes(n))) continue;
    }
    out.push({ key: a.key, name: a.name, rayon: a.rayon });
    if (!n && out.length >= limit) break;
  }
  // Le plus court d'abord : « ail » avant « ail des ours » quand on tape « ail ».
  return out.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)).slice(0, limit);
}
