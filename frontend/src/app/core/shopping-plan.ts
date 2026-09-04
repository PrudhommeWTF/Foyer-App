// Des repas planifiés vers une liste de courses.
//
// La version précédente recopiait chaque ligne d'ingrédient telle quelle : la
// liste contenait « 0.5 cuillère à café de cumin en poudre », « sel » trois fois
// et « Condiments (sel, poivre, persil...) », le tout dans « À trier ». Elle
// était plus pénible à corriger qu'à écrire à la main.
//
// Ce module fait trois choses que ce copier-coller ne faisait pas :
//
//   1. **Il additionne.** Trois recettes qui demandent chacune 150 g de farine
//      donnent une ligne à 450 g, pas trois lignes à 150.
//   2. **Il met à l'échelle.** Une recette pour 4 servie à 6 convives voit ses
//      quantités multipliées ; ce qui n'a pas de nombre reste tel quel.
//   3. **Il rend des comptes avant d'écrire.** Le rapport dit ce qui sera
//      ajouté, complété, retiré, écarté comme fond de placard, et ce qu'il n'a
//      pas su lire. Rien n'est appliqué sans que ce soit affiché d'abord.
//
// Et surtout, une régénération ne touche **que ce qu'elle a elle-même écrit** :
// un article ajouté à la main, ou déjà mis au panier, survit toujours.

import { RAYON_REPLI, RAYONS, normaliseName } from './articles';
import { ArticleIndex, ParsedIng, UNIT_BY_KEY, parseIngredient } from './ingredients';
import { Aisle, Article, MealValue, Rayon, Recipe, ShopItem } from './models';

export interface PlanSource { recipe: string; raw: string; }

export interface PlanLine {
  /** Clé d'article, absente quand la ligne n'a pas été reconnue. */
  art?: string;
  name: string;
  qty: string;
  aisleId: string;
  pantry: boolean;
  sources: PlanSource[];
}

export interface PlanReport {
  /** À ajouter à la liste. */
  add: PlanLine[];
  /** Déjà généré, quantité à corriger. */
  update: { line: PlanLine; item: ShopItem }[];
  /** Généré autrefois, plus demandé par aucun repas, et jamais touché depuis. */
  remove: ShopItem[];
  /** Fond de placard : proposé, décoché par défaut. */
  pantry: PlanLine[];
  /**
   * « J'ai déjà ça », dit récemment : proposé, décoché par défaut, avec la date
   * du geste. Elle est montrée plutôt que tue, parce que c'est elle qui permet
   * de juger : trois jours pour de la crème et trois semaines pour de la farine
   * ne se valent pas, et l'application n'a aucun moyen de le savoir.
   */
  stocked: { line: PlanLine; since: string; days: number }[];
  /** Déjà dans la liste par un ajout manuel : laissé tranquille. */
  present: PlanLine[];
  /** Lignes dont le produit n'a pas été reconnu. Ajoutées quand même, telles quelles. */
  unknown: PlanSource[];
  /** Recettes mises à l'échelle, pour l'afficher. */
  /**
   * Recettes mises à l'échelle, avec **tous** les nombres de couverts qui les ont
   * servies. Une même recette peut être planifiée deux fois dans la semaine avec
   * des convives différents, et n'en annoncer qu'un seul serait un mensonge.
   */
  scaled: { recipe: string; portions: number; pax: number[] }[];
  /** Recettes planifiées sans portions connues : quantités laissées telles quelles. */
  unscaled: string[];
}

/** Rayon du foyer où ranger un article d'un type donné. */
export function aisleForRayon(aisles: Aisle[], rayon: Rayon, fallback: string): string {
  const byKind = aisles.find((a) => a.kind === rayon)
    || aisles.find((a) => a.kind === RAYON_REPLI[rayon]);
  if (byKind) return byKind.id;
  // Aucun rayon typé : le nom sert de repli, ce qui suffit pour les rayons créés
  // à l'installation et évite d'imposer un réglage avant de pouvoir s'en servir.
  const label = RAYONS.find((r) => r.key === rayon)?.name || '';
  const byName = aisles.find((a) => normaliseName(a.name) === normaliseName(label))
    || aisles.find((a) => normaliseName(a.name) === normaliseName(RAYONS.find((r) => r.key === RAYON_REPLI[rayon])?.name || ''));
  return byName?.id || fallback;
}

interface Bucket {
  art?: string;
  name: string;
  rayon: Rayon;
  pantry: boolean;
  /** Totaux par famille d'unité : les grammes s'additionnent, pas les cuillères. */
  amounts: Map<string, { qty: number; unit?: string }>;
  sources: PlanSource[];
}

const familyOf = (unit?: string): string => {
  const u = unit ? UNIT_BY_KEY.get(unit) : undefined;
  // « 1 pièce de poivron » et « 1 poivron » sont la même chose : les compter à
  // part donnerait « 1 pièce + 2 » là où trois poivrons suffisent à le dire.
  if (!unit || unit === 'piece') return 'nb';
  return u?.base ? u.base : 'u:' + unit;
};

/** Quantité ramenée à l'unité de base de sa famille, pour être additionnée. */
const toBase = (qty: number, unit?: string): number => {
  const u = unit ? UNIT_BY_KEY.get(unit) : undefined;
  return u?.factor ? qty * u.factor : qty;
};

const nombre = (n: number): string => {
  const arrondi = Math.round(n * 100) / 100;
  return arrondi.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
};

/** Écrit un total dans l'unité la plus lisible de sa famille. */
function formatAmount(family: string, total: number, unit?: string): string {
  if (family === 'nb') {
    // On n'achète pas un demi-oignon : la fraction est arrondie au-dessus.
    return String(Math.max(Math.ceil(total - 0.001), 1));
  }
  if (family === 'masse' || family === 'volume') {
    // Échelle décroissante : on descend d'un cran tant que le nombre est
    // inférieur à 1, pour écrire « 67 cl » plutôt que « 0,67 l ».
    const echelle = family === 'masse' ? ['kg', 'g'] : ['l', 'cl', 'ml'];
    const depart = unit && echelle.includes(unit) ? echelle.indexOf(unit) : echelle.length - 1;
    let i = total >= (family === 'masse' ? 1000 : 1000) ? 0 : Math.max(depart, 0);
    for (; i < echelle.length - 1; i++) {
      if (total / (UNIT_BY_KEY.get(echelle[i])!.factor || 1) >= 1) break;
    }
    const u = UNIT_BY_KEY.get(echelle[i])!;
    const v = total / (u.factor || 1);
    // Un gramme près en dessous de dix, l'unité au-dessus : la mise à l'échelle
    // produit des décimales dont aucune balance de cuisine ne fait rien.
    return nombre(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + ' ' + u.sing;
  }
  // Poignées, pincées, cuillères : mesures approximatives par nature, arrondies
  // au demi supérieur plutôt que rendues avec deux décimales trompeuses.
  const u = UNIT_BY_KEY.get(family.slice(2));
  const n = Math.ceil(total * 2 - 0.001) / 2;
  return nombre(n) + ' ' + (u ? (n > 1 ? u.plur : u.sing) : '');
}

const formatBucket = (b: Bucket): string =>
  [...b.amounts.entries()].map(([f, a]) => formatAmount(f, a.qty, a.unit)).join(' + ');

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Durée pendant laquelle un « j'ai déjà ça » continue d'écarter l'article.
 * Trois semaines : assez pour un paquet de farine, assez court pour qu'un
 * oubli ne fasse pas rater des courses tout un mois. La date est affichée de
 * toute façon, et l'article se recoche en un geste.
 */
export const STOCK_DAYS = 21;

/** La durée réglée par le foyer, ou celle ci-dessus quand elle n'est pas donnée. */

/**
 * Clé sous laquelle une ligne se retient dans le stock : celle de son article
 * quand il est reconnu, sinon son nom normalisé. La même que pour un article de
 * la liste, sans quoi « j'ai déjà ça » ne retrouverait jamais sa ligne.
 */
export const keyOfLine = (l: PlanLine): string => l.art || normaliseName(l.name);

/** Écart en jours entre deux dates ISO, positif quand `to` est après `from`. */
export function stockAge(from: string, to: string): number {
  const j = (x: string): number => { const [y, m, d] = x.split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); };
  const n = Math.round((j(to) - j(from)) / 86400000);
  return Number.isFinite(n) ? n : Infinity;
}

/** « prévue pour 4, ajustée à 3 puis 2 couverts ». */
export function scaleLabel(s: { portions: number; pax: number[] }): string {
  const liste = s.pax.length > 1 ? s.pax.slice(0, -1).join(', ') + ' puis ' + s.pax[s.pax.length - 1] : String(s.pax[0]);
  return 'prévue pour ' + s.portions + ', ajustée à ' + liste + (s.pax.length > 1 || s.pax[0] > 1 ? ' couverts' : ' couvert');
}

export interface PlanInput {
  /**
   * Créneaux retenus, chacun avec ses couverts déjà résolus. Le calcul des
   * présents appartient à l'appelant (voir presence.ts) : un chiffre unique pour
   * toute la semaine serait faux dès que quelqu'un déjeune ailleurs le mardi.
   */
  slots: { value: MealValue; pax: number }[];
  recipes: Recipe[];
  aisles: Aisle[];
  articles: Article[];
  index: ArticleIndex;
  /** Articles déjà dans la liste visée. */
  existing: ShopItem[];
  /** Rayon de repli quand rien ne correspond (« À trier »). */
  fallbackAisle: string;
  /** « J'ai déjà ça » : clé vers la date du geste. */
  stock?: Record<string, string>;
  /** Jour de référence pour périmer les marques, au format ISO. */
  today?: string;
  /** Durée pendant laquelle un « j'ai déjà ça » écarte l'article. Réglée par le foyer. */
  stockDays?: number;
}

/**
 * Calcule ce que deviendrait la liste, sans rien écrire. Le résultat est fait
 * pour être montré avant d'être appliqué : c'est le seul moment où une erreur
 * d'analyse se rattrape sans avoir à défaire des courses.
 */
export function buildPlan(input: PlanInput): PlanReport {
  const { recipes, index } = input;
  const buckets = new Map<string, Bucket>();
  const unknown: PlanSource[] = [];
  const scaled: PlanReport['scaled'] = [];
  const unscaled: string[] = [];
  const seenRecipe = new Set<string>();

  for (const slot of input.slots) {
    const pax = slot.pax > 0 ? slot.pax : 1;
    for (const it of slot.value.items || []) {
      const r = it.rid ? recipes.find((x) => x.id === it.rid) : undefined;
      if (!r) continue;
      const portions = r.portions && r.portions > 0 ? r.portions : 0;
      const factor = portions ? pax / portions : 1;
      if (!portions) {
        if (!seenRecipe.has(r.id)) { seenRecipe.add(r.id); unscaled.push(r.name); }
      } else if (Math.abs(factor - 1) > 0.001) {
        const deja = scaled.find((x) => x.recipe === r.name);
        if (!deja) scaled.push({ recipe: r.name, portions, pax: [pax] });
        else if (!deja.pax.includes(pax)) deja.pax.push(pax);
      }
      seenRecipe.add(r.id);
      for (const line of r.ingr || []) {
        const parsed = parseIngredient(line, index);
        if (!parsed.length) continue;
        for (const p of parsed) push(buckets, unknown, p, r.name, factor, index);
      }
    }
  }

  // ---- confrontation avec la liste existante -------------------------------
  const report: PlanReport = { add: [], update: [], remove: [], pantry: [], stocked: [], present: [], unknown, scaled, unscaled };
  const stock = input.stock || {};
  const today = input.today || '';
  const keyOfItem = (i: ShopItem): string => i.art || normaliseName(i.name);
  const generated = input.existing.filter((i) => i.gen);
  const manual = input.existing.filter((i) => !i.gen);
  const manualKeys = new Set(manual.map(keyOfItem));
  const wanted = new Set<string>();

  for (const [key, b] of buckets) {
    const line: PlanLine = {
      ...(b.art ? { art: b.art } : {}),
      name: cap(b.name),
      qty: b.amounts.size ? formatBucket(b) : '',
      aisleId: b.art ? aisleForRayon(input.aisles, b.rayon, input.fallbackAisle) : input.fallbackAisle,
      pantry: b.pantry,
      sources: b.sources,
    };
    if (b.pantry) { report.pantry.push(line); continue; }
    if (manualKeys.has(key)) { report.present.push(line); continue; }
    // « J'ai déjà ça », dit assez récemment pour que ce soit encore vrai.
    const dit = stock[key];
    if (dit && today) {
      const days = stockAge(dit, today);
      if (days >= 0 && days <= (input.stockDays ?? STOCK_DAYS)) { report.stocked.push({ line, since: dit, days }); continue; }
    }
    wanted.add(key);
    const deja = generated.find((i) => keyOfItem(i) === key);
    if (!deja) report.add.push(line);
    else if (deja.qty !== line.qty && deja.state === 'a-prendre') report.update.push({ line, item: deja });
  }

  // Ce que la génération avait écrit et que plus aucun repas ne demande. Coché
  // ou marqué introuvable, il reste : quelqu'un s'en est occupé, ce n'est plus
  // à la génération d'en décider.
  for (const i of generated) if (!wanted.has(keyOfItem(i)) && i.state === 'a-prendre') report.remove.push(i);

  const ordre = (a: PlanLine, b: PlanLine): number =>
    input.aisles.findIndex((x) => x.id === a.aisleId) - input.aisles.findIndex((x) => x.id === b.aisleId)
    || a.name.localeCompare(b.name, 'fr');
  report.add.sort(ordre);
  report.pantry.sort(ordre);
  report.stocked.sort((a, b) => ordre(a.line, b.line));
  return report;
}

function push(
  buckets: Map<string, Bucket>, unknown: PlanSource[], p: ParsedIng,
  recipe: string, factor: number, index: ArticleIndex,
): void {
  const art = p.art ? index.byKey.get(p.art) : undefined;
  // Une ligne non reconnue part quand même aux courses, avec son texte d'origine :
  // ne pas savoir la lire n'est pas une raison de ne pas l'acheter.
  const key = p.art || normaliseName(p.name) || normaliseName(p.raw);
  if (!key) return;
  if (!p.art) unknown.push({ recipe, raw: p.raw });

  let b = buckets.get(key);
  if (!b) {
    b = {
      ...(p.art ? { art: p.art } : {}),
      name: art ? art.name : p.name || p.raw,
      rayon: art ? art.rayon : 'epicerie',
      pantry: art ? art.pantry : false,
      amounts: new Map(), sources: [],
    };
    buckets.set(key, b);
  }
  b.sources.push({ recipe, raw: p.raw });
  if (p.qty === undefined) return; // « sel » : rien à additionner, rien à retrancher non plus
  const family = familyOf(p.unit);
  const prev = b.amounts.get(family);
  const add = toBase(p.qty * factor, p.unit);
  if (prev) prev.qty += add;
  else b.amounts.set(family, { qty: add, ...(p.unit ? { unit: p.unit } : {}) });
}
