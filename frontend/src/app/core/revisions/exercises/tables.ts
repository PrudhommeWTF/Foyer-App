// Exercice « Tables » : les tables de multiplication et d'addition, de 0 à la
// dernière table choisie (10 en primaire, 12 si l'école le demande).
//
// Un item est un couple commutatif : 6 × 7 et 7 × 6 sont le même item
// (« mult:6x7 »), la question, elle, peut se poser dans les deux sens. Le
// socle se charge du reste : priorité aux items dus, espacement, maîtrise.
import { Checked, ExerciseDef, Params } from './contract';

export interface TablesQuestion { op: 'mult' | 'add'; a: number; b: number; }

const OPS = { mult: { sign: '×', word: 'fois' }, add: { sign: '+', word: 'plus' } } as const;
const opOf = (p: Params): 'mult' | 'add' => (p['operation'] === 'add' ? 'add' : 'mult');
const rangeOf = (p: Params): [number, number] => (Array.isArray(p['tables']) ? p['tables'] : [2, 5]);
const maxOf = (p: Params): number => (typeof p['max'] === 'number' ? p['max'] : 10);
const result = (q: TablesQuestion): number => (q.op === 'mult' ? q.a * q.b : q.a + q.b);
const keyOf = (op: string, a: number, b: number): string => `${op}:${Math.min(a, b)}x${Math.max(a, b)}`;
const parseKey = (key: string): TablesQuestion | null => {
  const m = /^(mult|add):(\d+)x(\d+)$/.exec(key);
  return m ? { op: m[1] as 'mult' | 'add', a: Number(m[2]), b: Number(m[3]) } : null;
};
const isInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const TABLES: ExerciseDef<TablesQuestion> = {
  id: 'tables',
  label: 'Tables',
  matiere: 'maths',
  icon: 'grille',
  ageMin: 6,
  desc: 'Les tables de multiplication et d’addition, de 0 à la dernière table choisie. 6 × 7 et 7 × 6 comptent pour la même opération.',
  input: 'pave',
  prompt: 'texte',
  view: 'grille',
  params: [
    { key: 'operation', type: 'enum', label: 'Opération', default: 'mult', options: [{ value: 'mult', label: 'Multiplication' }, { value: 'add', label: 'Addition' }] },
    { key: 'max', type: 'int', label: 'Dernière table proposée', desc: '10 en primaire, 12 si l’école le demande.', default: 10, min: 10, max: 12 },
    { key: 'tables', type: 'range', label: 'Tables travaillées', default: [2, 5], min: 0, max: 12, maxFrom: 'max' },
    { key: 'bothDirections', type: 'bool', label: 'Poser dans les deux sens (6 × 7 et 7 × 6)', default: true },
  ],

  /** Chaque table de la plage, par chaque nombre de 0 à la dernière table, sans doublon commutatif. */
  universe(p) {
    const op = opOf(p), [from, to] = rangeOf(p), max = maxOf(p);
    const keys = new Set<string>();
    for (const t of range(from, to)) for (const n of range(0, max)) keys.add(keyOf(op, t, n));
    return [...keys];
  },

  /** Le facteur de la plage d'abord (« la table de 7 » pose 7 × 3), ou l'un ou l'autre au hasard dans les deux sens. */
  question(key, p, rand) {
    const q = parseKey(key) ?? { op: opOf(p), a: 0, b: 0 };
    const [from, to] = rangeOf(p);
    const inRange = (n: number) => n >= from && n <= to;
    if (p['bothDirections'] !== false) return rand() < 0.5 ? q : { ...q, a: q.b, b: q.a };
    return inRange(q.a) ? q : { ...q, a: q.b, b: q.a };
  },

  parse(raw, p) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const max = Math.max(maxOf(p), 12);
    if ((o['op'] !== 'mult' && o['op'] !== 'add') || !isInt(o['a'], max) || !isInt(o['b'], max)) return null;
    return { op: o['op'], a: o['a'], b: o['b'] };
  },

  itemKey: (q) => keyOf(q.op, q.a, q.b),
  itemLabel(key) { const q = parseKey(key); return q ? `${q.a} ${OPS[q.op].sign} ${q.b}` : key; },
  text: (q) => `${q.a} ${OPS[q.op].sign} ${q.b}`,
  groups(key, p) {
    const q = parseKey(key); if (!q) return [];
    const [from, to] = rangeOf(p);
    return [...new Set([q.a, q.b])].filter((t) => t >= from && t <= to).map((t) => `Table de ${t}`);
  },

  check(q, given): Checked {
    const expected = String(result(q));
    return { ok: given.trim().replace(/^0+(?=\d)/, '') === expected, expected };
  },

  /** La table de la première borne, ligne après ligne : 7 × 1 à 7 × dernière table. */
  learn(p) {
    const op = opOf(p), [from] = rangeOf(p);
    return range(1, maxOf(p)).map((b) => ({ op, a: from, b }));
  },
  spoken: (q) => `${q.a} ${OPS[q.op].word} ${q.b}, ${result(q)}`,

  grid(p) {
    const op = opOf(p), axis = range(0, maxOf(p)).map(String);
    return { rows: axis, cols: axis, corner: OPS[op].sign, keyAt: (r, c) => keyOf(op, r, c) };
  },

  summary(p) {
    const [from, to] = rangeOf(p);
    return `${from === to ? `La table de ${from}` : `Les tables de ${from} à ${to}`}, ${opOf(p) === 'mult' ? 'multiplication' : 'addition'}`;
  },
};
