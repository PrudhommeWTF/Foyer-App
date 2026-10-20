// Exercice « Doubles et moitiés » : le double de 7, la moitié de 14. Le calcul
// mental du cycle 2, qui sert ensuite aux tables de 2, 4 et 5, et au partage.
//
// Un item est un double (« dbl:7 ») ou une moitié (« moit:14 ») : le double de
// 30 est le même item qu'on travaille les dizaines seules ou tous les nombres
// jusqu'à 100, et le double de 7 ne dit rien de la moitié de 14 (chacun son item).
import { Checked, ExerciseDef, NO_CONTEXT, Params } from './contract';

export interface DoubleQuestion { op: 'dbl' | 'moit'; n: number; }

/** Jusqu'où : les doubles de `from` à `to` au pas `pas`, et les moitiés de leurs résultats. */
const PLAGES = { dix: { to: 10, pas: 1 }, vingt: { to: 20, pas: 1 }, dizaines: { to: 50, pas: 10 }, cent: { to: 50, pas: 1 } } as const;
type Plage = keyof typeof PLAGES;
const OPS = { doubles: ['dbl'], moities: ['moit'], deux: ['dbl', 'moit'] } as const;
type Ops = keyof typeof OPS;
const plageOf = (p: Params): Plage => (typeof p['jusqua'] === 'string' && p['jusqua'] in PLAGES ? p['jusqua'] as Plage : 'dix');
const opsOf = (p: Params): Ops => (typeof p['operation'] === 'string' && p['operation'] in OPS ? p['operation'] as Ops : 'doubles');
const keyOf = (q: DoubleQuestion): string => `${q.op}:${q.n}`;
/** Un double de 1 à 50, une moitié d'un nombre pair de 2 à 100. */
const valid = (op: unknown, n: unknown): op is DoubleQuestion['op'] =>
  typeof n === 'number' && Number.isInteger(n) && (op === 'dbl' ? n >= 1 && n <= 50 : op === 'moit' && n >= 2 && n <= 100 && n % 2 === 0);
const parseKey = (key: string): DoubleQuestion | null => {
  const m = /^(dbl|moit):(\d{1,3})$/.exec(key);
  return m && valid(m[1], Number(m[2])) ? { op: m[1] as DoubleQuestion['op'], n: Number(m[2]) } : null;
};
const label = (q: DoubleQuestion): string => `${q.op === 'dbl' ? 'Double' : 'Moitié'} de ${q.n}`;
const answer = (q: DoubleQuestion): number => (q.op === 'dbl' ? q.n * 2 : q.n / 2);

export const DOUBLES: ExerciseDef<DoubleQuestion> = {
  id: 'doubles',
  label: 'Doubles et moitiés',
  matiere: 'maths',
  icon: 'copy',
  ageMin: 6,
  desc: 'Le double de 7, la moitié de 14 : jusqu’à 10, à 20, les dizaines (« double de 30 ») ou jusqu’à 50. Le calcul mental qui prépare les tables de 2, 4 et 5, et le partage.',
  input: 'pave',
  prompt: 'texte',
  view: 'liste',
  params: [
    { key: 'operation', type: 'enum', label: 'Travailler', default: 'doubles', options: [
      { value: 'doubles', label: 'Les doubles' }, { value: 'moities', label: 'Les moitiés' }, { value: 'deux', label: 'Les deux' },
    ] },
    { key: 'jusqua', type: 'enum', label: 'Nombres', desc: 'Les doubles de ces nombres, et les moitiés de leurs résultats.', default: 'dix', options: [
      { value: 'dix', label: 'De 1 à 10' }, { value: 'vingt', label: 'De 1 à 20' },
      { value: 'dizaines', label: 'Les dizaines, de 10 à 50' }, { value: 'cent', label: 'De 1 à 50' },
    ] },
  ],

  /** Les doubles de la plage, puis les moitiés de leurs résultats. */
  universe(p) {
    const { to, pas } = PLAGES[plageOf(p)];
    const ns = Array.from({ length: to / pas }, (_, i) => (i + 1) * pas);
    return OPS[opsOf(p)].flatMap((op) => ns.map((n) => keyOf({ op, n: op === 'dbl' ? n : n * 2 })));
  },
  question: (key) => parseKey(key) ?? { op: 'dbl', n: 1 },
  parse(raw) {
    const o = (raw ?? {}) as Record<string, unknown>;
    return valid(o['op'], o['n']) ? { op: o['op'], n: o['n'] as number } : null;
  },
  itemKey: keyOf,
  itemLabel(key) { const q = parseKey(key); return q ? label(q).toLowerCase() : key; },
  text: label,
  /** « Le double de 7 = » : assez long pour la taille sobre de l'énoncé, qui tient sur une ligne au téléphone. */
  ask: (q) => ({ before: `${q.op === 'dbl' ? 'Le double' : 'La moitié'} de ${q.n} =`, after: '' }),
  groups(key) { const q = parseKey(key); return q ? [q.op === 'dbl' ? 'Doubles' : 'Moitiés'] : []; },

  check(q, given): Checked {
    const expected = String(answer(q));
    return { ok: given.trim().replace(/^0+(?=\d)/, '') === expected, expected };
  },

  /** Dans l'ordre : double de 1, double de 2… puis les moitiés. */
  learn(p) {
    return DOUBLES.universe(p, NO_CONTEXT).map((k) => parseKey(k)!);
  },
  spoken: (q) => `${q.op === 'dbl' ? 'le double' : 'la moitié'} de ${q.n}, ${answer(q)}`,

  summary(p) {
    const what = { doubles: 'Les doubles', moities: 'Les moitiés', deux: 'Les doubles et les moitiés' }[opsOf(p)];
    const de = { dix: 'de 1 à 10', vingt: 'de 1 à 20', dizaines: 'des dizaines, de 10 à 50', cent: 'de 1 à 50' }[plageOf(p)];
    return `${what} ${de}`;
  },
};
