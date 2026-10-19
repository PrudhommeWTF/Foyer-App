// Le module Tables côté écran : tout ce qui se calcule sans navigateur ni
// serveur. Le tirage des questions, la correction (la même règle que
// backend/src/tables/mastery.ts, qui refait la correction et fait foi), les
// phrases du bilan, le classement des opérations fragiles. Pur, pour être
// vérifié par les tests. Voir docs/tables.md.

export type Operation = 'multiplication' | 'addition';
export type Mode = 'apprendre' | 'entrainer' | 'test';
export type Result = 'bon' | 'lent' | 'faux' | 'passe';
export type Status = 'jamais' | 'peu' | 'en-cours' | 'acquise';

export const OPERATIONS: { id: Operation; label: string; sign: string; word: string }[] = [
  { id: 'multiplication', label: 'Multiplication', sign: '×', word: 'fois' },
  { id: 'addition', label: 'Addition', sign: '+', word: 'plus' },
];
export const MODES: { id: Mode; label: string; sub: string }[] = [
  { id: 'apprendre', label: 'Apprendre', sub: 'La table sous les yeux, à recopier' },
  { id: 'entrainer', label: 'S’entraîner', sub: 'La bonne réponse s’affiche en cas d’erreur' },
  { id: 'test', label: 'Test', sub: 'Les réponses à la fin' },
];
export const signOf = (op: Operation): string => (op === 'multiplication' ? '×' : '+');

export interface Question { a: number; b: number; expected: number; }
export interface MasteryCell { a: number; b: number; level: number; good: number; wrong: number; lastResult: Result; nextAt: string; status: Status; }

export const expectedOf = (op: Operation, a: number, b: number): number => (op === 'multiplication' ? a * b : a + b);
export const pairOf = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);
export const pairKey = (a: number, b: number): string => pairOf(a, b).join('x');

/** Juste et vite : bonne ; juste après le seuil : lente ; sinon fausse, ou passée sans réponse. */
export function classify(expected: number, given: number | null, ms: number, fastMs: number): Result {
  if (given === null) return 'passe';
  if (given !== expected) return 'faux';
  return ms <= fastMs ? 'bon' : 'lent';
}

/** Les couples d'une plage : chaque table de `from` à `to`, par chaque nombre de 0 à `max`, sans doublon commutatif. */
export function rangePairs(from: number, to: number, max: number): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (let t = from; t <= to; t++) for (let n = 0; n <= max; n++) seen.set(pairKey(t, n), pairOf(t, n));
  return [...seen.values()];
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/**
 * Les questions d'une session. D'abord les opérations dues (leur révision est
 * passée), les plus anciennes en tête ; puis celles jamais vues, au plus un
 * tiers de la session pour ne pas noyer l'enfant ; puis de la révision au
 * hasard. Toujours dans la plage du programme. Une plage plus petite que la
 * session se répète, jamais deux fois de suite la même question.
 */
export function drawQuestions(o: {
  op: Operation; from: number; to: number; max: number; count: number; bothDirections: boolean;
  mastery: readonly MasteryCell[]; now: string; rand?: () => number;
}): Question[] {
  const rand = o.rand ?? Math.random;
  const known = new Map(o.mastery.map((m) => [pairKey(m.a, m.b), m] as const));
  const pairs = rangePairs(o.from, o.to, o.max);
  const due = pairs.filter((p) => { const m = known.get(p.join('x')); return m && m.nextAt <= o.now; })
    .sort((x, y) => known.get(x.join('x'))!.nextAt.localeCompare(known.get(y.join('x'))!.nextAt));
  const unseen = shuffle(pairs.filter((p) => !known.has(p.join('x'))), rand);
  const rest = shuffle(pairs.filter((p) => { const m = known.get(p.join('x')); return m && m.nextAt > o.now; }), rand);
  const picked: [number, number][] = due.slice(0, o.count);
  const newcomers = unseen.splice(0, Math.min(Math.ceil(o.count / 3), o.count - picked.length));
  picked.push(...newcomers);
  for (const pool of [rest, unseen, due.slice(picked.length)]) while (picked.length < o.count && pool.length) picked.push(pool.shift()!);
  while (picked.length < o.count && pairs.length) picked.push(...shuffle(pairs, rand).slice(0, o.count - picked.length));
  // L'ordre de la question : le facteur de la plage d'abord (« la table de 7 »
  // pose 7 × 3), ou l'un ou l'autre au hasard quand les deux sens sont voulus.
  const inRange = (n: number) => n >= o.from && n <= o.to;
  const qs = shuffle(picked, rand).map(([x, y]) => {
    const [a, b] = o.bothDirections ? (rand() < 0.5 ? [y, x] : [x, y]) : inRange(x) ? [x, y] : [y, x];
    return { a, b, expected: expectedOf(o.op, a, b) };
  });
  for (let i = 1; i < qs.length; i++) {
    if (pairKey(qs[i].a, qs[i].b) !== pairKey(qs[i - 1].a, qs[i - 1].b)) continue;
    const j = qs.findIndex((q, k) => k > i && pairKey(q.a, q.b) !== pairKey(qs[i].a, qs[i].b));
    if (j > 0) [qs[i], qs[j]] = [qs[j], qs[i]];
  }
  return qs;
}

/** Les lignes d'une table en mode Apprendre : 7 × 1 à 7 × max. */
export const learnRows = (op: Operation, t: number, max: number): Question[] =>
  Array.from({ length: max }, (_, i) => ({ a: t, b: i + 1, expected: expectedOf(op, t, i + 1) }));

/** Ce que la voix de l'appareil lit : « 7 fois 3, 21 ». */
export const spoken = (op: Operation, q: Question): string => `${q.a} ${op === 'multiplication' ? 'fois' : 'plus'} ${q.b}, ${q.expected}`;

const n = (k: number, one: string, many: string): string => `${k} ${k > 1 ? many : one}`;

/** « les tables de 6 à 9 », « la table de 7 ». */
export const rangeLabel = (from: number, to: number): string => (from === to ? `la table de ${from}` : `les tables de ${from} à ${to}`);

/** Le bilan d'une session : « Tu as révisé les tables de 6 à 9 : 18 bonnes, 2 lentes, 0 fausse. » */
export function summaryLine(from: number, to: number, r: { good: number; slow: number; wrong: number }): string {
  return `Tu as révisé ${rangeLabel(from, to)} : ${n(r.good, 'bonne', 'bonnes')}, ${n(r.slow, 'lente', 'lentes')}, ${n(r.wrong, 'fausse', 'fausses')}.`;
}

/** Ce qu'il faut encore travailler, par ordre d'urgence : le plus bas niveau, puis le plus d'erreurs. */
export function fragile(cells: readonly MasteryCell[], limit = 8): MasteryCell[] {
  return cells.filter((c) => c.status !== 'acquise' && (c.wrong > 0 || c.lastResult !== 'bon'))
    .sort((x, y) => x.level - y.level || y.wrong - x.wrong || x.a - y.a || x.b - y.b)
    .slice(0, limit);
}

/** Les mots de l'état d'une case, pour l'aide et les lecteurs d'écran. */
export const STATUS_LABEL: Record<Status, string> = {
  jamais: 'pas encore vue', peu: 'pas assez de réponses', 'en-cours': 'en cours', acquise: 'acquise',
};

/**
 * L'objectif du jour, sans jamais reprocher un zéro : « pas encore
 * aujourd'hui », « 1 session sur 2 faite », « objectif atteint ».
 */
export function goalLine(done: number, goal: number): string {
  if (goal <= 0) return done ? `${n(done, 'session', 'sessions')} aujourd’hui` : '';
  if (done >= goal) return done > goal ? `Objectif atteint : ${n(done, 'session', 'sessions')} aujourd’hui` : 'Objectif du jour atteint';
  if (!done) return 'Pas encore aujourd’hui';
  return `${done} session sur ${goal} faite`;
}

/** Un identifiant de session, même servi en http sur le réseau local (où crypto.randomUUID manque). */
export function sessionUuid(rnd: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const b = rnd(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Le jour (AAAA-MM-JJ) d'un instant, à l'heure de Paris. */
export const parisDay = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));
