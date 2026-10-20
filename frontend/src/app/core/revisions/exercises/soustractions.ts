// Exercice « Soustractions » : les tables de soustraction, l'inverse des tables
// d'addition. « Enlever 7 », c'est 7 − 7, 8 − 7, … jusqu'à 17 − 7 : le résultat
// va de 0 à 10, comme une table d'addition se lit de 7 + 0 à 7 + 10.
//
// Un item est une soustraction (« sub:13-7 ») : elle n'est pas commutative,
// 13 − 7 et 13 − 6 sont deux items. Le socle fait le reste : priorité aux
// items dus, espacement, maîtrise.
import { Checked, ExerciseDef, Params } from './contract';

export interface SoustractionQuestion { a: number; b: number; }

const RESULT_MAX = 10;
const rangeOf = (p: Params): [number, number] => (Array.isArray(p['tables']) ? p['tables'] : [2, 5]);
const keyOf = (a: number, b: number): string => `sub:${a}-${b}`;
const parseKey = (key: string): SoustractionQuestion | null => {
  const m = /^sub:(\d+)-(\d+)$/.exec(key);
  return m && Number(m[1]) >= Number(m[2]) ? { a: Number(m[1]), b: Number(m[2]) } : null;
};
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const isInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

export const SOUSTRACTIONS: ExerciseDef<SoustractionQuestion> = {
  id: 'soustractions',
  label: 'Soustractions',
  matiere: 'maths',
  icon: 'minus',
  ageMin: 6,
  desc: 'Les tables de soustraction, l’inverse des tables d’addition : « enlever 7 », c’est de 7 − 7 à 17 − 7. Le résultat va de 0 à 10.',
  input: 'pave',
  prompt: 'texte',
  view: 'grille',
  params: [
    { key: 'tables', type: 'range', label: 'Nombres enlevés', desc: '« Enlever 7 » pose de 7 − 7 à 17 − 7.', default: [2, 5], min: 0, max: 10 },
  ],

  /** Pour chaque nombre enlevé de la plage, chaque résultat de 0 à 10. */
  universe(p) {
    const [from, to] = rangeOf(p);
    return range(from, to).flatMap((b) => range(0, RESULT_MAX).map((c) => keyOf(b + c, b)));
  },
  question: (key) => parseKey(key) ?? { a: 0, b: 0 },
  parse(raw) {
    const o = (raw ?? {}) as Record<string, unknown>;
    return isInt(o['a'], 20) && isInt(o['b'], 10) && o['a'] >= o['b'] && o['a'] - o['b'] <= RESULT_MAX ? { a: o['a'], b: o['b'] } : null;
  },
  itemKey: (q) => keyOf(q.a, q.b),
  itemLabel(key) { const q = parseKey(key); return q ? `${q.a} − ${q.b}` : key; },
  text: (q) => `${q.a} − ${q.b}`,
  groups(key) { const q = parseKey(key); return q ? [`Enlever ${q.b}`] : []; },

  check(q, given): Checked {
    const expected = String(q.a - q.b);
    return { ok: given.trim().replace(/^0+(?=\d)/, '') === expected, expected };
  },

  /** La table du premier nombre enlevé, ligne après ligne : de 7 − 7 à 17 − 7. */
  learn(p) {
    const [from] = rangeOf(p);
    return range(0, RESULT_MAX).map((c) => ({ a: from + c, b: from }));
  },
  spoken: (q) => `${q.a} moins ${q.b}, ${q.a - q.b}`,

  /** Une ligne par nombre enlevé, une colonne par résultat : la case « − 7 », « 3 » est 10 − 7. */
  grid() {
    const axis = range(0, RESULT_MAX);
    return { rows: axis.map((b) => `− ${b}`), cols: axis.map(String), corner: '=', keyAt: (r, c) => keyOf(r + c, r) };
  },

  summary(p) {
    const [from, to] = rangeOf(p);
    return `Les soustractions, enlever ${from === to ? from : `de ${from} à ${to}`}`;
  },
};
