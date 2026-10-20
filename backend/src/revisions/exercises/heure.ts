// Exercice « Lire l'heure » : une horloge à aiguilles, l'enfant écrit l'heure
// au pavé (7, 4, 5 pour « 7 h 45 »). Le programme règle la précision : les
// heures pleines, puis les demies, les quarts, toutes les cinq minutes.
//
// Un item est une position des aiguilles (« heure:7:45 ») : sur un cadran, 7 h 45
// et 19 h 45 sont la même, les deux réponses sont justes. Les heures vont de 1
// à 12, comme sur le cadran ; 0 h 15 vaut 12 h 15.
import { Checked, ExerciseDef, Params } from './contract';

export interface HeureQuestion { h: number; m: number; }

const STEPS = { heure: [0], demi: [0, 30], quart: [0, 15, 30, 45], cinq: Array.from({ length: 12 }, (_, i) => i * 5) } as const;
type Precision = keyof typeof STEPS;
const precisionOf = (p: Params): Precision => (typeof p['precision'] === 'string' && p['precision'] in STEPS ? p['precision'] as Precision : 'demi');
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const pad = (m: number): string => String(m).padStart(2, '0');
const keyOf = (h: number, m: number): string => `heure:${h}:${pad(m)}`;
const parseKey = (key: string): HeureQuestion | null => {
  const r = /^heure:(\d{1,2}):(\d\d)$/.exec(key);
  return r ? { h: Number(r[1]), m: Number(r[2]) } : null;
};
const label = (q: HeureQuestion): string => (q.m ? `${q.h} h ${pad(q.m)}` : `${q.h} h`);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * Les chiffres tapés, lus comme sur un réveil : les deux derniers sont les
 * minutes dès qu'il y en a trois (« 745 », « 1205 ») ; un ou deux chiffres
 * sont l'heure seule (« 7 », « 15 »), sauf deux chiffres qui ne font pas une
 * heure (« 74 » : 7 h 4). La même lecture sert à l'affichage et à la correction.
 */
function readTyped(typed: string): HeureQuestion | null {
  const d = typed.replace(/\D/g, '');
  if (!d || d.length > 4) return null;
  if (d.length === 1 || (d.length === 2 && Number(d) <= 23)) return { h: Number(d), m: 0 };
  if (d.length === 2) return { h: Number(d[0]), m: Number(d[1]) };
  return { h: Number(d.slice(0, -2)), m: Number(d.slice(-2)) };
}
const GROUPS: Record<string, string> = { '0': 'Heures pleines', '30': 'Demies', '15': 'Quarts', '45': 'Quarts' };

export const HEURE: ExerciseDef<HeureQuestion> = {
  id: 'heure',
  label: 'Lire l’heure',
  matiere: 'maths',
  icon: 'clock',
  ageMin: 6,
  desc: 'Une horloge à aiguilles : l’enfant écrit l’heure qu’elle montre. On commence par les heures pleines, puis les demies, les quarts et les cinq minutes. 7 h 45 et 19 h 45 sont toutes deux justes.',
  input: 'pave',
  prompt: 'horloge',
  view: 'grille',
  params: [
    { key: 'precision', type: 'enum', label: 'Précision', default: 'demi', options: [
      { value: 'heure', label: 'Heures pleines' }, { value: 'demi', label: 'Et demies' },
      { value: 'quart', label: 'Et quarts' }, { value: 'cinq', label: 'Cinq minutes' },
    ] },
  ],

  /** Chaque heure du cadran, à chaque minute que permet la précision. */
  universe(p) {
    return HOURS.flatMap((h) => STEPS[precisionOf(p)].map((m) => keyOf(h, m)));
  },
  question: (key) => parseKey(key) ?? { h: 12, m: 0 },
  parse(raw) {
    const o = (raw ?? {}) as Record<string, unknown>;
    return isInt(o['h'], 1, 12) && isInt(o['m'], 0, 55) && o['m'] % 5 === 0 ? { h: o['h'], m: o['m'] } : null;
  },
  itemKey: (q) => keyOf(q.h, q.m),
  itemLabel(key) { const q = parseKey(key); return q ? label(q) : key; },
  text: label,
  ask: () => ({ before: 'Il est', after: '' }),
  groups(key) { const q = parseKey(key); return q ? [GROUPS[String(q.m)] ?? 'Cinq minutes'] : []; },

  /** L'heure du cadran, ou la même douze heures plus tard (19 h 45 pour 7 h 45). */
  check(q, given): Checked {
    const t = readTyped(given);
    return { ok: !!t && t.h <= 23 && t.m === q.m && t.h % 12 === q.h % 12, expected: label(q) };
  },

  /** Le tour du cadran à la précision du programme : à 4 heures pour les minutes, ou les douze heures pleines. */
  learn(p) {
    const pr = precisionOf(p);
    return pr === 'heure' ? HOURS.map((h) => ({ h, m: 0 })) : STEPS[pr].map((m) => ({ h: 4, m }));
  },
  spoken: (q) => `${q.h} heure${q.h > 1 ? 's' : ''}${q.m ? ' ' + q.m : ''}`,
  clock: (q) => q,
  display(typed) {
    const t = readTyped(typed);
    if (!t) return typed;
    const d = typed.replace(/\D/g, '');
    return d.length <= 2 && t.m === 0 ? `${t.h} h` : `${t.h} h ${d.length === 2 ? t.m : pad(t.m)}`;
  },

  grid(p) {
    const steps = STEPS[precisionOf(p)];
    return { rows: HOURS.map((h) => `${h} h`), cols: steps.map(pad), corner: 'h', keyAt: (r, c) => keyOf(HOURS[r], steps[c]) };
  },

  summary(p) {
    return { heure: 'L’heure pleine', demi: 'L’heure, à la demi-heure près', quart: 'L’heure, au quart d’heure près', cinq: 'L’heure, à cinq minutes près' }[precisionOf(p)];
  },
};
