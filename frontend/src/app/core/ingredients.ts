// Lecture d'une ligne d'ingrédient française.
//
// « 3 cuillères à soupe d'huile d'olive », « 0.25 botte de persil plat »,
// « 1 barquette d'émincé 100% végétal ACCRO », « Condiments (sel, poivre, ail,
// basilic...) ». Ces lignes sont écrites pour être lues par un humain devant sa
// casserole, pas par un programme, et aucune norme ne les régit.
//
// Deux décisions tiennent tout le reste :
//
//   1. **Rien n'est enregistré.** L'analyse est une fonction pure, rejouée à
//      chaque besoin sur le texte d'origine, qui reste la seule vérité. Aucune
//      migration, aucune ligne perdue, et une recette importée hier profite
//      immédiatement de l'analyse d'aujourd'hui.
//   2. **Une correction se fait dans le référentiel, pas dans la recette.**
//      Apprendre que « émincé 100% végétal ACCRO » est du tofu corrige toutes
//      les recettes d'un coup, y compris celles qui n'existent pas encore. Une
//      correction ligne à ligne, elle, serait à refaire indéfiniment.
//
// Ce qui n'est pas compris n'est jamais jeté : la ligne ressort avec son texte
// intact et un état qui dit ce qui manque, pour l'écran de reprise.

import { Allergene, BASE_BY_KEY, BASE_INDEX, BaseArticle, normaliseName } from './articles';
import { Article, Rayon } from './models';

/**
 * Unités reconnues. `base` et `factor` disent seulement ce qui s'additionne :
 * des grammes et des kilos, oui ; des grammes et des cuillères, non, parce que
 * la conversion dépend de la densité et qu'un mauvais total fait acheter trois
 * kilos de farine sans jamais planter.
 */
export interface UnitDef { key: string; sing: string; plur: string; base?: 'masse' | 'volume'; factor?: number; }

const U = (key: string, sing: string, plur: string, forms: string, base?: 'masse' | 'volume', factor?: number):
  UnitDef & { forms: string[] } => ({ key, sing, plur, base, factor, forms: forms.split(',') });

const UNITS = [
  U('g', 'g', 'g', 'g,gr,gramme,grammes', 'masse', 1),
  U('kg', 'kg', 'kg', 'kg,kilo,kilos,kilogramme,kilogrammes', 'masse', 1000),
  U('mg', 'mg', 'mg', 'mg,milligramme,milligrammes', 'masse', 0.001),
  U('l', 'l', 'l', 'l,litre,litres', 'volume', 1000),
  U('dl', 'dl', 'dl', 'dl,decilitre,decilitres', 'volume', 100),
  U('cl', 'cl', 'cl', 'cl,centilitre,centilitres', 'volume', 10),
  U('ml', 'ml', 'ml', 'ml,millilitre,millilitres', 'volume', 1),
  // « cuillère » seule est ambiguë : en cuisine française elle vaut la cuillère
  // à soupe neuf fois sur dix. Le texte d'origine reste affiché à côté.
  U('cs', 'c. à soupe', 'c. à soupe', 'cuillere a soupe,cuilleres a soupe,cuiller a soupe,cuillers a soupe,cuil a soupe,c a s,cas,cs,cuillere,cuilleres,cuillere a soupe rase,cuillere a soupe bombee'),
  U('cc', 'c. à café', 'c. à café', 'cuillere a cafe,cuilleres a cafe,cuiller a cafe,cuil a cafe,c a c,cac,cc,cuillere a the,cuilleres a the'),
  U('pincee', 'pincée', 'pincées', 'pincee,pincees'),
  U('poignee', 'poignée', 'poignées', 'poignee,poignees'),
  U('verre', 'verre', 'verres', 'verre,verres'),
  U('tasse', 'tasse', 'tasses', 'tasse,tasses'),
  U('louche', 'louche', 'louches', 'louche,louches'),
  U('goutte', 'goutte', 'gouttes', 'goutte,gouttes'),
  U('trait', 'trait', 'traits', 'trait,traits'),
  U('botte', 'botte', 'bottes', 'botte,bottes'),
  U('bouquet', 'bouquet', 'bouquets', 'bouquet,bouquets'),
  U('brin', 'brin', 'brins', 'brin,brins'),
  U('branche', 'branche', 'branches', 'branche,branches'),
  U('feuille', 'feuille', 'feuilles', 'feuille,feuilles'),
  U('gousse', 'gousse', 'gousses', 'gousse,gousses'),
  U('sachet', 'sachet', 'sachets', 'sachet,sachets'),
  U('boite', 'boîte', 'boîtes', 'boite,boites'),
  U('bocal', 'bocal', 'bocaux', 'bocal,bocaux'),
  U('barquette', 'barquette', 'barquettes', 'barquette,barquettes'),
  U('paquet', 'paquet', 'paquets', 'paquet,paquets'),
  U('pot', 'pot', 'pots', 'pot,pots'),
  U('tablette', 'tablette', 'tablettes', 'tablette,tablettes'),
  U('tranche', 'tranche', 'tranches', 'tranche,tranches'),
  U('rondelle', 'rondelle', 'rondelles', 'rondelle,rondelles'),
  U('morceau', 'morceau', 'morceaux', 'morceau,morceaux'),
  U('part', 'part', 'parts', 'part,parts,portion,portions'),
  U('filet', 'filet', 'filets', 'filet,filets'),
  U('pave', 'pavé', 'pavés', 'pave,paves'),
  U('noix', 'noix', 'noix', 'noix de'),
  U('piece', 'pièce', 'pièces', 'piece,pieces'),
];

export const UNIT_BY_KEY: Map<string, UnitDef> = new Map(UNITS.map((u) => [u.key, u]));

/** Index des formes écrites vers la clé d'unité, la plus longue gagnant. */
const UNIT_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const u of UNITS) for (const f of u.forms) if (!m.has(f)) m.set(f, u.key);
  return m;
})();
const UNIT_MAX_WORDS = Math.max(...[...UNIT_INDEX.keys()].map((f) => f.split(' ').length));

/**
 * Mots de portion : ils décrivent la découpe, pas le produit. « 400 g de filets
 * de poulet » se range au poulet ; sans cela il ne se range nulle part.
 */
const PORTIONS = new Set(['filet', 'filets', 'blanc', 'blancs', 'tranche', 'tranches', 'morceau', 'morceaux',
  'pave', 'paves', 'gousse', 'gousses', 'botte', 'bottes', 'brin', 'brins', 'branche', 'branches',
  'feuille', 'feuilles', 'boite', 'boites', 'barquette', 'barquettes', 'paquet', 'paquets', 'sachet', 'sachets',
  'pot', 'pots', 'piece', 'pieces', 'poignee', 'poignees', 'pincee', 'pincees', 'verre', 'verres',
  'grappe', 'grappes', 'tete', 'tetes', 'part', 'parts', 'cuisse', 'cuisses', 'escalope', 'escalopes']);

const CONNECT = /^(de|du|des|d'|a|au|aux|en|pour|le|la|les)$/;

/** Nombres écrits en toutes lettres, tels qu'une recette les emploie. */
const MOTS_NOMBRES: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, quinze: 15, vingt: 20, demi: 0.5, demie: 0.5,
};

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };

/**
 * Préparations : elles qualifient l'ingrédient sans changer ce qu'on achète.
 * Retirées du nom, gardées en note, parce que « battus en neige » compte pour
 * qui cuisine mais pas pour qui pousse le caddie.
 */
const PREPARATIONS = /(?<!\p{L})(?:en\s+(?:poudre|des|dés|morceaux|neige|conserve|tranches|lamelles|rondelles|purée|puree|julienne|cubes?)|rapes?|râpés?|râpées?|rapees?|fondus?|fondues?|émincés?|eminces?|émincées?|hachés?|haches?|hachées?|battus?|battues?|coupés?|coupes?|coupées?|pelés?|peles?|pelées?|égouttés?|egouttes?|égouttées?|mûrs?|murs?|mûres?|grillés?|grilles?|grillées?|salés?|sales?|salées?|surgelés?|surgeles?|surgelées?|frais|fraîches?|fraiches?|tièdes?|tiedes?|mous|molles?|tendres?|dénoyautés?|denoyautes?|décongelés?|decongeles?|préchauffés?|prechauffes?)(?!\p{L})/giu;

/** Queues de phrase qui commentent la quantité plutôt que le produit. */
const COMMENTAIRES = /\s*[,(]?\s*\b(?:ou\s+plus|suivant|selon|si\s+possible|de\s+préférence|de\s+preference|facultatif|au\s+choix|au\s+goût|au\s+gout|type|idéalement|idealement|à\s+défaut|a\s+defaut|voire|bien)\b.*$/i;

/**
 * Quantités vagues : elles ne se chiffrent pas, mais elles ne doivent pas rester
 * collées au produit, sans quoi « un peu de sel » ne se range nulle part.
 */
const VAGUE = /^(?:un\s+peu\s+d[eu']|quelques|beaucoup\s+d[eu']|un\s+soupçon\s+d[eu']|un\s+soupcon\s+d[eu']|une\s+bonne\s+|un\s+bon\s+)\s*/i;
/** « 200 g de farine environ » : le mot commente la quantité, en fin de ligne. */
const ENVIRON_FIN = /\s+(?:environ|ou\s+un\s+peu\s+plus)\s*$/i;

export type IngStatus = 'article' | 'inconnu' | 'illisible';

export interface ParsedIng {
  /** La ligne telle qu'elle est écrite dans la recette. Jamais modifiée. */
  raw: string;
  qty?: number;
  unit?: string;
  /** Le produit isolé, tel qu'il sera affiché s'il n'y a pas d'article connu. */
  name: string;
  /** Ce qui a été mis de côté : parenthèses, préparation, commentaire. */
  note?: string;
  /** Clé d'article du référentiel, quand la ligne a été reconnue. */
  art?: string;
  status: IngStatus;
}

/** Article résolu, qu'il vienne du foyer ou de la base intégrée. */
export interface ResolvedArticle { key: string; name: string; rayon: Rayon; pantry: boolean; allerg: Allergene[]; }

export interface ArticleIndex {
  /** Forme écrite normalisée vers clé d'article. */
  forms: Map<string, string>;
  byKey: Map<string, ResolvedArticle>;
}

const fromBase = (a: BaseArticle): ResolvedArticle =>
  ({ key: a.key, name: a.name, rayon: a.rayon, pantry: !!a.pantry, allerg: a.allerg || [] });

/**
 * Construit l'index de résolution. Les articles du foyer passent en dernier et
 * écrasent la base : une correction faite à la main gagne toujours contre une
 * mise à jour de l'application.
 */
export function buildArticleIndex(household: Article[] = []): ArticleIndex {
  const forms = new Map(BASE_INDEX);
  const byKey = new Map<string, ResolvedArticle>();
  for (const [k, a] of BASE_BY_KEY) byKey.set(k, fromBase(a));
  for (const a of household) {
    byKey.set(a.key, { key: a.key, name: a.name, rayon: a.rayon, pantry: !!a.pantry, allerg: (a.allerg || []) as Allergene[] });
    for (const form of [a.name, ...(a.syn || [])]) {
      const n = normaliseName(form);
      if (n) forms.set(n, a.key);
    }
  }
  return { forms, byKey };
}

/** Évalue « 2 », « 0,5 », « 1/2 » ou « ½ ». */
const valeur = (t: string): number => {
  if (FRACTIONS[t] !== undefined) return FRACTIONS[t];
  if (t.includes('/')) { const [a, b] = t.split('/').map((x) => parseFloat(x.replace(',', '.'))); return b ? a / b : NaN; }
  return parseFloat(t.replace(',', '.'));
};

const NUM = String.raw`\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔⅛]`;
const QTY_RE = new RegExp(String.raw`^\s*(?:environ\s+)?(${NUM})(?:\s*(?:à|a|-|ou)\s*(${NUM}))?\s*`, 'i');

/** Normalise un mot pour la comparaison : minuscules, sans accent ni ponctuation. */
const nw = (w: string): string => normaliseName(w);

/**
 * Lit une ligne d'ingrédient. Rend une entrée par produit : « herbes de
 * Provence + sel » en donne deux, chacune portant la ligne d'origine entière.
 */
export function parseIngredient(raw: string, idx: ArticleIndex): ParsedIng[] {
  const base = String(raw ?? '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  if (!base) return [];
  // « + » sépare deux produits d'une même ligne ; le reste de la ponctuation ne
  // sépare rien de fiable (« sel, poivre » est souvent un seul geste).
  const parts = base.split(/\s*\+\s*/).filter((p) => p.trim());
  return (parts.length > 1 ? parts : [base]).map((p) => parseOne(p, base, idx));
}

function parseOne(part: string, raw: string, idx: ArticleIndex): ParsedIng {
  const notes: string[] = [];
  let s = part;

  // 1. Parenthèses : toujours du commentaire, jamais le produit.
  s = s.replace(/\s*[([]([^)\]]*)[)\]]\s*/g, (_m, inner: string) => { if (inner.trim()) notes.push(inner.trim()); return ' '; });
  // 2. Points de suspension et ponctuation de fin, qui viennent des sites.
  s = s.replace(/(?:\.{2,}|…)\s*$/, '').replace(/[,;.]\s*$/, '').trim();
  // 3. Commentaire de fin (« suivant les goûts », « si possible maison »).
  s = s.replace(COMMENTAIRES, (m) => { notes.push(m.replace(/^[\s,(]+/, '').trim()); return ''; }).trim();
  s = s.replace(ENVIRON_FIN, () => { notes.push('environ'); return ''; }).trim();
  s = s.replace(VAGUE, (m) => { notes.push(m.trim()); return ''; }).trim();

  // 4. Quantité, éventuellement une fourchette : on retient le haut, parce
  //    qu'il vaut mieux qu'il reste un oignon que d'en manquer un.
  let qty: number | undefined;
  const mq = QTY_RE.exec(s);
  if (mq) {
    const a = valeur(mq[1]);
    const b = mq[2] ? valeur(mq[2]) : NaN;
    qty = Number.isFinite(b) ? Math.max(a, b) : a;
    if (!Number.isFinite(qty)) qty = undefined;
    s = s.slice(mq[0].length);
  }
  let words = s.split(' ').filter(Boolean);
  if (qty === undefined && words.length && MOTS_NOMBRES[nw(words[0])] !== undefined) {
    // « une pincée de sel » : le déterminant vaut un, mais « un peu » n'est pas
    // une quantité.
    if (nw(words[1] || '') !== 'peu') { qty = MOTS_NOMBRES[nw(words[0])]; words = words.slice(1); }
  }

  // 5. Unité, la forme la plus longue d'abord (« cuillère à soupe » avant
  //    « cuillère »).
  let unit: string | undefined;
  for (let n = Math.min(UNIT_MAX_WORDS, words.length); n >= 1 && !unit; n--) {
    const key = UNIT_INDEX.get(words.slice(0, n).map(nw).join(' '));
    if (key) { unit = key; words = words.slice(n); }
  }

  // 6. Connecteur : « de », « d' », « du », « de la »…
  words = dropConnectors(words);

  // 7. « ou dinde », « ou un yaourt au soja » : une variante, pas le produit.
  let name = words.join(' ').trim();
  const mo = /\s+ou\s+(.{1,40})$/i.exec(name);
  if (mo) { notes.push('ou ' + mo[1].trim()); name = name.slice(0, mo.index).trim(); }

  // 8. La préparation qualifie l'ingrédient, pas l'achat. Elle n'est retirée
  //    qu'en second recours : « crème fraîche » et « gingembre frais » sont des
  //    articles à part entière, que ce retrait détruirait.
  let art = resolve(name, idx);
  if (!art) {
    const court = clean(name.replace(PREPARATIONS, (m) => { notes.push(m.trim()); return ' '; }));
    if (court) {
      const trouve = resolve(court, idx);
      if (trouve) { art = trouve; name = court; } else name = court || name;
    }
  }
  name = clean(name);
  return {
    raw,
    ...(qty !== undefined ? { qty } : {}),
    ...(unit ? { unit } : {}),
    name,
    ...(notes.length ? { note: notes.join(', ') } : {}),
    ...(art ? { art } : {}),
    status: art ? 'article' : name ? 'inconnu' : 'illisible',
  };
}

const clean = (s: string): string =>
  dropConnectors(s.replace(/\s+/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '').split(' ').filter(Boolean)).join(' ');

const dropConnectors = (words: string[]): string[] => {
  let w = words;
  for (;;) {
    if (!w.length) return w;
    // « d'huile » : le connecteur est élidé et collé au mot. Le retirer en
    // entier faisait disparaître l'ingrédient, et la ligne devenait illisible.
    const elide = /^([dl])'(.+)$/i.exec(w[0]);
    if (elide) { w = [elide[2], ...w.slice(1)]; continue; }
    if (CONNECT.test(nw(w[0]))) { w = w.slice(1); continue; }
    return w;
  }
};

/**
 * Cherche l'article correspondant à un nom de produit.
 *
 * En cas d'échec, le nom est raccourci par la droite, mais **jamais au travers
 * d'une préposition** : « beurre fondu » devient « beurre », tandis que « lait
 * de coco » ne devient pas « lait ». Sans cette règle, une recette sans lait se
 * retrouverait à en contenir, allergènes compris.
 */
function resolve(name: string, idx: ArticleIndex): string | undefined {
  let toks = normaliseName(name).split(' ').filter(Boolean);
  if (!toks.length) return undefined;
  for (const essai of [toks, stripPortion(toks)]) {
    let t = essai;
    while (t.length) {
      const hit = idx.forms.get(t.join(' '));
      if (hit) return hit;
      if (t.length < 2 || CONNECT.test(t[t.length - 2])) break;
      t = t.slice(0, -1);
    }
  }
  return undefined;
}

/** « filets de poulet » -> « poulet », quand le mot de tête est une découpe. */
function stripPortion(toks: string[]): string[] {
  if (toks.length >= 3 && PORTIONS.has(toks[0]) && CONNECT.test(toks[1])) return toks.slice(2);
  if (toks.length >= 2 && PORTIONS.has(toks[0]) && /^d'/.test(toks[1])) return [toks[1].slice(2), ...toks.slice(2)];
  return toks;
}

/** Toutes les lignes d'une recette, à plat. */
export const parseIngredients = (lines: string[], idx: ArticleIndex): ParsedIng[] =>
  lines.flatMap((l) => parseIngredient(l, idx));
