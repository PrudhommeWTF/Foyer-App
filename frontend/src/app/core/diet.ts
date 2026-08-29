/**
 * Contraintes alimentaires : ce qu'un plat contient, et à qui il ne convient pas.
 *
 * Tout est **dérivé**, rien n'est saisi deux fois : les allergènes d'une recette
 * viennent des articles que le lecteur a su rattacher, et une alerte naît de la
 * rencontre entre ces articles et ce qu'un membre a déclaré.
 *
 * La règle qui gouverne tout ce fichier : **l'absence d'alerte ne prouve rien**.
 * Une ligne d'ingrédient que le lecteur n'a pas rattachée ne porte aucun
 * allergène, donc ne déclenche aucune alerte, alors qu'elle peut parfaitement en
 * contenir. Chaque résultat porte donc le nombre de lignes non vérifiées, et
 * l'interface a le devoir de le montrer : une alerte silencieuse qu'on croit
 * exhaustive est plus dangereuse que pas d'alerte du tout.
 */
import { Allergene, ALLERGENES } from './articles';
import { Member, Recipe } from './models';
import { ArticleIndex, parseIngredient } from './ingredients';

/** Une contrainte déclarée par un membre. Vide = aucune. */
export interface Diet { allerg: Allergene[]; refuse: string[]; }

export const dietOf = (m: Member): Diet => ({
  allerg: (m.allerg || []) as Allergene[],
  refuse: m.refuse || [],
});

export const hasDiet = (m: Member): boolean => !!(m.allerg?.length || m.refuse?.length);

/** Ce qu'une recette contient, tel que le référentiel permet de l'affirmer. */
export interface RecipeContent {
  allerg: Allergene[];
  /** Clés d'articles reconnus, pour confronter aux aliments refusés. */
  keys: Set<string>;
  /** Lignes que le lecteur n'a pas su rattacher : elles n'ont pas été vérifiées. */
  unchecked: string[];
}

export function recipeContent(recipe: Recipe, idx: ArticleIndex): RecipeContent {
  const allerg = new Set<Allergene>();
  const keys = new Set<string>();
  const unchecked: string[] = [];
  for (const line of recipe.ingr || []) {
    for (const p of parseIngredient(line, idx)) {
      const a = p.art ? idx.byKey.get(p.art) : undefined;
      if (!a) { if (!unchecked.includes(p.raw)) unchecked.push(p.raw); continue; }
      keys.add(a.key);
      for (const x of a.allerg) allerg.add(x);
    }
  }
  // Ordre du référentiel plutôt qu'ordre d'apparition : la même recette affiche
  // toujours ses allergènes dans le même ordre, d'une session à l'autre.
  const ordre = Object.keys(ALLERGENES) as Allergene[];
  return { allerg: ordre.filter((a) => allerg.has(a)), keys, unchecked };
}

/** Ce qui, dans un plat, s'oppose à ce qu'un membre a déclaré. */
export interface Conflict {
  memberId: string;
  name: string;
  color: string;
  allerg: Allergene[];
  /** Aliments refusés présents, nommés tels que le référentiel les nomme. */
  refused: string[];
}

/**
 * Confronte le contenu d'une recette aux contraintes de chaque membre. Les
 * membres sans contrainte déclarée ne produisent jamais de conflit : ne rien
 * savoir d'eux n'est pas une raison de les alerter.
 */
export function conflicts(content: RecipeContent, members: Member[], idx: ArticleIndex): Conflict[] {
  const out: Conflict[] = [];
  for (const m of members || []) {
    const d = dietOf(m);
    const allerg = d.allerg.filter((a) => content.allerg.includes(a));
    const refused = d.refuse.filter((k) => content.keys.has(k)).map((k) => idx.byKey.get(k)?.name || k);
    if (allerg.length || refused.length) out.push({ memberId: m.id, name: m.name, color: m.color, allerg, refused });
  }
  return out;
}

/** Raccourci de lecture : contenu et conflits d'une recette, en une fois. */
export function checkRecipe(recipe: Recipe, members: Member[], idx: ArticleIndex): { content: RecipeContent; conflicts: Conflict[] } {
  const content = recipeContent(recipe, idx);
  return { content, conflicts: conflicts(content, members, idx) };
}

/** Une phrase pour un conflit : « Léa : lait, œufs » ou « Léa : champignon ». */
export function conflictLabel(c: Conflict): string {
  const quoi = [...c.allerg.map((a) => ALLERGENES[a].toLowerCase()), ...c.refused.map((r) => r.toLowerCase())];
  return c.name + ' : ' + quoi.join(', ');
}

/**
 * Conflits d'un créneau de repas, tous plats confondus. Un créneau porte
 * plusieurs plats et il suffit qu'un seul pose problème : les conflits sont
 * fusionnés par membre, sinon la grille afficherait le même prénom trois fois.
 */
export function mealConflicts(items: { rid?: string; text?: string }[], recipes: Recipe[], members: Member[], idx: ArticleIndex): Conflict[] {
  const parMembre = new Map<string, Conflict>();
  for (const it of items || []) {
    if (!it.rid) continue;  // un plat en texte libre n'a pas d'ingrédients à lire
    const r = recipes.find((x) => x.id === it.rid);
    if (!r) continue;
    for (const c of checkRecipe(r, members, idx).conflicts) {
      const deja = parMembre.get(c.memberId);
      if (!deja) { parMembre.set(c.memberId, { ...c, allerg: [...c.allerg], refused: [...c.refused] }); continue; }
      for (const a of c.allerg) if (!deja.allerg.includes(a)) deja.allerg.push(a);
      for (const r2 of c.refused) if (!deja.refused.includes(r2)) deja.refused.push(r2);
    }
  }
  return [...parMembre.values()];
}
