// Exercice « La monnaie » : des pièces et des billets dessinés, l'enfant tape
// combien cela fait en tout. Le programme règle la plage : des euros jusqu'à
// 20 € (pièces de 1 et 2 €, billets de 5 et 10 €), jusqu'à 100 € (billets de
// 20 et 50 € en plus), ou des centimes jusqu'à 5 € (pièces de 10, 20, 50
// centimes, de 1 et 2 €).
//
// Un item est un total dans sa plage (« mon:c:340 », en centimes) : les
// pièces sont tirées à chaque question, plusieurs façons de faire 3,40 €. Le
// serveur refait la somme et vérifie que chaque pièce est de la plage. En
// centimes, l'enfant tape tous les chiffres (3, 4, 0 pour 3,40 €).
import { Checked, ExerciseDef, Params } from './contract';

export interface MonnaieQuestion { plage: Plage; coins: number[]; }

const PLAGES = {
  e20: { denoms: [1000, 500, 200, 100], step: 100, max: 2000 },
  e100: { denoms: [5000, 2000, 1000, 500, 200, 100], step: 100, max: 10000 },
  c: { denoms: [200, 100, 50, 20, 10], step: 10, max: 500 },
} as const;
type Plage = keyof typeof PLAGES;
const plageOf = (p: Params): Plage => (typeof p['plage'] === 'string' && p['plage'] in PLAGES ? p['plage'] as Plage : 'e20');
const MAX_COINS = 10;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const keyOf = (plage: Plage, total: number): string => `mon:${plage}:${total}`;
const parseKey = (key: string): { plage: Plage; total: number } | null => {
  const m = /^mon:(e20|e100|c):(\d{1,5})$/.exec(key);
  if (!m) return null;
  const plage = m[1] as Plage, total = Number(m[2]), d = PLAGES[plage];
  return total >= d.step && total <= d.max && total % d.step === 0 ? { plage, total } : null;
};
/** Un montant comme on l'écrit : « 34 € », « 3,40 € », « 50 c » pour une pièce. */
export const money = (cents: number, coin = false): string =>
  coin && cents < 100 ? `${cents} c` : cents % 100 === 0 ? `${cents / 100} €` : `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')} €`;
/** Ce que l'enfant a tapé, en centimes : des euros jusqu'à 20 ou 100 €, des centimes sinon. */
const typedCents = (plage: Plage, typed: string): number | null => {
  const d = typed.replace(/\D/g, '');
  return d ? Number(d) * (plage === 'c' ? 1 : 100) : null;
};

/** Des pièces et billets qui font ce total, plutôt les gros, jamais plus de dix ; du plus gros au plus petit. */
function draw(plage: Plage, total: number, rand: () => number): number[] {
  const denoms = PLAGES[plage].denoms;
  for (let t = 0; t < 20; t++) {
    const out: number[] = [];
    let left = total;
    while (left > 0 && out.length < MAX_COINS) {
      const fit = denoms.filter((x) => x <= left);
      const pick = rand() < 0.6 ? fit[0] : fit[Math.floor(rand() * fit.length)];
      out.push(pick); left -= pick;
    }
    if (left === 0) return out.sort((a, b) => b - a);
  }
  const out: number[] = [];
  let left = total;
  for (const x of denoms) while (left >= x) { out.push(x); left -= x; }
  return out;
}
const TRANCHES: Record<Plage, [number, string][]> = {
  e20: [[1000, 'Jusqu’à 10 €'], [2000, 'De 11 à 20 €']],
  e100: [[2000, 'Jusqu’à 20 €'], [5000, 'De 21 à 50 €'], [10000, 'De 51 à 100 €']],
  c: [[90, 'Moins de 1 €'], [200, 'De 1 à 2 €'], [500, 'De 2 à 5 €']],
};

export const MONNAIE: ExerciseDef<MonnaieQuestion> = {
  id: 'monnaie',
  label: 'La monnaie',
  matiere: 'maths',
  icon: 'budget',
  ageMin: 6,
  desc: 'Des pièces et des billets dessinés : l’enfant tape combien cela fait en tout. Des euros jusqu’à 20 € ou 100 €, ou des centimes jusqu’à 5 € (3, 4, 0 pour 3,40 €).',
  input: 'pave',
  prompt: 'monnaie',
  view: 'liste',
  params: [
    { key: 'plage', type: 'enum', label: 'Pièces et billets', default: 'e20', options: [
      { value: 'e20', label: 'Des euros, jusqu’à 20 €' }, { value: 'e100', label: 'Des euros, jusqu’à 100 €' },
      { value: 'c', label: 'Des centimes, jusqu’à 5 €' },
    ] },
  ],

  /** Chaque total de la plage, au pas de la plus petite pièce. */
  universe(p) {
    const plage = plageOf(p), d = PLAGES[plage];
    return Array.from({ length: d.max / d.step }, (_, i) => keyOf(plage, (i + 1) * d.step));
  },
  question(key, _p, rand) {
    const k = parseKey(key) ?? { plage: 'e20' as Plage, total: 100 };
    return { plage: k.plage, coins: draw(k.plage, k.total, rand) };
  },
  parse(raw, p) {
    const o = (raw ?? {}) as Record<string, unknown>, plage = plageOf(p), d = PLAGES[plage];
    const coins = Array.isArray(o['coins']) ? o['coins'] as unknown[] : [];
    const ok = o['plage'] === plage && coins.length >= 1 && coins.length <= MAX_COINS && coins.every((x) => (d.denoms as readonly unknown[]).includes(x));
    return ok && sum(coins as number[]) <= d.max ? { plage, coins: coins as number[] } : null;
  },
  itemKey: (q) => keyOf(q.plage, sum(q.coins)),
  itemLabel(key) { const k = parseKey(key); return k ? money(k.total) : key; },
  text: (q) => q.coins.map((x) => money(x, true)).join(' + '),
  ask: () => ({ before: 'En tout :', after: '' }),
  coins: (q) => q.coins,
  groups(key) { const k = parseKey(key); return k ? [TRANCHES[k.plage].find(([to]) => k.total <= to)![1]] : []; },

  check(q, given): Checked {
    const total = sum(q.coins);
    return { ok: typedCents(q.plage, given) === total, expected: money(total) };
  },
  /** Les chiffres tapés, lus comme un montant de la plage : « 340 » fait « 3,40 € » en centimes, « 34 » fait « 34 € » en euros. */
  display(typed, q) { const c = typedCents(q.plage, typed); return c === null ? typed : money(c); },

  summary(p) { return { e20: 'La monnaie jusqu’à 20 €', e100: 'La monnaie jusqu’à 100 €', c: 'La monnaie, centimes compris, jusqu’à 5 €' }[plageOf(p)]; },
};
