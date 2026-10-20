// Exercice « Nombres en lettres » : « soixante-dix-sept », l'enfant tape 77 au
// pavé. Le programme règle la plage (jusqu'à 19, à 69, à 99) et l'orthographe
// des nombres : rectifiée (des traits d'union partout, « vingt-et-un »), celle
// des programmes depuis 2016, ou traditionnelle (« vingt et un »).
//
// Un item est un nombre (« let:77 ») : le même d'une plage à l'autre, et quelle
// que soit l'orthographe affichée. L'écriture en lettres est une règle de la
// numération, pas une liste : elle est calculée ici, de 0 à 99.
import { Checked, ExerciseDef, NO_CONTEXT, Params } from './contract';

export interface LettresQuestion { n: number; trad: boolean; }

const PLAGES = { vingt: 19, soixante: 69, cent: 99 } as const;
type Plage = keyof typeof PLAGES;
const plageOf = (p: Params): Plage => (typeof p['jusqua'] === 'string' && p['jusqua'] in PLAGES ? p['jusqua'] as Plage : 'soixante');
const tradOf = (p: Params): boolean => p['orthographe'] === 'traditionnelle';
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

/** Un nombre de 0 à 99 en lettres : rectifiée (traits d'union partout) ou traditionnelle. */
export function inWords(n: number, trad = false): string {
  const et = trad ? ' et ' : '-et-';
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 70) { const t = TENS[Math.floor(n / 10)], u = n % 10; return u === 0 ? t : u === 1 ? t + et + 'un' : `${t}-${UNITS[u]}`; }
  if (n < 80) return n === 71 ? 'soixante' + et + 'onze' : `soixante-${inWords(n - 60, trad)}`;
  return n === 80 ? 'quatre-vingts' : `quatre-vingt-${inWords(n - 80, trad)}`;
}
const keyOf = (n: number): string => `let:${n}`;
const parseKey = (key: string): number | null => { const m = /^let:(\d{1,2})$/.exec(key); return m ? Number(m[1]) : null; };
const GROUPS = (n: number): string => (n <= 16 ? 'De zéro à seize' : n % 10 === 0 ? 'Les dizaines' : n < 70 ? 'De 17 à 69' : 'De 70 à 99');

export const LETTRES: ExerciseDef<LettresQuestion> = {
  id: 'lettres',
  label: 'Nombres en lettres',
  matiere: 'maths',
  icon: 'edit',
  ageMin: 6,
  desc: 'Un nombre écrit en lettres (« soixante-dix-sept ») : l’enfant le tape en chiffres. Jusqu’à 19, 69 ou 99, en orthographe rectifiée (« vingt-et-un ») ou traditionnelle (« vingt et un »).',
  input: 'pave',
  prompt: 'texte',
  view: 'grille',
  params: [
    { key: 'jusqua', type: 'enum', label: 'Nombres', default: 'soixante', options: [
      { value: 'vingt', label: 'De 0 à 19' }, { value: 'soixante', label: 'De 0 à 69' }, { value: 'cent', label: 'De 0 à 99' },
    ] },
    { key: 'orthographe', type: 'enum', label: 'Orthographe', desc: 'Rectifiée : celle des programmes de l’école depuis 2016.', default: 'rectifiee', options: [
      { value: 'rectifiee', label: 'Rectifiée (vingt-et-un)' }, { value: 'traditionnelle', label: 'Traditionnelle (vingt et un)' },
    ] },
  ],

  universe(p) { return Array.from({ length: PLAGES[plageOf(p)] + 1 }, (_, n) => keyOf(n)); },
  question: (key, p) => ({ n: parseKey(key) ?? 0, trad: tradOf(p) }),
  parse(raw, p) {
    const o = (raw ?? {}) as Record<string, unknown>;
    return typeof o['n'] === 'number' && Number.isInteger(o['n']) && o['n'] >= 0 && o['n'] <= 99 ? { n: o['n'], trad: tradOf(p) } : null;
  },
  itemKey: (q) => keyOf(q.n),
  itemLabel(key) { const n = parseKey(key); return n === null ? key : `${inWords(n)} (${n})`; },
  text: (q) => inWords(q.n, q.trad),
  groups(key) { const n = parseKey(key); return n === null ? [] : [GROUPS(n)]; },

  check(q, given): Checked {
    const expected = String(q.n);
    return { ok: given.trim().replace(/^0+(?=\d)/, '') === expected, expected };
  },

  /** Dans l'ordre, de zéro à la fin de la plage : la voix lit chaque nombre. */
  learn(p) { return LETTRES.universe(p, NO_CONTEXT).map((k) => LETTRES.question(k, p, () => 0)); },
  spoken: (q) => inWords(q.n, q.trad),

  /** Une ligne par dizaine, une colonne par unité : la case « 70 », « 7 » est soixante-dix-sept. */
  grid(p) {
    const rows = Math.floor(PLAGES[plageOf(p)] / 10) + 1;
    return { rows: Array.from({ length: rows }, (_, r) => String(r * 10)), cols: Array.from({ length: 10 }, (_, c) => String(c)), corner: '+', keyAt: (r, c) => keyOf(r * 10 + c) };
  },

  summary(p) { return `Les nombres en lettres de 0 à ${PLAGES[plageOf(p)]}${tradOf(p) ? ', orthographe traditionnelle' : ''}`; },
};
