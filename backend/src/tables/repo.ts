// Les écritures et lectures du module Tables. La réception d'une session est
// une seule transaction : la session, ses réponses, puis la maîtrise des
// couples qu'elle touche, recalculée depuis **toutes** leurs réponses dans
// l'ordre où elles ont été données. Une session faite hors ligne mardi et
// arrivée après celle de mercredi donne donc exactement la même grille que si
// elles étaient arrivées dans l'ordre.
import type { Database } from 'better-sqlite3';
import { Mastery, MasteryCfg, Mode, Operation, Result, expectedOf, pairOf, replay } from './mastery';

let database: Database;
export function initTablesRepo(db: Database): void { database = db; }

export interface AnswerIn { a: number; b: number; given: number | null; ms: number; askedAt: string; result: Result; }
export interface SessionIn {
  id: string; memberId: string; programId: number | null; mode: Mode; operation: Operation;
  from: number; to: number; startedAt: string; endedAt: string; aborted: boolean;
  allowedMs: number; fastMs: number; device: string; via: string | null; answers: AnswerIn[];
}

export interface SessionRow {
  id: string; member_id: string; program_id: number | null; mode: Mode; operation: Operation; from_table: number; to_table: number;
  started_at: string; ended_at: string; aborted: number; questions: number; good: number; slow: number; wrong: number;
  avg_ms: number | null; allowed_ms: number; fast_ms: number; device: string; via: string | null; received_at: string;
}
export interface MasteryRow {
  member_id: string; operation: Operation; a: number; b: number; level: number; good_count: number; wrong_count: number;
  last_result: Result; last_at: string; next_at: string;
}
export interface ProgramRow {
  id: number; member_id: string; operation: Operation; from_table: number; to_table: number; questions: number;
  seconds_allowed: number | null; fast_seconds: number | null; daily_goal: number; both_directions: number;
  set_by: string | null; set_at: string; active: number;
}

export const toMastery = (r: MasteryRow): Mastery => ({ level: r.level, good: r.good_count, wrong: r.wrong_count, lastResult: r.last_result, lastAt: r.last_at, nextAt: r.next_at });

/** Recalcule la maîtrise de ces couples depuis leurs réponses. Dans la transaction de l'appelant. */
function recompute(member: string, op: Operation, pairs: Iterable<[number, number]>, cfg: MasteryCfg): void {
  const read = database.prepare(`SELECT result, asked_at AS at FROM tab_answers
    WHERE member_id = ? AND operation = ? AND pa = ? AND pb = ? AND counts = 1 ORDER BY asked_at, id`);
  const put = database.prepare(`INSERT INTO tab_mastery (member_id, operation, a, b, level, good_count, wrong_count, last_result, last_at, next_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(member_id, operation, a, b) DO UPDATE SET level = excluded.level, good_count = excluded.good_count,
      wrong_count = excluded.wrong_count, last_result = excluded.last_result, last_at = excluded.last_at, next_at = excluded.next_at`);
  const del = database.prepare('DELETE FROM tab_mastery WHERE member_id = ? AND operation = ? AND a = ? AND b = ?');
  for (const [pa, pb] of pairs) {
    const m = replay(read.all(member, op, pa, pb) as { result: Result; at: string }[], cfg);
    if (m) put.run(member, op, pa, pb, m.level, m.good, m.wrong, m.lastResult, m.lastAt, m.nextAt);
    else del.run(member, op, pa, pb);
  }
}

const pairKey = (a: number, b: number): string => `${a}x${b}`;

/**
 * Enregistre une session et ses réponses, puis la maîtrise des couples touchés.
 * Idempotent : une session déjà reçue (même identifiant) n'est pas réécrite.
 * Rend la session telle qu'en base, et la maîtrise avant et après des couples
 * touchés (l'écran de fin colorie ce qui vient de changer).
 */
export function recordSession(s: SessionIn, cfg: MasteryCfg, now = new Date().toISOString()): {
  duplicate: boolean; session: SessionRow; changes: { a: number; b: number; before: Mastery | null; after: Mastery | null }[];
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
    database.prepare(`INSERT INTO tab_sessions (id, member_id, program_id, mode, operation, from_table, to_table, started_at, ended_at,
      aborted, questions, good, slow, wrong, avg_ms, allowed_ms, fast_ms, device, via, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(s.id, s.memberId, s.programId, s.mode, s.operation, s.from, s.to, s.startedAt, s.endedAt, s.aborted ? 1 : 0,
        s.answers.length, good, slow, wrong, avg, s.allowedMs, s.fastMs, s.device, s.via, now);
    const ins = database.prepare(`INSERT INTO tab_answers (session_id, member_id, operation, a, b, pa, pb, expected, given, ms, result, asked_at, counts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const touched = new Map<string, [number, number]>();
    for (const x of s.answers) {
      const [pa, pb] = pairOf(x.a, x.b);
      ins.run(s.id, s.memberId, s.operation, x.a, x.b, pa, pb, expectedOf(s.operation, x.a, x.b), x.given, x.ms, x.result, x.askedAt, counted ? 1 : 0);
      touched.set(pairKey(pa, pb), [pa, pb]);
    }
    const before = new Map(counted ? [...touched.values()].map(([a, b]) => [pairKey(a, b), masteryOf(s.memberId, s.operation, a, b)] as const) : []);
    if (counted) recompute(s.memberId, s.operation, touched.values(), cfg);
    const changes = counted ? [...touched.values()].map(([a, b]) => ({ a, b, before: before.get(pairKey(a, b)) ?? null, after: masteryOf(s.memberId, s.operation, a, b) })) : [];
    return { duplicate: false, session: getSession(s.id)!, changes };
  })();
}

export function getSession(id: string): SessionRow | undefined {
  return database.prepare('SELECT * FROM tab_sessions WHERE id = ?').get(id) as SessionRow | undefined;
}

export function masteryOf(member: string, op: Operation, a: number, b: number): Mastery | null {
  const r = database.prepare('SELECT * FROM tab_mastery WHERE member_id = ? AND operation = ? AND a = ? AND b = ?').get(member, op, a, b) as MasteryRow | undefined;
  return r ? toMastery(r) : null;
}

export function masteryRows(member: string, op: Operation): MasteryRow[] {
  return database.prepare('SELECT * FROM tab_mastery WHERE member_id = ? AND operation = ? ORDER BY a, b').all(member, op) as MasteryRow[];
}

/** L'historique d'un couple, les plus récentes d'abord : ce que montre le tap sur une case. */
export function pairHistory(member: string, op: Operation, pa: number, pb: number, limit = 50): { a: number; b: number; given: number | null; ms: number; result: Result; asked_at: string; mode: Mode }[] {
  return database.prepare(`SELECT x.a, x.b, x.given, x.ms, x.result, x.asked_at, s.mode FROM tab_answers x JOIN tab_sessions s ON s.id = x.session_id
    WHERE x.member_id = ? AND x.operation = ? AND x.pa = ? AND x.pb = ? ORDER BY x.asked_at DESC, x.id DESC LIMIT ?`)
    .all(member, op, pa, pb, limit) as never;
}

export function sessionsOf(member: string, since: string | null, limit: number): SessionRow[] {
  return database.prepare(`SELECT * FROM tab_sessions WHERE member_id = ? AND started_at >= ? ORDER BY started_at DESC LIMIT ?`)
    .all(member, since ?? '', limit) as SessionRow[];
}

export function activeProgram(member: string): ProgramRow | null {
  return (database.prepare('SELECT * FROM tab_programs WHERE member_id = ? AND active = 1 ORDER BY id DESC LIMIT 1').get(member) as ProgramRow | undefined) ?? null;
}

export function programById(id: number): ProgramRow | null {
  return (database.prepare('SELECT * FROM tab_programs WHERE id = ?').get(id) as ProgramRow | undefined) ?? null;
}

/** Un nouveau programme remplace l'actif, qui reste en base, daté : l'historique ne se réécrit pas. */
export function setProgram(p: {
  memberId: string; operation: Operation; from: number; to: number; questions: number; secondsAllowed: number | null;
  fastSeconds: number | null; dailyGoal: number; bothDirections: boolean; setBy: string;
}, now = new Date().toISOString()): ProgramRow {
  return database.transaction(() => {
    database.prepare('UPDATE tab_programs SET active = 0 WHERE member_id = ? AND active = 1').run(p.memberId);
    const id = Number(database.prepare(`INSERT INTO tab_programs (member_id, operation, from_table, to_table, questions, seconds_allowed, fast_seconds,
      daily_goal, both_directions, set_by, set_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(p.memberId, p.operation, p.from, p.to, p.questions, p.secondsAllowed, p.fastSeconds, p.dailyGoal, p.bothDirections ? 1 : 0, p.setBy, now).lastInsertRowid);
    return programById(id)!;
  })();
}

/**
 * Recalcule toute la maîtrise d'un membre depuis ses réponses. `reclassify`,
 * s'il est donné, refait d'abord le résultat (bon, lent) de chaque réponse juste
 * avec le seuil rapide qu'il rend pour sa session : c'est le seul chemin qui
 * réécrit le passé, et il ne part que d'une commande explicite (tables:recalcul
 * --reclasser). Rend le nombre de couples et de réponses reclassées.
 */
export function recomputeMember(member: string, cfg: MasteryCfg, reclassify?: (s: SessionRow) => number): { pairs: number; reclassified: number } {
  return database.transaction(() => {
    let reclassified = 0;
    if (reclassify) {
      const upd = database.prepare('UPDATE tab_answers SET result = ? WHERE id = ?');
      const sessions = database.prepare('SELECT * FROM tab_sessions WHERE member_id = ?').all(member) as SessionRow[];
      for (const s of sessions) {
        const fast = reclassify(s);
        const rows = database.prepare('SELECT id, result, ms FROM tab_answers WHERE session_id = ?').all(s.id) as { id: number; result: Result; ms: number }[];
        let good = 0, slow = 0;
        for (const r of rows) {
          let res = r.result;
          if (res === 'bon' || res === 'lent') { res = r.ms <= fast ? 'bon' : 'lent'; if (res !== r.result) { upd.run(res, r.id); reclassified++; } }
          if (res === 'bon') good++; else if (res === 'lent') slow++;
        }
        database.prepare('UPDATE tab_sessions SET good = ?, slow = ?, fast_ms = ? WHERE id = ?').run(good, slow, fast, s.id);
      }
    }
    database.prepare('DELETE FROM tab_mastery WHERE member_id = ?').run(member);
    let pairs = 0;
    for (const op of ['multiplication', 'addition'] as const) {
      const list = database.prepare('SELECT DISTINCT pa, pb FROM tab_answers WHERE member_id = ? AND operation = ? AND counts = 1').all(member, op) as { pa: number; pb: number }[];
      recompute(member, op, list.map((r) => [r.pa, r.pb] as [number, number]), cfg);
      pairs += list.length;
    }
    return { pairs, reclassified };
  })();
}

/**
 * Ce que l'onglet Suivi résume depuis `since` : les sessions (le jour se compte
 * côté appelant, à l'heure de Paris), et, par table, les questions qui la
 * touchent (7 × 6 compte pour la table de 6 et pour celle de 7), justes et
 * rapides. Le mode Apprendre n'y entre pas : l'enfant y recopie la table.
 */
export function statsOf(member: string, op: Operation, since: string): {
  sessions: { started_at: string; mode: Mode; questions: number; good: number; slow: number; wrong: number }[];
  tables: { table: number; questions: number; correct: number; fast: number }[];
} {
  const sessions = database.prepare(`SELECT started_at, mode, questions, good, slow, wrong FROM tab_sessions
    WHERE member_id = ? AND started_at >= ? ORDER BY started_at`).all(member, since) as never;
  const rows = database.prepare(`SELECT pa, pb, result FROM tab_answers WHERE member_id = ? AND operation = ? AND counts = 1 AND asked_at >= ?`)
    .all(member, op, since) as { pa: number; pb: number; result: Result }[];
  const by = new Map<number, { table: number; questions: number; correct: number; fast: number }>();
  for (const r of rows) {
    for (const t of r.pa === r.pb ? [r.pa] : [r.pa, r.pb]) {
      const e = by.get(t) ?? { table: t, questions: 0, correct: 0, fast: 0 };
      e.questions++;
      if (r.result === 'bon' || r.result === 'lent') e.correct++;
      if (r.result === 'bon') e.fast++;
      by.set(t, e);
    }
  }
  return { sessions, tables: [...by.values()].sort((x, y) => x.table - y.table) };
}

/** Les membres qui ont des réponses : ce que balaie `tables:recalcul --tous`. */
export function membersWithAnswers(): string[] {
  return (database.prepare('SELECT DISTINCT member_id FROM tab_answers').all() as { member_id: string }[]).map((r) => r.member_id);
}
