// Le module Révisions côté écran : tout ce qui se calcule sans navigateur ni
// serveur, pour n'importe quel exercice du registre (exercises/). Le tirage
// des questions, le classement d'une réponse (le serveur le refait et fait
// foi), les phrases du bilan et de l'objectif. Rien ici ne connaît une
// matière : tout passe par la définition de l'exercice. Pur, pour être vérifié
// par les tests. Voir docs/revisions.md.
import type { ExerciseDef, Mode, Params } from './exercises/contract';

export type Result = 'bon' | 'lent' | 'faux' | 'passe';
export type Status = 'jamais' | 'peu' | 'en-cours' | 'acquise';

/** La maîtrise d'un item, telle que le serveur la rend. */
export interface MasteryItem {
  key: string; label: string; level: number; good: number; wrong: number;
  lastResult: Result; lastAt: string; nextAt: string; status: Status;
}

export const MODE_LABELS: Record<Mode, { label: string; sub: string }> = {
  apprendre: { label: 'Apprendre', sub: 'La réponse sous les yeux, à recopier' },
  entrainer: { label: 'S’entraîner', sub: 'La bonne réponse s’affiche en cas d’erreur' },
  test: { label: 'Test', sub: 'Les réponses à la fin' },
};

/** Les mots de l'état d'un item, pour la légende et les lecteurs d'écran. */
export const STATUS_LABEL: Record<Status, string> = {
  jamais: 'pas encore vu', peu: 'pas assez de réponses', 'en-cours': 'en cours', acquise: 'acquis',
};

/** Juste et vite : bonne ; juste après le seuil : lente ; sinon fausse, ou passée sans réponse. */
export function classify(ok: boolean, given: string | null, ms: number, fastMs: number): Result {
  if (given === null) return 'passe';
  if (!ok) return 'faux';
  return ms <= fastMs ? 'bon' : 'lent';
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/**
 * Les questions d'une session, pour n'importe quel exercice. D'abord les items
 * dus (leur révision est passée), les plus anciens en tête ; puis ceux jamais
 * vus, au plus un tiers de la session pour ne pas noyer l'enfant ; puis de la
 * révision au hasard. Toujours dans l'univers des paramètres. Un univers plus
 * petit que la session se répète, jamais deux fois de suite le même item.
 * La forme de chaque question (le sens de 6 × 7) revient à l'exercice.
 */
export function drawQuestions<Q>(def: ExerciseDef<Q>, p: Params, o: {
  count: number; mastery: readonly MasteryItem[]; now: string; rand?: () => number;
}): Q[] {
  const rand = o.rand ?? Math.random;
  const known = new Map(o.mastery.map((m) => [m.key, m] as const));
  const keys = def.universe(p);
  const due = keys.filter((k) => { const m = known.get(k); return m && m.nextAt <= o.now; })
    .sort((x, y) => known.get(x)!.nextAt.localeCompare(known.get(y)!.nextAt));
  const unseen = shuffle(keys.filter((k) => !known.has(k)), rand);
  const rest = shuffle(keys.filter((k) => { const m = known.get(k); return m && m.nextAt > o.now; }), rand);
  const picked = due.slice(0, o.count);
  picked.push(...unseen.splice(0, Math.min(Math.ceil(o.count / 3), o.count - picked.length)));
  for (const pool of [rest, unseen, due.slice(picked.length)]) while (picked.length < o.count && pool.length) picked.push(pool.shift()!);
  while (picked.length < o.count && keys.length) picked.push(...shuffle(keys, rand).slice(0, o.count - picked.length));
  const order = shuffle(picked, rand);
  for (let i = 1; i < order.length; i++) {
    if (order[i] !== order[i - 1]) continue;
    const j = order.findIndex((k, n) => n > i && k !== order[i] && k !== order[i - 1]);
    if (j > 0) [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((k) => def.question(k, p, rand));
}

const n = (k: number, one: string, many: string): string => `${k} ${k > 1 ? many : one}`;
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** Le bilan d'une session : « Tu as révisé les tables de 6 à 9, multiplication : 18 bonnes, 2 lentes, 0 fausse. » */
export function summaryLine(def: ExerciseDef, p: Params, r: { good: number; slow: number; wrong: number }): string {
  return `Tu as révisé ${lowerFirst(def.summary(p))} : ${n(r.good, 'bonne', 'bonnes')}, ${n(r.slow, 'lente', 'lentes')}, ${n(r.wrong, 'fausse', 'fausses')}.`;
}

/**
 * Ce qu'il faut encore travailler, par ordre d'urgence : le plus bas niveau,
 * puis le plus d'erreurs. Limité à l'univers des paramètres en vigueur quand
 * il est donné : un item d'un ancien programme ne se mêle pas au nouveau.
 */
export function fragile(items: readonly MasteryItem[], limit = 6, universe?: readonly string[]): MasteryItem[] {
  const within = universe && new Set(universe);
  return items.filter((c) => (!within || within.has(c.key)) && c.status !== 'acquise' && (c.wrong > 0 || c.lastResult !== 'bon'))
    .sort((x, y) => x.level - y.level || y.wrong - x.wrong || x.key.localeCompare(y.key))
    .slice(0, limit);
}

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

/**
 * L'objectif de « Mon entraînement du jour », qui enchaîne plusieurs
 * exercices : celui de l'exercice quand il est seul, sinon combien sont faits.
 */
export function dayLine(goals: readonly { done: number; goal: number }[]): string {
  if (goals.length === 1) return goalLine(goals[0].done, goals[0].goal);
  const set = goals.filter((g) => g.goal > 0);
  if (!set.length) return '';
  const met = set.filter((g) => g.done >= g.goal).length;
  if (met === set.length) return 'Objectif du jour atteint';
  return met ? `${met} exercice${met > 1 ? 's' : ''} sur ${set.length} fait${met > 1 ? 's' : ''} aujourd’hui` : 'Pas encore aujourd’hui';
}

/**
 * Les groupes du suivi d'un programme, dans l'ordre de l'univers, avec ceux
 * qui n'ont encore aucune réponse : « pas encore vu » se dit, il ne disparaît pas.
 */
export function programGroups(def: ExerciseDef, p: Params, seen: readonly { group: string; questions: number; correct: number; fast: number }[]) {
  const by = new Map(seen.map((g) => [g.group, g] as const));
  const names: string[] = [];
  for (const k of def.universe(p)) for (const g of def.groups(k, p)) if (!names.includes(g)) names.push(g);
  names.sort((x, y) => x.localeCompare(y, 'fr', { numeric: true }));
  return names.map((group) => {
    const g = by.get(group);
    return { group, questions: g?.questions ?? 0, pct: g?.questions ? Math.round((g.correct / g.questions) * 100) : 0, fastPct: g?.questions ? Math.round((g.fast / g.questions) * 100) : 0 };
  });
}

/** Les `n` derniers jours (heure de Paris), aujourd'hui en dernier, avec leurs sessions. */
export function activityDays(days: readonly { day: string; sessions: number }[], now: Date, n = 28): { day: string; sessions: number }[] {
  const by = new Map(days.map((d) => [d.day, d.sessions] as const));
  return Array.from({ length: n }, (_, i) => {
    const day = parisDay(new Date(now.getTime() - (n - 1 - i) * 86400_000).toISOString());
    return { day, sessions: by.get(day) ?? 0 };
  });
}

/** Un jour « AAAA-MM-JJ » décalé de `n` jours. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export type PeriodPreset = 'semaine' | 'semaine-derniere' | 'mois' | 'mois-dernier';
export const PERIODS: { id: PeriodPreset; label: string }[] = [
  { id: 'semaine', label: 'Cette semaine' }, { id: 'semaine-derniere', label: 'Semaine dernière' },
  { id: 'mois', label: 'Ce mois-ci' }, { id: 'mois-dernier', label: 'Mois dernier' },
];

/** Les jours (fin incluse) d'une période proposée, vue depuis `today` : une semaine va du lundi au dimanche. */
export function periodOf(p: PeriodPreset, today: string): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  const monday = addDays(today, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
  const first = today.slice(0, 8) + '01';
  switch (p) {
    case 'semaine': return { from: monday, to: today };
    case 'semaine-derniere': return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case 'mois': return { from: first, to: today };
    case 'mois-dernier': { const last = addDays(first, -1); return { from: last.slice(0, 8) + '01', to: last }; }
  }
}

/** La tuile d'accueil d'un adulte : « Raphaël : 2 sessions aujourd'hui, Gaëtan : pas encore aujourd'hui ». */
export function kidsLine(kids: readonly { name: string; sessions: number | undefined }[]): string {
  return kids.filter((k) => k.sessions !== undefined)
    .map((k) => `${k.name} : ${k.sessions ? `${k.sessions} session${k.sessions! > 1 ? 's' : ''} aujourd’hui` : 'pas encore aujourd’hui'}`).join(', ');
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
