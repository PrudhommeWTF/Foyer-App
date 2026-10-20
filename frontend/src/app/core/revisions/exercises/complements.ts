// Exercice « Compléments » : ce qu'il manque pour arriver à 10 (« 3 + ? = 10 »),
// puis à 20, à 100 par dizaines (« 30 + ? = 100 »), ou à 100 tout court. Le
// calcul mental qui sert à tout le reste : rendre la monnaie, poser une
// soustraction, compter les dizaines.
//
// Un item est un complément vers sa cible (« comp:10:3 ») : « 30 + ? = 100 »
// est le même item, qu'on travaille les dizaines seules ou tous les nombres.
import { Checked, ExerciseDef, NO_CONTEXT, Params } from './contract';

export interface ComplementQuestion { cible: number; n: number; }

const CIBLES = { dix: { cible: 10, pas: 1 }, vingt: { cible: 20, pas: 1 }, dizaines: { cible: 100, pas: 10 }, cent: { cible: 100, pas: 1 } } as const;
type Cible = keyof typeof CIBLES;
const cibleOf = (p: Params): Cible => (typeof p['cible'] === 'string' && p['cible'] in CIBLES ? p['cible'] as Cible : 'dix');
const keyOf = (cible: number, n: number): string => `comp:${cible}:${n}`;
const parseKey = (key: string): ComplementQuestion | null => {
  const m = /^comp:(10|20|100):(\d{1,3})$/.exec(key);
  return m && Number(m[2]) <= Number(m[1]) ? { cible: Number(m[1]), n: Number(m[2]) } : null;
};
const isInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

export const COMPLEMENTS: ExerciseDef<ComplementQuestion> = {
  id: 'complements',
  label: 'Compléments',
  matiere: 'maths',
  icon: 'plus',
  ageMin: 6,
  desc: 'Ce qu’il manque pour arriver à 10 (« 3 + ? = 10 »), puis à 20, à 100 par dizaines (« 30 + ? = 100 ») ou à 100 tout court. Le calcul mental qui sert à rendre la monnaie.',
  input: 'pave',
  prompt: 'texte',
  view: 'liste',
  params: [
    { key: 'cible', type: 'enum', label: 'Arriver à', default: 'dix', options: [
      { value: 'dix', label: '10' }, { value: 'vingt', label: '20' },
      { value: 'dizaines', label: '100, par dizaines' }, { value: 'cent', label: '100' },
    ] },
  ],

  /** Chaque nombre de départ, de 0 à la cible, au pas de la cible choisie. */
  universe(p) {
    const { cible, pas } = CIBLES[cibleOf(p)];
    return Array.from({ length: cible / pas + 1 }, (_, i) => keyOf(cible, i * pas));
  },
  question: (key) => parseKey(key) ?? { cible: 10, n: 0 },
  parse(raw) {
    const o = (raw ?? {}) as Record<string, unknown>;
    return (o['cible'] === 10 || o['cible'] === 20 || o['cible'] === 100) && isInt(o['n'], o['cible']) ? { cible: o['cible'], n: o['n'] } : null;
  },
  itemKey: (q) => keyOf(q.cible, q.n),
  itemLabel(key) { const q = parseKey(key); return q ? `${q.n} + … = ${q.cible}` : key; },
  text: (q) => `${q.n} + ? = ${q.cible}`,
  ask: (q) => ({ before: `${q.n} +`, after: `= ${q.cible}` }),
  groups(key) { const q = parseKey(key); return q ? [`Compléments à ${q.cible}`] : []; },

  check(q, given): Checked {
    const expected = String(q.cible - q.n);
    return { ok: given.trim().replace(/^0+(?=\d)/, '') === expected, expected };
  },

  /** Toutes les paires de la cible, dans l'ordre : 0 + 10, 1 + 9, … */
  learn(p) {
    return COMPLEMENTS.universe(p, NO_CONTEXT).map((k) => parseKey(k)!);
  },
  spoken: (q) => `${q.n} plus ${q.cible - q.n}, ${q.cible}`,

  summary(p) {
    return { dix: 'Les compléments à 10', vingt: 'Les compléments à 20', dizaines: 'Les compléments à 100, par dizaines', cent: 'Les compléments à 100' }[cibleOf(p)];
  },
};
