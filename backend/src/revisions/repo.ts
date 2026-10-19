// Les écritures et lectures du module Révisions. La réception d'une session est
// une seule transaction : la session, ses réponses, puis la maîtrise des items
// qu'elle touche, recalculée depuis **toutes** leurs réponses dans l'ordre où
// elles ont été données. Une session faite hors ligne mardi et arrivée après
// celle de mercredi donne donc exactement la même maîtrise que si elles étaient
// arrivées dans l'ordre. Rien ici ne connaît un exercice : des identifiants et
// des clés, fournis par les définitions (exercises/).
import type { Database } from 'better-sqlite3';
import { Mastery, MasteryCfg, Result, replay } from './mastery';
import type { Mode, Params } from './exercises/contract';

let database: Database;
export function initRevisionsRepo(db: Database): void { database = db; }

export interface AnswerIn { itemKey: string; question: unknown; expected: string; given: string | null; ms: number; askedAt: string; result: Result; }
export interface SessionIn {
  id: string; memberId: string; exerciseId: string; programId: number | null; mode: Mode; params: Params;
  startedAt: string; endedAt: string; aborted: boolean; allowedMs: number; fastMs: number; device: string; via: string | null;
  answers: AnswerIn[];
}

export interface SessionRow {
  id: string; member_id: string; exercise_id: string; program_id: number | null; mode: Mode; params_json: string;
  started_at: string; ended_at: string; aborted: number; questions: number; good: number; slow: number; wrong: number;
  avg_ms: number | null; allowed_ms: number; fast_ms: number; device: string; via: string | null; received_at: string;
}
export interface MasteryRow {
  member_id: string; exercise_id: string; item_key: string; level: number; good_count: number; wrong_count: number;
  last_result: Result; last_at: string; next_at: string;
}
export interface ProgramRow {
  id: number; member_id: string; exercise_id: string; params_json: string; questions: number;
  seconds_allowed: number | null; fast_seconds: number | null; daily_goal: number;
  set_by: string | null; set_at: string; active: number;
}
export interface AnswerRow { item_key: string; question_json: string; expected: string; given: string | null; ms: number; result: Result; asked_at: string; mode: Mode; }

export const toMastery = (r: MasteryRow): Mastery => ({ level: r.level, good: r.good_count, wrong: r.wrong_count, lastResult: r.last_result, lastAt: r.last_at, nextAt: r.next_at });

/** Recalcule la maîtrise de ces items depuis leurs réponses. Dans la transaction de l'appelant. */
function recompute(member: string, exercise: string, keys: Iterable<string>, cfg: MasteryCfg): void {
  const read = database.prepare(`SELECT result, asked_at AS at FROM rev_answers
    WHERE member_id = ? AND exercise_id = ? AND item_key = ? AND counts = 1 ORDER BY asked_at, id`);
  const put = database.prepare(`INSERT INTO rev_mastery (member_id, exercise_id, item_key, level, good_count, wrong_count, last_result, last_at, next_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(member_id, exercise_id, item_key) DO UPDATE SET level = excluded.level, good_count = excluded.good_count,
      wrong_count = excluded.wrong_count, last_result = excluded.last_result, last_at = excluded.last_at, next_at = excluded.next_at`);
  const del = database.prepare('DELETE FROM rev_mastery WHERE member_id = ? AND exercise_id = ? AND item_key = ?');
  for (const key of keys) {
    const m = replay(read.all(member, exercise, key) as { result: Result; at: string }[], cfg);
    if (m) put.run(member, exercise, key, m.level, m.good, m.wrong, m.lastResult, m.lastAt, m.nextAt);
    else del.run(member, exercise, key);
  }
}

/**
 * Enregistre une session et ses réponses, puis la maîtrise des items touchés.
 * Idempotent : une session déjà reçue (même identifiant) n'est pas réécrite.
 * Rend la session telle qu'en base, et la maîtrise avant et après des items
 * touchés (l'écran de fin montre ce qui vient de changer).
 */
export function recordSession(s: SessionIn, cfg: MasteryCfg, now = new Date().toISOString()): {
  duplicate: boolean; session: SessionRow; changes: { key: string; before: Mastery | null; after: Mastery | null }[];
} {
  return database.transaction(() => {
    const existing = getSession(s.id);
    if (existing) return { duplicate: true, session: existing, changes: [] };
    const counted = s.mode !== 'apprendre';
    const good = s.answers.filter((x) => x.result === 'bon').length;
    const slow = s.answers.filter((x) => x.result === 'lent').length;
    const wrong = s.answers.length - good - slow;
    const answered = s.answers.filter((x) => x.given !== null);
    const avg = answered.length ? Math.round(answered.reduce((t, x) => t + x.ms, 0) / answered.length) : null;
    database.prepare(`INSERT INTO rev_sessions (id, member_id, exercise_id, program_id, mode, params_json, started_at, ended_at,
      aborted, questions, good, slow, wrong, avg_ms, allowed_ms, fast_ms, device, via, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(s.id, s.memberId, s.exerciseId, s.programId, s.mode, JSON.stringify(s.params), s.startedAt, s.endedAt, s.aborted ? 1 : 0,
        s.answers.length, good, slow, wrong, avg, s.allowedMs, s.fastMs, s.device, s.via, now);
    const ins = database.prepare(`INSERT INTO rev_answers (session_id, member_id, exercise_id, item_key, question_json, expected, given, ms, result, asked_at, counts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const touched = new Set<string>();
    for (const x of s.answers) {
      ins.run(s.id, s.memberId, s.exerciseId, x.itemKey, JSON.stringify(x.question), x.expected, x.given, x.ms, x.result, x.askedAt, counted ? 1 : 0);
      touched.add(x.itemKey);
    }
    if (!counted) return { duplicate: false, session: getSession(s.id)!, changes: [] };
    const before = new Map([...touched].map((k) => [k, masteryOf(s.memberId, s.exerciseId, k)] as const));
    recompute(s.memberId, s.exerciseId, touched, cfg);
    const changes = [...touched].map((key) => ({ key, before: before.get(key) ?? null, after: masteryOf(s.memberId, s.exerciseId, key) }));
    return { duplicate: false, session: getSession(s.id)!, changes };
  })();
}

export function getSession(id: string): SessionRow | undefined {
  return database.prepare('SELECT * FROM rev_sessions WHERE id = ?').get(id) as SessionRow | undefined;
}

export function masteryOf(member: string, exercise: string, key: string): Mastery | null {
  const r = database.prepare('SELECT * FROM rev_mastery WHERE member_id = ? AND exercise_id = ? AND item_key = ?').get(member, exercise, key) as MasteryRow | undefined;
  return r ? toMastery(r) : null;
}

export function masteryRows(member: string, exercise: string): MasteryRow[] {
  return database.prepare('SELECT * FROM rev_mastery WHERE member_id = ? AND exercise_id = ? ORDER BY item_key').all(member, exercise) as MasteryRow[];
}

/** L'historique d'un item, les plus récentes d'abord : ce que montre le tap sur une case. */
export function itemHistory(member: string, exercise: string, key: string, limit = 50): AnswerRow[] {
  return database.prepare(`SELECT x.item_key, x.question_json, x.expected, x.given, x.ms, x.result, x.asked_at, s.mode
    FROM rev_answers x JOIN rev_sessions s ON s.id = x.session_id
    WHERE x.member_id = ? AND x.exercise_id = ? AND x.item_key = ? ORDER BY x.asked_at DESC, x.id DESC LIMIT ?`)
    .all(member, exercise, key, limit) as AnswerRow[];
}

/** Les sessions d'un membre, d'un exercice ou de tous, depuis une date. */
export function sessionsOf(member: string, exercise: string | null, since: string | null, limit: number): SessionRow[] {
  return database.prepare(`SELECT * FROM rev_sessions WHERE member_id = ? AND (? IS NULL OR exercise_id = ?) AND started_at >= ?
    ORDER BY started_at DESC LIMIT ?`).all(member, exercise, exercise, since ?? '', limit) as SessionRow[];
}

/** Les réponses qui comptent d'un membre pour un exercice depuis une date : la matière du résumé par groupe. */
export function countedAnswers(member: string, exercise: string, since: string): { item_key: string; result: Result }[] {
  return database.prepare(`SELECT item_key, result FROM rev_answers WHERE member_id = ? AND exercise_id = ? AND counts = 1 AND asked_at >= ?`)
    .all(member, exercise, since) as { item_key: string; result: Result }[];
}

export function activePrograms(member: string): ProgramRow[] {
  return database.prepare('SELECT * FROM rev_programs WHERE member_id = ? AND active = 1 ORDER BY exercise_id').all(member) as ProgramRow[];
}

export function activeProgram(member: string, exercise: string): ProgramRow | null {
  return (database.prepare('SELECT * FROM rev_programs WHERE member_id = ? AND exercise_id = ? AND active = 1 ORDER BY id DESC LIMIT 1')
    .get(member, exercise) as ProgramRow | undefined) ?? null;
}

export function programById(id: number): ProgramRow | null {
  return (database.prepare('SELECT * FROM rev_programs WHERE id = ?').get(id) as ProgramRow | undefined) ?? null;
}

/** Un nouveau programme remplace l'actif du même exercice, qui reste en base, daté : l'historique ne se réécrit pas. */
export function setProgram(p: {
  memberId: string; exerciseId: string; params: Params; questions: number; secondsAllowed: number | null;
  fastSeconds: number | null; dailyGoal: number; setBy: string;
}, now = new Date().toISOString()): ProgramRow {
  return database.transaction(() => {
    database.prepare('UPDATE rev_programs SET active = 0 WHERE member_id = ? AND exercise_id = ? AND active = 1').run(p.memberId, p.exerciseId);
    const id = Number(database.prepare(`INSERT INTO rev_programs (member_id, exercise_id, params_json, questions, seconds_allowed, fast_seconds,
      daily_goal, set_by, set_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(p.memberId, p.exerciseId, JSON.stringify(p.params), p.questions, p.secondsAllowed, p.fastSeconds, p.dailyGoal, p.setBy, now).lastInsertRowid);
    return programById(id)!;
  })();
}

/** Retire le programme actif d'un exercice (il reste en base, inactif). Faux s'il n'y en avait pas. */
export function stopProgram(member: string, exercise: string): boolean {
  return database.prepare('UPDATE rev_programs SET active = 0 WHERE member_id = ? AND exercise_id = ? AND active = 1').run(member, exercise).changes > 0;
}

/**
 * Recalcule toute la maîtrise d'un membre (pour un exercice, ou tous) depuis ses
 * réponses. `reclassify`, s'il est donné, refait d'abord le résultat (bon,
 * lent) de chaque réponse juste avec le seuil rapide qu'il rend pour sa
 * session : c'est le seul chemin qui réécrit le passé, et il ne part que d'une
 * commande explicite (revisions:recalcul --reclasser). Rend le nombre d'items et
 * de réponses reclassées.
 */
export function recomputeMember(member: string, exercise: string | null, cfgOf: (exercise: string) => MasteryCfg,
  reclassify?: (s: SessionRow) => number): { items: number; reclassified: number } {
  return database.transaction(() => {
    let reclassified = 0;
    if (reclassify) {
      const upd = database.prepare('UPDATE rev_answers SET result = ? WHERE id = ?');
      // Le mode Apprendre ne compte pas : ses réponses gardent leur résultat.
      const sessions = database.prepare(`SELECT * FROM rev_sessions WHERE member_id = ? AND (? IS NULL OR exercise_id = ?) AND mode != 'apprendre'`)
        .all(member, exercise, exercise) as SessionRow[];
      for (const s of sessions) {
        const fast = reclassify(s);
        const rows = database.prepare('SELECT id, result, ms FROM rev_answers WHERE session_id = ?').all(s.id) as { id: number; result: Result; ms: number }[];
        let good = 0, slow = 0;
        for (const r of rows) {
          let res = r.result;
          if (res === 'bon' || res === 'lent') { res = r.ms <= fast ? 'bon' : 'lent'; if (res !== r.result) { upd.run(res, r.id); reclassified++; } }
          if (res === 'bon') good++; else if (res === 'lent') slow++;
        }
        database.prepare('UPDATE rev_sessions SET good = ?, slow = ?, fast_ms = ? WHERE id = ?').run(good, slow, fast, s.id);
      }
    }
    database.prepare('DELETE FROM rev_mastery WHERE member_id = ? AND (? IS NULL OR exercise_id = ?)').run(member, exercise, exercise);
    const pairs = database.prepare(`SELECT DISTINCT exercise_id, item_key FROM rev_answers WHERE member_id = ? AND counts = 1 AND (? IS NULL OR exercise_id = ?)`)
      .all(member, exercise, exercise) as { exercise_id: string; item_key: string }[];
    const byEx = new Map<string, string[]>();
    for (const p of pairs) byEx.set(p.exercise_id, [...(byEx.get(p.exercise_id) ?? []), p.item_key]);
    for (const [ex, keys] of byEx) recompute(member, ex, keys, cfgOf(ex));
    return { items: pairs.length, reclassified };
  })();
}

/** Les réponses qui comptent d'un membre entre deux instants, avec les paramètres de leur session : la matière d'un bilan. */
export function answersBetween(member: string, since: string, until: string): { exercise_id: string; item_key: string; result: Result; asked_at: string; params_json: string }[] {
  return database.prepare(`SELECT x.exercise_id, x.item_key, x.result, x.asked_at, s.params_json FROM rev_answers x JOIN rev_sessions s ON s.id = x.session_id
    WHERE x.member_id = ? AND x.counts = 1 AND x.asked_at >= ? AND x.asked_at < ? ORDER BY x.asked_at`).all(member, since, until) as
    { exercise_id: string; item_key: string; result: Result; asked_at: string; params_json: string }[];
}

/** Les sessions d'un membre entre deux instants, dans l'ordre : la matière d'un bilan et de l'export. */
export function sessionsBetween(member: string, since: string, until: string): SessionRow[] {
  return database.prepare('SELECT * FROM rev_sessions WHERE member_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at').all(member, since, until) as SessionRow[];
}

/** Les membres qui ont des réponses : ce que balaie `revisions:recalcul --tous`. */
export function membersWithAnswers(): string[] {
  return (database.prepare('SELECT DISTINCT member_id FROM rev_answers').all() as { member_id: string }[]).map((r) => r.member_id);
}
