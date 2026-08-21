// Lecture d'une recette publiée en données structurées schema.org/Recipe.
//
// Pourquoi ce lecteur plutôt qu'un analyseur par site : la plupart des sites de
// cuisine francophones publient ce balisage JSON-LD dans leur page, pour que les
// moteurs de recherche affichent une fiche recette. Un seul lecteur générique
// couvre donc Marmiton, 750g, Cuisine AZ et n'importe quel blog sous WordPress
// avec un greffon recette, et ne casse pas le jour où l'un d'eux refait son
// habillage. Analyser leur HTML page par page aurait donné l'inverse : beaucoup
// de code, un seul site couvert, et une panne à chaque refonte.
//
// Ce fichier ne touche ni au réseau ni au disque : il prend une chaîne HTML et
// rend une recette. C'est ce qui permet de le tester sur des pages enregistrées,
// et à la CI de rester sans appel sortant.
//
// Deux principes tenus partout ici :
//   - **Ce qui n'est pas compris est signalé, pas inventé.** Un champ illisible
//     produit un avertissement que l'écran affiche, jamais une valeur par défaut
//     silencieuse.
//   - **On ne prend que ce qu'on sait utiliser.** Les calories, la note du site
//     et les régimes déclarés sont volontairement laissés de côté : le foyer ne
//     fait pas de suivi nutritionnel, et une note de Marmiton n'est pas la note
//     de la famille.

/** Recette telle qu'on la comprend, prête à remplir le formulaire. */
export interface ImportedRecipe {
  name: string;
  /** URL de la page d'origine, conservée pour pouvoir y retourner. */
  source: string;
  /** Nombre de portions de la recette d'origine. Base de la mise à l'échelle. */
  portions: number | null;
  prepMin: number | null;
  cookMin: number | null;
  /** Lignes d'ingrédients telles qu'écrites. L'analyse fine viendra plus tard. */
  ingr: string[];
  steps: string[];
  /** Meilleure image trouvée, à télécharger séparément. */
  imageUrl: string | null;
}

export interface ImportResult {
  recipe: ImportedRecipe;
  /** Ce que le lecteur n'a pas su lire. Affiché tel quel à l'utilisateur. */
  warnings: string[];
}

export class ImportError extends Error {}

// ---- extraction du bloc JSON-LD -------------------------------------------

const LD_BLOCK = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

const isRecipe = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== 'object') return false;
  const t = (v as Record<string, unknown>)['@type'];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === 'string' && x.split('/').pop() === 'Recipe');
};

/** Aplatit tableaux, `@graph` et objets imbriqués pour retrouver le nœud Recipe. */
function* walk(value: unknown, depth = 0): Generator<unknown> {
  if (depth > 6 || value == null) return;
  if (Array.isArray(value)) {
    for (const v of value) yield* walk(v, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  yield value;
  const graph = (value as Record<string, unknown>)['@graph'];
  if (graph) yield* walk(graph, depth + 1);
  const main = (value as Record<string, unknown>)['mainEntity'];
  if (main) yield* walk(main, depth + 1);
}

/**
 * Trouve le nœud Recipe d'une page. Rend null quand la page n'en publie pas :
 * c'est une information, pas une erreur, et l'appelant sait quoi en dire.
 */
export function findRecipeNode(html: string): Record<string, unknown> | null {
  LD_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LD_BLOCK.exec(html)) !== null) {
    let parsed: unknown;
    // Un bloc illisible ne doit pas empêcher de lire les suivants : une page en
    // porte souvent quatre ou cinq (fil d'Ariane, organisation, vidéo, recette).
    try { parsed = JSON.parse(m[1]); } catch { continue; }
    for (const node of walk(parsed)) if (isRecipe(node)) return node as Record<string, unknown>;
  }
  return null;
}

// ---- conversions élémentaires ---------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clean = (v: unknown): string => str(v).replace(/\s+/g, ' ').trim();

/**
 * Durée ISO 8601 vers minutes. Les sites écrivent « PT15M », « PT1H30M »,
 * parfois « PT0S ». Les jours sont acceptés, une marinade de 24 h existe.
 */
export function parseIsoDuration(value: unknown): number | null {
  const s = clean(value).toUpperCase();
  const m = /^P(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/.exec(s);
  if (!m || !m.slice(1).some(Boolean)) return null;
  const num = (x: string | undefined): number => (x ? parseFloat(x.replace(',', '.')) : 0);
  const minutes = num(m[1]) * 1440 + num(m[2]) * 60 + num(m[3]) + num(m[4]) / 60;
  const rounded = Math.round(minutes);
  return rounded > 0 ? rounded : null;
}

/**
 * Nombre de portions. `recipeYield` est du texte libre : « 4 », « 4 personnes »,
 * « pour 6 parts », parfois un tableau. Sans nombre lisible, on ne devine pas :
 * une portion inventée fausserait toute la mise à l'échelle des courses.
 */
export function parseYield(value: unknown): number | null {
  const first = Array.isArray(value) ? value.find((v) => clean(v)) : value;
  const s = clean(first);
  if (!s) return null;
  const m = /(\d+(?:[.,]\d+)?)/.exec(s);
  if (!m) return null;
  const n = Math.round(parseFloat(m[1].replace(',', '.')));
  // Au-delà, ce n'est plus un nombre de couverts mais un poids ou un volume
  // (« 1000 g de pâte »), qu'on ne sait pas interpréter.
  return n >= 1 && n <= 100 ? n : null;
}

/**
 * Retire les appâts à moteur de recherche que les sites accolent au titre.
 * « Gratin de courgettes rapide : la meilleure recette » devient « Gratin de
 * courgettes rapide ». Un titre qui ne serait plus que du bruit est laissé
 * intact : mieux vaut un titre bavard qu'un titre vide.
 */
export function cleanTitle(value: unknown): string {
  const raw = clean(value);
  const cut = raw.replace(
    /\s*[:\-–—]\s*(la (meilleure|vraie) recette|recette (facile|rapide|de grand-?mère)|facile et rapide|notre recette.*|recette.*marmiton.*)\s*$/i,
    '',
  );
  return cut.length >= 3 ? cut : raw;
}

/** Texte d'une consigne, qu'elle soit une chaîne, un HowToStep ou un objet balisé. */
function stepText(node: unknown): string {
  if (typeof node === 'string') return clean(node);
  if (!node || typeof node !== 'object') return '';
  const o = node as Record<string, unknown>;
  return clean(o['text'] ?? o['name'] ?? o['description']);
}

/**
 * Consignes de la recette. Le champ prend toutes les formes du standard : une
 * chaîne unique, un tableau de chaînes, des HowToStep, ou des HowToSection qui
 * contiennent elles-mêmes les étapes (« Pour la pâte », « Pour la garniture »).
 */
export function parseInstructions(value: unknown): string[] {
  const out: string[] = [];
  const push = (s: string): void => { if (s) out.push(s); };

  const visit = (node: unknown, depth = 0): void => {
    if (depth > 4 || node == null) return;
    if (Array.isArray(node)) { for (const n of node) visit(n, depth + 1); return; }
    if (typeof node === 'string') {
      // Une consigne unique en un seul bloc : les sauts de ligne font les étapes.
      for (const line of node.split(/\r?\n+/)) push(clean(line));
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const children = o['itemListElement'] ?? o['steps'];
    if (children) {
      // Une section : son nom sert d'intertitre, ses éléments sont les étapes.
      const label = clean(o['name']);
      if (label) push(label);
      visit(children, depth + 1);
      return;
    }
    push(stepText(o));
  };

  visit(value);
  return out;
}

/** Lignes d'ingrédients, dédoublonnées à l'identique et débarrassées des vides. */
export function parseIngredients(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const line = clean(typeof raw === 'string' ? raw : (raw as Record<string, unknown>)?.['name']);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/**
 * Meilleure image parmi celles proposées. Les sites en listent plusieurs
 * tailles et plusieurs formats : on préfère un JPEG ou un PNG, parce que le
 * WebP passe mal dans certains clients, et la première venue à défaut.
 */
export function parseImage(value: unknown): string | null {
  const urls: string[] = [];
  const collect = (v: unknown, depth = 0): void => {
    if (depth > 3 || v == null) return;
    if (Array.isArray(v)) { for (const x of v) collect(x, depth + 1); return; }
    if (typeof v === 'string') { if (/^https?:\/\//i.test(v.trim())) urls.push(v.trim()); return; }
    if (typeof v === 'object') collect((v as Record<string, unknown>)['url'] ?? (v as Record<string, unknown>)['contentUrl'], depth + 1);
  };
  collect(value);
  if (!urls.length) return null;
  return urls.find((u) => /\.(jpe?g|png)(\?|$)/i.test(u)) ?? urls[0];
}

// ---- assemblage ------------------------------------------------------------

/** Construit la recette à partir du nœud, en disant ce qu'elle n'a pas su lire. */
export function fromRecipeNode(node: Record<string, unknown>, sourceUrl: string): ImportResult {
  const warnings: string[] = [];

  const name = cleanTitle(node['name']);
  if (!name) throw new ImportError('La page contient une recette, mais sans titre lisible.');

  const ingr = parseIngredients(node['recipeIngredient'] ?? node['ingredients']);
  if (!ingr.length) warnings.push('Aucun ingrédient trouvé dans la page : à saisir à la main.');

  const steps = parseInstructions(node['recipeInstructions']);
  if (!steps.length) warnings.push('Aucune étape trouvée dans la page : à saisir à la main.');

  const portions = parseYield(node['recipeYield']);
  if (portions == null) warnings.push('Nombre de portions absent ou illisible : indiquez-le pour que les courses se mettent à l’échelle.');

  const prepMin = parseIsoDuration(node['prepTime']);
  const cookMin = parseIsoDuration(node['cookTime']);
  if (prepMin == null && cookMin == null) {
    // Faute de détail, le temps total renseigne la préparation : c'est le seul
    // repère dont on dispose, et le dire vaut mieux que laisser la fiche vide.
    const total = parseIsoDuration(node['totalTime']);
    if (total != null) warnings.push('Temps de préparation et de cuisson non détaillés : le temps total a été repris en préparation.');
    return {
      recipe: { name, source: sourceUrl, portions, prepMin: total, cookMin: null, ingr, steps, imageUrl: parseImage(node['image']) },
      warnings,
    };
  }

  return {
    recipe: { name, source: sourceUrl, portions, prepMin, cookMin, ingr, steps, imageUrl: parseImage(node['image']) },
    warnings,
  };
}

/**
 * Point d'entrée : une page HTML, une recette. Lève une ImportError avec un
 * message destiné à l'utilisateur quand la page ne s'y prête pas.
 */
export function parseRecipePage(html: string, sourceUrl: string): ImportResult {
  const node = findRecipeNode(html);
  if (!node) {
    throw new ImportError(
      'Cette page ne publie pas de recette au format lisible par Foyer. ' +
      'Vérifiez qu’il s’agit bien de la page d’une recette, et non d’une page de résultats de recherche ou d’un dossier.',
    );
  }
  return fromRecipeNode(node, sourceUrl);
}
