// Le bilan d'une période pour un enfant : ce que lit un parent, ce que reçoit
// la maîtresse (PDF), ce que dit la notification du dimanche. Par matière puis
// par exercice : sessions et questions, réussite par groupe d'items (pour
// Tables, par table) comparée à la période précédente de même longueur, et ce
// qui reste fragile. Rien ici ne connaît un exercice : les groupes, les
// libellés et le résumé viennent de leur définition.
//
// Le cœur (`computeBilan`) est pur : il reçoit les sessions, les réponses et la
// maîtrise, et rend le bilan. `bilanFor` lit la base pour lui. Les jours sont
// ceux de Paris (AAAA-MM-JJ), la fin incluse.
import { ExerciseContext, ExerciseDef, NO_CONTEXT, Params, defaults, readParams } from './exercises/contract';
import { EXERCISES, exerciseById } from './exercises';
import { MasteryCfg, Result, Status, status } from './mastery';
import { Matiere, matiereLabel } from './matieres';
import { MasteryRow, ProgramRow, SessionRow, activePrograms, answersBetween, masteryRows, sessionsBetween, toMastery } from './repo';

export interface BilanGroup { group: string; questions: number; pct: number; fastPct: number; prevPct: number | null; }
export interface BilanTotals { sessions: number; questions: number; good: number; slow: number; wrong: number; pct: number; }
export interface BilanExercise {
  id: string; label: string; summary: string;
  totals: BilanTotals; prev: BilanTotals | null;
  groups: BilanGroup[]; fragiles: { label: string; status: Status }[];
}
export interface Bilan {
  member: { id: string; name: string }; from: string; to: string; label: string;
  matieres: { id: string; label: string; exercises: BilanExercise[] }[];
  totals: BilanTotals; prev: BilanTotals | null;
}

export interface BilanInput {
  member: { id: string; name: string }; from: string; to: string;
  matieres: Matiere[];
  /** Les sessions de la période et de la précédente (le tri par jour se fait ici). */
  sessions: Pick<SessionRow, 'exercise_id' | 'mode' | 'started_at' | 'questions' | 'good' | 'slow' | 'wrong' | 'params_json'>[];
  answers: { exercise_id: string; item_key: string; result: Result; asked_at: string; params_json: string }[];
  mastery: (exercise: string) => MasteryRow[];
  programs: Pick<ProgramRow, 'exercise_id' | 'params_json'>[];
  cfgOf: (exercise: string) => MasteryCfg;
  /** Le contenu de chaque exercice (ses listes) ; aucun par défaut. */
  ctxOf?: (exercise: string) => ExerciseContext;
  exercises?: readonly ExerciseDef[];
}

const pad = (n: number): string => String(n).padStart(2, '0');
export const parisDay = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));
/** Un jour « AAAA-MM-JJ » décalé de `n` jours. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const dayCount = (from: string, to: string): number => {
  const [a, b] = [from, to].map((x) => { const [y, m, d] = x.split('-').map(Number); return Date.UTC(y, m - 1, d); });
  return Math.round((b - a) / 86_400_000) + 1;
};
const weekday = (day: string): number => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

/** Le lundi de la semaine d'un jour. */
export const mondayOf = (day: string): string => addDays(day, -((weekday(day) + 6) % 7));

/** Un jour en toutes lettres ; le premier du mois s'écrit « 1er ». */
const long = (day: string, opts: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...opts }).format(new Date(day + 'T12:00:00Z')).replace(/^1(?=\s|$)/, '1er');

/** « Semaine du lundi 12 au dimanche 18 octobre 2026 », « Du 28 septembre au 4 octobre 2026 », « Le 12 octobre 2026 ». */
export function periodLabel(from: string, to: string): string {
  if (from === to) return 'Le ' + long(from, { day: 'numeric', month: 'long', year: 'numeric' });
  const sameMonth = from.slice(0, 7) === to.slice(0, 7), sameYear = from.slice(0, 4) === to.slice(0, 4);
  const start = long(from, sameMonth ? { day: 'numeric' } : sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });
  const end = long(to, { day: 'numeric', month: 'long', year: 'numeric' });
  if (weekday(from) === 1 && dayCount(from, to) === 7) return `Semaine du lundi ${start} au dimanche ${end}`;
  return `Du ${start} au ${end}`;
}

const totalsOf = (ss: BilanInput['sessions']): BilanTotals => {
  const t = ss.reduce((a, s) => ({ sessions: a.sessions + 1, questions: a.questions + s.questions, good: a.good + s.good, slow: a.slow + s.slow, wrong: a.wrong + s.wrong }),
    { sessions: 0, questions: 0, good: 0, slow: 0, wrong: 0 });
  return { ...t, pct: t.questions ? Math.round(((t.good + t.slow) / t.questions) * 100) : 0 };
};
const parse = (def: ExerciseDef, json: string, ctx: ExerciseContext): Params => { try { return readParams(def, JSON.parse(json), ctx); } catch { return defaults(def, ctx); } };

/** Le bilan d'une période. Pur : voir l'en-tête. */
export function computeBilan(i: BilanInput): Bilan {
  const defs = i.exercises ?? EXERCISES;
  const len = dayCount(i.from, i.to);
  const prevFrom = addDays(i.from, -len), prevTo = addDays(i.from, -1);
  const inP = (iso: string): boolean => { const d = parisDay(iso); return d >= i.from && d <= i.to; };
  const inPrev = (iso: string): boolean => { const d = parisDay(iso); return d >= prevFrom && d <= prevTo; };
  const counted = i.sessions.filter((s) => s.mode !== 'apprendre');
  const cur = counted.filter((s) => inP(s.started_at)), prev = counted.filter((s) => inPrev(s.started_at));

  const exercises: (BilanExercise & { matiere: string })[] = [];
  for (const def of defs) {
    const mine = cur.filter((s) => s.exercise_id === def.id);
    const program = i.programs.find((p) => p.exercise_id === def.id);
    if (!mine.length && !program) continue;
    const ctx = i.ctxOf?.(def.id) ?? NO_CONTEXT;
    // Les paramètres de référence : ceux du programme en vigueur, sinon ceux de la dernière session de la période.
    const ref = program ? parse(def, program.params_json, ctx) : parse(def, mine[mine.length - 1].params_json, ctx);
    const groupsIn = (pred: (iso: string) => boolean) => {
      const by = new Map<string, { q: number; ok: number; fast: number }>();
      for (const a of i.answers) {
        if (a.exercise_id !== def.id || !pred(a.asked_at)) continue;
        for (const g of def.groups(a.item_key, parse(def, a.params_json, ctx), ctx)) {
          const e = by.get(g) ?? { q: 0, ok: 0, fast: 0 };
          e.q++; if (a.result === 'bon' || a.result === 'lent') e.ok++; if (a.result === 'bon') e.fast++;
          by.set(g, e);
        }
      }
      return by;
    };
    const now = groupsIn(inP), before = groupsIn(inPrev);
    const groups = [...now.entries()].sort(([x], [y]) => x.localeCompare(y, 'fr', { numeric: true })).map(([group, e]) => {
      const b = before.get(group);
      return { group, questions: e.q, pct: Math.round((e.ok / e.q) * 100), fastPct: Math.round((e.fast / e.q) * 100), prevPct: b ? Math.round((b.ok / b.q) * 100) : null };
    });
    const universe = new Set(def.universe(ref, ctx));
    const cfg = i.cfgOf(def.id);
    const fragiles = i.mastery(def.id).map((r) => ({ r, m: toMastery(r) }))
      .filter(({ r, m }) => universe.has(r.item_key) && status(m, cfg) !== 'acquise' && (m.wrong > 0 || m.lastResult !== 'bon'))
      .sort((x, y) => x.m.level - y.m.level || y.m.wrong - x.m.wrong || x.r.item_key.localeCompare(y.r.item_key))
      .slice(0, 8).map(({ r, m }) => ({ label: def.itemLabel(r.item_key), status: status(m, cfg) }));
    const p = prev.filter((s) => s.exercise_id === def.id);
    exercises.push({ id: def.id, matiere: def.matiere, label: def.label, summary: def.summary(ref, ctx), totals: totalsOf(mine), prev: p.length ? totalsOf(p) : null, groups, fragiles });
  }
  const ids = [...new Set([...i.matieres.map((m) => m.id), ...exercises.map((e) => e.matiere)])];
  const matieres = ids.map((id) => ({ id, label: matiereLabel(i.matieres, id), exercises: exercises.filter((e) => e.matiere === id).map(({ matiere: _m, ...e }) => e) }))
    .filter((m) => m.exercises.length);
  return { member: i.member, from: i.from, to: i.to, label: periodLabel(i.from, i.to), matieres, totals: totalsOf(cur), prev: prev.length ? totalsOf(prev) : null };
}

/** Le bilan d'une période, lu dans la base. */
export function bilanFor(member: { id: string; name: string }, from: string, to: string, matieres: Matiere[], cfgOf: (exercise: string) => MasteryCfg,
  ctxOf?: (exercise: string) => ExerciseContext): Bilan {
  const len = dayCount(from, to);
  // Une marge d'un jour de chaque côté : le tri au jour de Paris se fait ensuite.
  const since = addDays(from, -len - 1) + 'T00:00:00.000Z', until = addDays(to, 2) + 'T00:00:00.000Z';
  return computeBilan({
    member, from, to, matieres, cfgOf, ctxOf,
    sessions: sessionsBetween(member.id, since, until),
    answers: answersBetween(member.id, since, until),
    mastery: (ex) => masteryRows(member.id, ex),
    programs: activePrograms(member.id).filter((p) => exerciseById(p.exercise_id)),
  });
}

const n = (k: number, one: string, many: string): string => `${k} ${k > 1 ? many : one}`;
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const list = (xs: string[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}`);

/**
 * La phrase de la notification du dimanche : « Raphaël cette semaine :
 * 5 sessions, les tables de 6 à 9, multiplication, 92 % de réussite, 7 × 8 et
 * 6 × 9 encore fragiles. » Sans session, elle le dit sans reproche.
 */
export function weekLine(b: Bilan): string {
  const ex = b.matieres.flatMap((m) => m.exercises);
  if (!b.totals.sessions) return `${b.member.name} cette semaine : pas de session de révisions.`;
  const done = ex.filter((e) => e.totals.sessions);
  const frag = done.flatMap((e) => e.fragiles.map((f) => f.label)).slice(0, 3);
  return `${b.member.name} cette semaine : ${n(b.totals.sessions, 'session', 'sessions')}, ${done.map((e) => lowerFirst(e.summary)).join(' ; ')}, ${b.totals.pct} % de réussite`
    + (frag.length ? `, ${list(frag)} encore fragile${frag.length > 1 ? 's' : ''}.` : '.');
}

/**
 * La semaine du bilan hebdomadaire, quand il est dû : le dimanche, à partir
 * de l'heure réglée (heure murale de Paris), du lundi à ce dimanche. Sinon null.
 */
export function weekDue(nowWall: string, heure: string): { from: string; to: string } | null {
  const day = nowWall.slice(0, 10);
  if (weekday(day) !== 0 || nowWall.slice(11, 16) < (/^\d{2}:\d{2}$/.test(heure) ? heure : '18:30')) return null;
  return { from: addDays(day, -6), to: day };
}

/** Une notification de bilan hebdomadaire à envoyer : la forme des rappels du planificateur (notify/reminders.ts). */
export interface WeeklyHit { key: string; taskId: string; memberIds: string[]; title: string; body: string; fireAt: string; }

/**
 * Les bilans du dimanche à envoyer maintenant : un par enfant qui a un
 * programme ou au moins une session dans la semaine, aux adultes donnés. La
 * clé porte l'enfant et le lundi : une seule notification par enfant et par
 * semaine, même si le service redémarre ou que l'heure change.
 */
export function weeklyHits(kids: { id: string; name: string }[], adults: string[], nowWall: string, heure: string,
  bilanOf: (kid: { id: string; name: string }, from: string, to: string) => Bilan): WeeklyHit[] {
  const w = weekDue(nowWall, heure);
  if (!w || !adults.length) return [];
  return kids.map((k) => ({ k, b: bilanOf(k, w.from, w.to) })).filter(({ b }) => b.matieres.length).map(({ k, b }) => ({
    key: `revisions-hebdo|${k.id}|${w.from}`, taskId: k.id, memberIds: [...adults],
    title: `Révisions de ${k.name}`, body: weekLine(b), fireAt: `${w.to}T${heure}`,
  }));
}
