// Exercice « Comparer » : « 47 … 74 », l'enfant touche <, = ou >. Du CP au
// CE2, jusqu'à 20, à 100 ou à 1 000.
//
// Les paires de nombres sont trop nombreuses pour être chacune un item : un
// item est une façon de se tromper, la situation de la paire et le bon signe
// (« cmp:100:inverse:lt » : chiffres inversés, le premier plus petit, jusqu'à
// 100). Le tirage choisit une paire au hasard dans cette situation ; le serveur
// retrouve la situation d'après la paire, ce qui suffit à vérifier qu'elle
// appartient au programme. Séparer < et > repère l'enfant qui confond les
// signes ; changer de plage, c'est une nouvelle série d'items.
import { Checked, ExerciseDef, NO_CONTEXT, Params } from './contract';

export interface CompareQuestion { a: number; b: number; max: number; }

const PLAGES = { vingt: 20, cent: 100, mille: 1000 } as const;
type Plage = keyof typeof PLAGES;
const plageOf = (p: Params): Plage => (typeof p['jusqua'] === 'string' && p['jusqua'] in PLAGES ? p['jusqua'] as Plage : 'cent');
const MAXES = Object.values(PLAGES) as number[];

/** Les situations, de la plus visible à la plus piégeuse. */
const CATS = {
  taille: 'Pas le même nombre de chiffres',
  premier: 'Le premier chiffre décide',
  suivant: 'Même premier chiffre',
  inverse: 'Chiffres inversés',
  egal: 'Nombres égaux',
} as const;
type Cat = keyof typeof CATS;
/** Les situations qu'une plage permet : jusqu'à 20, pas de chiffres inversés (12 et 21). */
const catsOf = (max: number): Cat[] => (Object.keys(CATS) as Cat[]).filter((c) => c !== 'inverse' || max >= 100);
const SIGNS = { lt: '<', eq: '=', gt: '>' } as const;
type Sign = keyof typeof SIGNS;
const signsOf = (c: Cat): Sign[] => (c === 'egal' ? ['eq'] : ['lt', 'gt']);

const reverse = (s: string): string => [...s].reverse().join('');
/** La situation d'une paire. */
export function situation(a: number, b: number): Cat {
  if (a === b) return 'egal';
  const x = String(a), y = String(b);
  if (x.length !== y.length) return 'taille';
  if (x.length >= 2 && x === reverse(y)) return 'inverse';
  return x[0] !== y[0] ? 'premier' : 'suivant';
}
const signOf = (a: number, b: number): Sign => (a < b ? 'lt' : a > b ? 'gt' : 'eq');
const keyOf = (max: number, c: Cat, s: Sign): string => `cmp:${max}:${c}:${s}`;
const parseKey = (key: string): { max: number; cat: Cat; sign: Sign } | null => {
  const m = /^cmp:(\d+):(\w+):(lt|eq|gt)$/.exec(key);
  if (!m || !MAXES.includes(Number(m[1])) || !(m[2] in CATS)) return null;
  const max = Number(m[1]), cat = m[2] as Cat, sign = m[3] as Sign;
  return catsOf(max).includes(cat) && signsOf(cat).includes(sign) ? { max, cat, sign } : null;
};
/** Un exemple de chaque situation dans la plage, le plus petit d'abord : l'item se lit « 9 < 12 » au suivi. */
const EXAMPLES: Record<number, Record<Cat, [number, number]>> = {
  20: { taille: [9, 12], premier: [3, 7], suivant: [12, 17], inverse: [0, 0], egal: [8, 8] },
  100: { taille: [9, 12], premier: [38, 52], suivant: [43, 47], inverse: [47, 74], egal: [35, 35] },
  1000: { taille: [98, 120], premier: [380, 520], suivant: [345, 352], inverse: [123, 321], egal: [406, 406] },
};
const isInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

/** Une paire tirée dans la situation demandée, au bon signe. */
function draw(max: number, cat: Cat, sign: Sign, rand: () => number): CompareQuestion {
  const n = (lo = 0) => lo + Math.floor(rand() * (max - lo + 1));
  const orient = (x: number, y: number): CompareQuestion => ((x < y) === (sign === 'lt') ? { a: x, b: y, max } : { a: y, b: x, max });
  if (cat === 'egal') { const x = n(); return { a: x, b: x, max }; }
  if (cat === 'inverse') {
    for (let i = 0; i < 500; i++) {
      const x = n(10), y = Number(reverse(String(x)));
      if (y <= max && String(y).length === String(x).length && x !== y) return orient(x, y);
    }
    return orient(47, 74);
  }
  for (let i = 0; i < 2000; i++) {
    const x = n(), y = n();
    if (x !== y && situation(x, y) === cat) return orient(x, y);
  }
  return orient(...({ taille: [9, 12], premier: [3, 7], suivant: [12, 17] } as Record<string, [number, number]>)[cat]);
}
/** Le tirage du mode Apprendre : le même à chaque fois. */
const fixed = (): () => number => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

export const COMPARER: ExerciseDef<CompareQuestion> = {
  id: 'comparer',
  label: 'Comparer',
  matiere: 'maths',
  icon: 'chevronRight',
  ageMin: 6,
  desc: '« 47 … 74 » : l’enfant touche <, = ou >. Jusqu’à 20, à 100 ou à 1 000. Le suivi sépare < et >, pour repérer qui confond les signes, et les pièges comme les chiffres inversés.',
  input: 'choix',
  prompt: 'texte',
  view: 'liste',
  params: [
    { key: 'jusqua', type: 'enum', label: 'Nombres', default: 'cent', options: [
      { value: 'vingt', label: 'Jusqu’à 20' }, { value: 'cent', label: 'Jusqu’à 100' }, { value: 'mille', label: 'Jusqu’à 1 000' },
    ] },
  ],

  /** Chaque situation de la plage, avec chacun de ses signes. */
  universe(p) {
    const max = PLAGES[plageOf(p)];
    return catsOf(max).flatMap((c) => signsOf(c).map((s) => keyOf(max, c, s)));
  },
  question(key, _p, rand) {
    const k = parseKey(key) ?? { max: 100, cat: 'premier' as Cat, sign: 'lt' as Sign };
    return draw(k.max, k.cat, k.sign, rand);
  },
  parse(raw, p) {
    const o = (raw ?? {}) as Record<string, unknown>, max = PLAGES[plageOf(p)];
    return o['max'] === max && isInt(o['a'], max) && isInt(o['b'], max) ? { a: o['a'], b: o['b'], max } : null;
  },
  itemKey: (q) => keyOf(q.max, situation(q.a, q.b), signOf(q.a, q.b)),
  itemLabel(key) {
    const k = parseKey(key); if (!k) return key;
    const [x, y] = EXAMPLES[k.max][k.cat];
    return k.sign === 'gt' ? `${y} > ${x}` : `${x} ${SIGNS[k.sign]} ${y}`;
  },
  text: (q) => `${q.a} … ${q.b}`,
  ask: (q) => ({ before: String(q.a), after: String(q.b) }),
  choices: () => ['<', '=', '>'],
  groups(key) { const k = parseKey(key); return k ? [CATS[k.cat]] : []; },

  check: (q, given): Checked => {
    const expected = SIGNS[signOf(q.a, q.b)];
    return { ok: given.trim() === expected, expected };
  },

  /** Un exemple par item, toujours le même : les signes en situation. */
  learn(p) {
    const rand = fixed();
    return COMPARER.universe(p, NO_CONTEXT).map((k) => COMPARER.question(k, p, rand));
  },
  spoken: (q) => `${q.a} ${{ lt: 'est plus petit que', eq: 'est égal à', gt: 'est plus grand que' }[signOf(q.a, q.b)]} ${q.b}`,

  summary(p) { return { vingt: 'La comparaison des nombres jusqu’à 20', cent: 'La comparaison des nombres jusqu’à 100', mille: 'La comparaison des nombres jusqu’à 1 000' }[plageOf(p)]; },
};
