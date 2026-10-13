// Accès aux tables du module « École ». Rien ici ne parle à ÉcoleDirecte : le
// service (service.ts) appelle le client puis écrit ici ; les routes ne lisent
// qu'ici. Les colonnes chiffrées ne quittent ce fichier que vers le service,
// jamais vers une réponse HTTP (voir `accountView` dans routes.ts).
import type { Database } from 'better-sqlite3';
import { initBackup } from './backup';

let database: Database;
export function initEcoleRepo(db: Database): void {
  database = db;
  initBackup(db);
}

export type Blocked = 'qcm' | 'identifiants' | 'version' | 'cle';
export type LinkState = 'propose' | 'confirme' | 'ignore' | 'aucun';
export interface PendingQcm { question: string; propositions: string[]; askedAt: string; }

export interface Account {
  id: number; label: string;
  loginEnc: string | null; passwordEnc: string | null; credsSetAt: string | null;
  accountType: string | null; edUserId: number | null;
  trustedCnEnc: string | null; trustedCvEnc: string | null; trustedAt: string | null;
  pendingQcm: PendingQcm | null;
  enabled: boolean; blocked: Blocked | null; blockedDetail: string | null;
  lastSyncAt: string | null; lastSyncOk: boolean | null; lastOkAt: string | null;
  lastErrorAt: string | null; lastErrorCode: number | null; lastErrorKind: string | null; lastErrorMessage: string | null;
  consecutiveFailures: number; pausedUntil: string | null; alertSentAt: string | null;
  createdAt: string; archivedAt: string | null;
}

export interface Student {
  id: number; accountId: number; edStudentId: number; idLogin: number | null;
  firstName: string; lastName: string; className: string; schoolName: string;
  memberId: string | null; matchSource: 'prenom' | 'manuel' | null; linkState: LinkState;
  modules: string[]; createdAt: string; lastSeenAt: string | null; archivedAt: string | null;
  /** La liste « Devoirs de … » du document, une fois créée. */
  taskListId: string | null;
  /** Déjeune à la cantine (la pause de midi compte comme une absence du foyer). */
  halfBoard: boolean;
  dataOkAt: string | null; dataError: string | null; dataErrorAt: string | null;
  /** La première lecture (muette) des devoirs, des notes, de la vie scolaire a eu lieu. */
  homeworkBaselineAt: string | null; gradesBaselineAt: string | null; lifeBaselineAt: string | null;
}

export interface LogLine {
  id: number; accountId: number | null; at: string; scope: string; ok: boolean;
  httpStatus: number | null; edCode: number | null; message: string; durationMs: number | null;
}

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v == null ? null : String(v));
const n = (v: unknown): number | null => (v == null ? null : Number(v));

const accountRow = (r: Row): Account => ({
  id: r['id'] as number, label: r['label'] as string,
  loginEnc: s(r['login_enc']), passwordEnc: s(r['password_enc']), credsSetAt: s(r['creds_set_at']),
  accountType: s(r['account_type']), edUserId: n(r['ed_user_id']),
  trustedCnEnc: s(r['trusted_cn_enc']), trustedCvEnc: s(r['trusted_cv_enc']), trustedAt: s(r['trusted_at']),
  pendingQcm: (() => { try { return r['pending_qcm'] ? JSON.parse(String(r['pending_qcm'])) as PendingQcm : null; } catch { return null; } })(),
  enabled: !!r['enabled'], blocked: s(r['blocked']) as Blocked | null, blockedDetail: s(r['blocked_detail']),
  lastSyncAt: s(r['last_sync_at']), lastSyncOk: r['last_sync_ok'] == null ? null : !!r['last_sync_ok'], lastOkAt: s(r['last_ok_at']),
  lastErrorAt: s(r['last_error_at']), lastErrorCode: n(r['last_error_code']), lastErrorKind: s(r['last_error_kind']), lastErrorMessage: s(r['last_error_message']),
  consecutiveFailures: Number(r['consecutive_failures'] || 0), pausedUntil: s(r['paused_until']), alertSentAt: s(r['alert_sent_at']),
  createdAt: r['created_at'] as string, archivedAt: s(r['archived_at']),
});

const studentRow = (r: Row): Student => ({
  id: r['id'] as number, accountId: r['account_id'] as number, edStudentId: r['ed_student_id'] as number, idLogin: n(r['id_login']),
  firstName: String(r['ed_first_name'] ?? ''), lastName: String(r['ed_last_name'] ?? ''),
  className: String(r['class_name'] ?? ''), schoolName: String(r['school_name'] ?? ''),
  memberId: s(r['member_id']), matchSource: s(r['match_source']) as Student['matchSource'], linkState: (r['link_state'] as LinkState) || 'aucun',
  modules: (() => { try { const m = JSON.parse(String(r['modules_json'] || '[]')); return Array.isArray(m) ? m.map(String) : []; } catch { return []; } })(),
  createdAt: r['created_at'] as string, lastSeenAt: s(r['last_seen_at']), archivedAt: s(r['archived_at']),
  taskListId: s(r['task_list_id']), halfBoard: r['half_board'] == null ? true : !!r['half_board'],
  dataOkAt: s(r['data_ok_at']), dataError: s(r['data_error']), dataErrorAt: s(r['data_error_at']),
  homeworkBaselineAt: s(r['homework_baseline_at']), gradesBaselineAt: s(r['grades_baseline_at']), lifeBaselineAt: s(r['life_baseline_at']),
});

// ---- Comptes --------------------------------------------------------------

export function listAccounts(includeArchived = false): Account[] {
  return (database.prepare(`SELECT * FROM ed_accounts ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY id`).all() as Row[]).map(accountRow);
}

export function getAccount(id: number): Account | null {
  const r = database.prepare('SELECT * FROM ed_accounts WHERE id = ?').get(id) as Row | undefined;
  return r ? accountRow(r) : null;
}

export function createAccount(label: string, loginEnc: string, passwordEnc: string, now: string): number {
  return Number(database.prepare('INSERT INTO ed_accounts (label, login_enc, password_enc, creds_set_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(label, loginEnc, passwordEnc, now, now).lastInsertRowid);
}

/** Les colonnes qu'on peut écrire, sous leur nom d'objet. Une liste fermée : jamais un nom de colonne venu d'ailleurs. */
const COLUMNS = {
  label: 'label', loginEnc: 'login_enc', passwordEnc: 'password_enc', credsSetAt: 'creds_set_at',
  accountType: 'account_type', edUserId: 'ed_user_id',
  trustedCnEnc: 'trusted_cn_enc', trustedCvEnc: 'trusted_cv_enc', trustedAt: 'trusted_at',
  pendingQcm: 'pending_qcm', enabled: 'enabled', blocked: 'blocked', blockedDetail: 'blocked_detail',
  lastSyncAt: 'last_sync_at', lastSyncOk: 'last_sync_ok', lastOkAt: 'last_ok_at',
  lastErrorAt: 'last_error_at', lastErrorCode: 'last_error_code', lastErrorKind: 'last_error_kind', lastErrorMessage: 'last_error_message',
  consecutiveFailures: 'consecutive_failures', pausedUntil: 'paused_until', alertSentAt: 'alert_sent_at', archivedAt: 'archived_at',
} as const;
export type AccountPatch = Partial<{ -readonly [K in keyof typeof COLUMNS]: K extends 'pendingQcm' ? PendingQcm | null : K extends 'enabled' | 'lastSyncOk' ? boolean | null : string | number | null }>;

export function patchAccount(id: number, patch: AccountPatch): void {
  const keys = Object.keys(patch).filter((k): k is keyof typeof COLUMNS => k in COLUMNS);
  if (!keys.length) return;
  const vals = keys.map((k) => {
    const v = patch[k];
    if (k === 'pendingQcm') return v ? JSON.stringify(v) : null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? null;
  });
  database.prepare(`UPDATE ed_accounts SET ${keys.map((k) => COLUMNS[k] + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...vals, new Date().toISOString(), id);
}

/**
 * Retire un compte : ses secrets sont effacés (pas seulement masqués), le
 * compte et ses élèves sont archivés, l'historique reste lisible.
 */
export function archiveAccount(id: number, now: string): void {
  database.transaction(() => {
    patchAccount(id, { loginEnc: null, passwordEnc: null, trustedCnEnc: null, trustedCvEnc: null, pendingQcm: null, archivedAt: now, enabled: false });
    database.prepare('UPDATE ed_students SET archived_at = COALESCE(archived_at, ?) WHERE account_id = ?').run(now, id);
  })();
}

// ---- Élèves ---------------------------------------------------------------

export function listStudents(includeArchived = false): Student[] {
  return (database.prepare(`SELECT * FROM ed_students ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY account_id, id`).all() as Row[]).map(studentRow);
}

export function getStudent(id: number): Student | null {
  const r = database.prepare('SELECT * FROM ed_students WHERE id = ?').get(id) as Row | undefined;
  return r ? studentRow(r) : null;
}

export function studentByEdId(accountId: number, edStudentId: number): Student | null {
  const r = database.prepare('SELECT * FROM ed_students WHERE account_id = ? AND ed_student_id = ?').get(accountId, edStudentId) as Row | undefined;
  return r ? studentRow(r) : null;
}

export interface SeenStudent { edStudentId: number; idLogin: number; firstName: string; lastName: string; className: string; schoolName: string; modules: string[]; }

/** Un élève vu à la connexion : créé, ou mis à jour (et désarchivé). L'association n'est jamais touchée ici. */
export function upsertSeenStudent(accountId: number, e: SeenStudent, now: string): Student {
  database.prepare(`
    INSERT INTO ed_students (account_id, ed_student_id, id_login, ed_first_name, ed_last_name, class_name, school_name, modules_json, last_seen_at)
    VALUES (@accountId, @edStudentId, @idLogin, @firstName, @lastName, @className, @schoolName, @modules, @now)
    ON CONFLICT (account_id, ed_student_id) DO UPDATE SET
      id_login = excluded.id_login, ed_first_name = excluded.ed_first_name, ed_last_name = excluded.ed_last_name,
      class_name = excluded.class_name, school_name = excluded.school_name, modules_json = excluded.modules_json,
      last_seen_at = excluded.last_seen_at, archived_at = NULL
  `).run({ accountId, ...e, modules: JSON.stringify(e.modules), now });
  return studentByEdId(accountId, e.edStudentId)!;
}

/** Les élèves d'un compte qu'ÉcoleDirecte ne renvoie plus : archivés, jamais effacés. */
export function archiveMissingStudents(accountId: number, seenEdIds: number[], now: string): number {
  const all = (database.prepare('SELECT id, ed_student_id FROM ed_students WHERE account_id = ? AND archived_at IS NULL').all(accountId) as Row[]);
  const gone = all.filter((r) => !seenEdIds.includes(r['ed_student_id'] as number));
  const stmt = database.prepare('UPDATE ed_students SET archived_at = ? WHERE id = ?');
  for (const r of gone) stmt.run(now, r['id']);
  return gone.length;
}

export function setLink(studentId: number, memberId: string | null, matchSource: Student['matchSource'], linkState: LinkState): void {
  database.prepare('UPDATE ed_students SET member_id = ?, match_source = ?, link_state = ? WHERE id = ?').run(memberId, matchSource, linkState, studentId);
}

const STUDENT_COLUMNS = {
  taskListId: 'task_list_id', halfBoard: 'half_board', dataOkAt: 'data_ok_at', dataError: 'data_error', dataErrorAt: 'data_error_at',
  homeworkBaselineAt: 'homework_baseline_at', gradesBaselineAt: 'grades_baseline_at', lifeBaselineAt: 'life_baseline_at',
} as const;
export type StudentPatch = Partial<{ -readonly [K in keyof typeof STUDENT_COLUMNS]: K extends 'halfBoard' ? boolean : string | null }>;

export function patchStudent(id: number, patch: StudentPatch): void {
  const keys = Object.keys(patch).filter((k): k is keyof typeof STUDENT_COLUMNS => k in STUDENT_COLUMNS);
  if (!keys.length) return;
  const vals = keys.map((k) => { const v = patch[k]; return typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null; });
  database.prepare(`UPDATE ed_students SET ${keys.map((k) => STUDENT_COLUMNS[k] + ' = ?').join(', ')} WHERE id = ?`).run(...vals, id);
}

// ---- Devoirs --------------------------------------------------------------

export interface Homework {
  id: number; studentId: number; edId: number; due: string;
  subject: string; subjectCode: string; teacher: string;
  contentHtml: string; contentText: string; contentHash: string | null;
  isTest: boolean; online: boolean; givenOn: string | null;
  doneEd: boolean; doneSynced: boolean | null; doneLocal: boolean | null;
  doneSentAt: string | null; doneError: string | null;
  taskId: string | null; taskDroppedAt: string | null; detailAt: string | null;
 firstSeenAt: string; lastSeenAt: string; modifiedAt: string | null; archivedAt: string | null;
  notifiedAt: string | null;
}

const b = (v: unknown): boolean | null => (v == null ? null : !!v);
const homeworkRow = (r: Row): Homework => ({
  id: r['id'] as number, studentId: r['student_id'] as number, edId: r['ed_id'] as number, due: r['due_date'] as string,
  subject: String(r['subject'] ?? ''), subjectCode: String(r['subject_code'] ?? ''), teacher: String(r['teacher'] ?? ''),
  contentHtml: String(r['content_html'] ?? ''), contentText: String(r['content_text'] ?? ''), contentHash: s(r['content_hash']),
  isTest: !!r['is_test'], online: !!r['online'], givenOn: s(r['given_on']),
  doneEd: !!r['done_ed'], doneSynced: b(r['done_synced']), doneLocal: b(r['done_local']),
  doneSentAt: s(r['done_sent_at']), doneError: s(r['done_error']),
  taskId: s(r['task_id']), taskDroppedAt: s(r['task_dropped_at']), detailAt: s(r['detail_at']),
  firstSeenAt: r['first_seen_at'] as string, lastSeenAt: r['last_seen_at'] as string, modifiedAt: s(r['modified_at']), archivedAt: s(r['archived_at']),
  notifiedAt: s(r['notified_at']),
});

export function getHomework(id: number): Homework | null {
  const r = database.prepare('SELECT * FROM ed_homework WHERE id = ?').get(id) as Row | undefined;
  return r ? homeworkRow(r) : null;
}

/** Les devoirs d'élèves donnés, entre deux dates de rendu incluses. Les archivés seulement sur demande. */
export function listHomework(studentIds: number[], from: string, to: string, includeArchived = false): Homework[] {
  if (!studentIds.length) return [];
  return (database.prepare(`SELECT * FROM ed_homework WHERE student_id IN (${studentIds.map(() => '?').join(',')})
    AND due_date BETWEEN ? AND ? ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY due_date, subject, id`)
    .all(...studentIds, from, to) as Row[]).map(homeworkRow);
}

export interface HomeworkSeen { edId: number; due: string; subject: string; subjectCode: string; givenOn: string; done: boolean; isTest: boolean; online: boolean; }

/**
 * Un devoir vu dans la liste du cahier de textes : créé, ou mis à jour (et
 * désarchivé). À la création, l'état « fait » d'ÉcoleDirecte est le point
 * d'accord de départ (`done_synced`). Rend la ligne et si elle est neuve.
 */
export function upsertHomework(studentId: number, h: HomeworkSeen, now: string): { row: Homework; created: boolean } {
  const before = database.prepare('SELECT id FROM ed_homework WHERE student_id = ? AND ed_id = ?').get(studentId, h.edId) as Row | undefined;
  if (before) {
    database.prepare(`UPDATE ed_homework SET due_date = ?, subject = ?, subject_code = ?, given_on = ?, done_ed = ?, is_test = ?, online = ?,
      last_seen_at = ?, archived_at = NULL WHERE id = ?`)
      .run(h.due, h.subject, h.subjectCode, h.givenOn || null, h.done ? 1 : 0, h.isTest ? 1 : 0, h.online ? 1 : 0, now, before['id']);
    return { row: getHomework(before['id'] as number)!, created: false };
  }
  const id = Number(database.prepare(`INSERT INTO ed_homework (student_id, ed_id, due_date, subject, subject_code, given_on, done_ed, done_synced, is_test, online, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(studentId, h.edId, h.due, h.subject, h.subjectCode, h.givenOn || null, h.done ? 1 : 0, h.done ? 1 : 0, h.isTest ? 1 : 0, h.online ? 1 : 0, now, now).lastInsertRowid);
  return { row: getHomework(id)!, created: true };
}

const HW_COLUMNS = {
  teacher: 'teacher', contentHtml: 'content_html', contentText: 'content_text', contentHash: 'content_hash', detailAt: 'detail_at',
  doneSynced: 'done_synced', doneLocal: 'done_local', doneSentAt: 'done_sent_at', doneError: 'done_error',
  taskId: 'task_id', taskDroppedAt: 'task_dropped_at', modifiedAt: 'modified_at', archivedAt: 'archived_at', notifiedAt: 'notified_at',
} as const;
export type HomeworkPatch = Partial<{ -readonly [K in keyof typeof HW_COLUMNS]: K extends 'doneSynced' | 'doneLocal' ? boolean | null : string | null }>;

export function patchHomework(id: number, patch: HomeworkPatch): void {
  const keys = Object.keys(patch).filter((k): k is keyof typeof HW_COLUMNS => k in HW_COLUMNS);
  if (!keys.length) return;
  const vals = keys.map((k) => { const v = patch[k]; return typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null; });
  database.prepare(`UPDATE ed_homework SET ${keys.map((k) => HW_COLUMNS[k] + ' = ?').join(', ')} WHERE id = ?`).run(...vals, id);
}

/** Les devoirs de la fenêtre qu'ÉcoleDirecte ne renvoie plus : archivés (datés), jamais effacés. */
export function archiveMissingHomework(studentId: number, seenEdIds: number[], from: string, to: string, now: string): number {
  const rows = database.prepare('SELECT id, ed_id FROM ed_homework WHERE student_id = ? AND due_date BETWEEN ? AND ? AND archived_at IS NULL').all(studentId, from, to) as Row[];
  const seen = new Set(seenEdIds);
  const gone = rows.filter((r) => !seen.has(r['ed_id'] as number));
  const stmt = database.prepare('UPDATE ed_homework SET archived_at = ? WHERE id = ?');
  for (const r of gone) stmt.run(now, r['id']);
  return gone.length;
}

// ---- Emploi du temps ------------------------------------------------------

export interface Lesson {
  id: number; studentId: number; edId: number; day: string; start: string; end: string;
  subject: string; teacher: string; room: string; kind: string; cancelled: boolean; modified: boolean;
}
export interface LessonSeen { edId: number; day: string; start: string; end: string; subject: string; teacher: string; room: string; kind: string; cancelled: boolean; modified: boolean; }

/**
 * Remplace la vue d'une période par ce qu'ÉcoleDirecte vient d'en dire : upsert
 * de chaque cours, archivage de ceux qui ont disparu. Une seule transaction.
 */
export function syncLessons(studentId: number, lessons: LessonSeen[], from: string, to: string, now: string): { upserted: number; archived: number } {
  let archived = 0;
  database.transaction(() => {
    const up = database.prepare(`INSERT INTO ed_lessons (student_id, ed_id, day, start, end, subject, teacher, room, kind, cancelled, modified, first_seen_at, last_seen_at)
      VALUES (@studentId, @edId, @day, @start, @end, @subject, @teacher, @room, @kind, @cancelled, @modified, @now, @now)
      ON CONFLICT (student_id, ed_id, day) DO UPDATE SET start = excluded.start, end = excluded.end, subject = excluded.subject,
        teacher = excluded.teacher, room = excluded.room, kind = excluded.kind, cancelled = excluded.cancelled, modified = excluded.modified,
        last_seen_at = excluded.last_seen_at, archived_at = NULL`);
    for (const l of lessons) up.run({ studentId, ...l, cancelled: l.cancelled ? 1 : 0, modified: l.modified ? 1 : 0, now });
    archived = database.prepare('UPDATE ed_lessons SET archived_at = ? WHERE student_id = ? AND day BETWEEN ? AND ? AND archived_at IS NULL AND last_seen_at <> ?')
      .run(now, studentId, from, to, now).changes;
  })();
  return { upserted: lessons.length, archived };
}

export function listLessons(studentIds: number[], from: string, to: string): Lesson[] {
  if (!studentIds.length) return [];
  return (database.prepare(`SELECT * FROM ed_lessons WHERE student_id IN (${studentIds.map(() => '?').join(',')}) AND day BETWEEN ? AND ? AND archived_at IS NULL ORDER BY day, start`)
    .all(...studentIds, from, to) as Row[]).map((r) => ({
    id: r['id'] as number, studentId: r['student_id'] as number, edId: r['ed_id'] as number, day: r['day'] as string,
    start: r['start'] as string, end: r['end'] as string, subject: String(r['subject'] ?? ''), teacher: String(r['teacher'] ?? ''),
    room: String(r['room'] ?? ''), kind: String(r['kind'] ?? ''), cancelled: !!r['cancelled'], modified: !!r['modified'],
  }));
}

// ---- Notes, moyennes, vie scolaire ----------------------------------------

export interface Grade {
  id: number; studentId: number; edId: number; date: string | null; subject: string; subjectCode: string; label: string; kind: string;
  valueRaw: string; valueNum: number | null; outOf: string; coefficient: string; classAverage: string; classMin: string; classMax: string;
  periodCode: string; notSignificant: boolean; firstSeenAt: string; notifiedAt: string | null;
}
export interface GradeSeen {
  edId: number; date: string; subject: string; subjectCode: string; label: string; kind: string; valueRaw: string; valueNum: number | null;
  outOf: string; coefficient: string; classAverage: string; classMin: string; classMax: string; periodCode: string; notSignificant: boolean;
}
const gradeRow = (r: Row): Grade => ({
  id: r['id'] as number, studentId: r['student_id'] as number, edId: r['ed_id'] as number, date: s(r['date']),
  subject: String(r['subject'] ?? ''), subjectCode: String(r['subject_code'] ?? ''), label: String(r['label'] ?? ''), kind: String(r['kind'] ?? ''),
  valueRaw: String(r['value_raw'] ?? ''), valueNum: n(r['value_num']), outOf: String(r['out_of'] ?? ''), coefficient: String(r['coefficient'] ?? ''),
  classAverage: String(r['class_average'] ?? ''), classMin: String(r['class_min'] ?? ''), classMax: String(r['class_max'] ?? ''),
  periodCode: String(r['period_code'] ?? ''), notSignificant: !!r['not_significant'], firstSeenAt: r['first_seen_at'] as string, notifiedAt: s(r['notified_at']),
});

/**
 * Les notes lues : upsert, jamais d'effacement. `silent` (première lecture de
 * l'élève) les marque d'emblée notifiées. Rend les nouvelles lignes non notifiées.
 */
export function upsertGrades(studentId: number, grades: GradeSeen[], schoolYear: string, now: string, silent: boolean): Grade[] {
  const fresh: number[] = [];
  database.transaction(() => {
    const exists = database.prepare('SELECT id FROM ed_grades WHERE student_id = ? AND ed_id = ?');
    const ins = database.prepare(`INSERT INTO ed_grades (student_id, ed_id, date, subject, subject_code, label, kind, value_raw, value_num, out_of, coefficient,
      class_average, class_min, class_max, period_code, not_significant, school_year, first_seen_at, last_seen_at, notified_at)
      VALUES (@studentId, @edId, @date, @subject, @subjectCode, @label, @kind, @valueRaw, @valueNum, @outOf, @coefficient,
      @classAverage, @classMin, @classMax, @periodCode, @ns, @schoolYear, @now, @now, @notified)`);
    const upd = database.prepare(`UPDATE ed_grades SET date = @date, subject = @subject, subject_code = @subjectCode, label = @label, kind = @kind,
      value_raw = @valueRaw, value_num = @valueNum, out_of = @outOf, coefficient = @coefficient, class_average = @classAverage,
      class_min = @classMin, class_max = @classMax, period_code = @periodCode, not_significant = @ns, last_seen_at = @now WHERE id = @id`);
    for (const g of grades) {
      const row = exists.get(studentId, g.edId) as Row | undefined;
      const p = { ...g, date: g.date || null, ns: g.notSignificant ? 1 : 0, now };
      if (row) upd.run({ ...p, id: row['id'] });
      else {
        const id = Number(ins.run({ ...p, studentId, schoolYear, notified: silent ? now : null }).lastInsertRowid);
        if (!silent) fresh.push(id);
      }
    }
  })();
  return fresh.map((id) => gradeRow(database.prepare('SELECT * FROM ed_grades WHERE id = ?').get(id) as Row));
}

export function listGrades(studentId: number, limit: number): Grade[] {
  return (database.prepare('SELECT * FROM ed_grades WHERE student_id = ? ORDER BY date DESC, id DESC LIMIT ?').all(studentId, limit) as Row[]).map(gradeRow);
}

export interface Average {
  periodCode: string; periodLabel: string; periodFrom: string | null; periodTo: string | null; closed: boolean;
  subjectCode: string; subject: string; average: string; classAverage: string; classMin: string; classMax: string; coefficient: string;
}
export type AverageSeen = Omit<Average, 'periodFrom' | 'periodTo'> & { periodFrom: string; periodTo: string };

/** Les moyennes, telles qu'ÉcoleDirecte les renvoie : la dernière lecture remplace la précédente, ligne à ligne. */
export function saveAverages(studentId: number, averages: AverageSeen[], now: string): void {
  const up = database.prepare(`INSERT INTO ed_averages (student_id, period_code, period_label, period_from, period_to, closed, subject_code, subject,
      average, class_average, class_min, class_max, coefficient, updated_at)
    VALUES (@studentId, @periodCode, @periodLabel, @periodFrom, @periodTo, @closed, @subjectCode, @subject, @average, @classAverage, @classMin, @classMax, @coefficient, @now)
    ON CONFLICT (student_id, period_code, subject_code) DO UPDATE SET period_label = excluded.period_label, period_from = excluded.period_from,
      period_to = excluded.period_to, closed = excluded.closed, subject = excluded.subject, average = excluded.average,
      class_average = excluded.class_average, class_min = excluded.class_min, class_max = excluded.class_max, coefficient = excluded.coefficient,
      updated_at = excluded.updated_at`);
  database.transaction(() => {
    for (const a of averages) up.run({ studentId, ...a, periodFrom: a.periodFrom || null, periodTo: a.periodTo || null, closed: a.closed ? 1 : 0, now });
  })();
}

export function listAverages(studentId: number): Average[] {
  return (database.prepare('SELECT * FROM ed_averages WHERE student_id = ? ORDER BY period_from, period_code, subject_code = \'_GENERALE\' DESC, subject').all(studentId) as Row[]).map((r) => ({
    periodCode: r['period_code'] as string, periodLabel: String(r['period_label'] ?? ''), periodFrom: s(r['period_from']), periodTo: s(r['period_to']),
    closed: !!r['closed'], subjectCode: r['subject_code'] as string, subject: String(r['subject'] ?? ''), average: String(r['average'] ?? ''),
    classAverage: String(r['class_average'] ?? ''), classMin: String(r['class_min'] ?? ''), classMax: String(r['class_max'] ?? ''), coefficient: String(r['coefficient'] ?? ''),
  }));
}

export interface LifeItem {
  id: number; studentId: number; edId: number; kind: 'absence' | 'retard' | 'sanction' | 'encouragement'; date: string | null; displayDate: string;
  label: string; reason: string; justified: boolean | null; by: string; comment: string; firstSeenAt: string; notifiedAt: string | null;
}
export type LifeSeen = Omit<LifeItem, 'id' | 'studentId' | 'firstSeenAt' | 'notifiedAt' | 'date'> & { date: string };
const lifeRow = (r: Row): LifeItem => ({
  id: r['id'] as number, studentId: r['student_id'] as number, edId: r['ed_id'] as number, kind: r['kind'] as LifeItem['kind'], date: s(r['date']),
  displayDate: String(r['display_date'] ?? ''), label: String(r['label'] ?? ''), reason: String(r['reason'] ?? ''),
  justified: r['justified'] == null ? null : !!r['justified'], by: String(r['given_by'] ?? ''), comment: String(r['comment'] ?? ''),
  firstSeenAt: r['first_seen_at'] as string, notifiedAt: s(r['notified_at']),
});

/** Comme les notes : upsert, première lecture muette, rend les nouvelles lignes à notifier. Une justification qui arrive après coup met la ligne à jour. */
export function upsertLife(studentId: number, items: LifeSeen[], now: string, silent: boolean): LifeItem[] {
  const fresh: number[] = [];
  database.transaction(() => {
    const exists = database.prepare('SELECT id FROM ed_life WHERE student_id = ? AND kind = ? AND ed_id = ?');
    for (const e of items) {
      const p = { studentId, edId: e.edId, kind: e.kind, date: e.date || null, displayDate: e.displayDate, label: e.label, reason: e.reason,
        justified: e.justified === null ? null : e.justified ? 1 : 0, by: e.by, comment: e.comment, now };
      const row = exists.get(studentId, e.kind, e.edId) as Row | undefined;
      if (row) {
        database.prepare(`UPDATE ed_life SET date = @date, display_date = @displayDate, label = @label, reason = @reason, justified = @justified,
          given_by = @by, comment = @comment, last_seen_at = @now WHERE id = @id`).run({ ...p, id: row['id'] });
      } else {
        const id = Number(database.prepare(`INSERT INTO ed_life (student_id, ed_id, kind, date, display_date, label, reason, justified, given_by, comment, first_seen_at, last_seen_at, notified_at)
          VALUES (@studentId, @edId, @kind, @date, @displayDate, @label, @reason, @justified, @by, @comment, @now, @now, @notified)`).run({ ...p, notified: silent ? now : null }).lastInsertRowid);
        if (!silent) fresh.push(id);
      }
    }
  })();
  return fresh.map((id) => lifeRow(database.prepare('SELECT * FROM ed_life WHERE id = ?').get(id) as Row));
}

export function listLife(studentId: number, from: string): LifeItem[] {
  return (database.prepare('SELECT * FROM ed_life WHERE student_id = ? AND (date IS NULL OR date >= ?) ORDER BY date DESC, id DESC').all(studentId, from) as Row[]).map(lifeRow);
}

/** Marque des lignes notifiées : la table est l'une des trois du module, jamais une saisie. */
export function markNotified(table: 'ed_grades' | 'ed_life' | 'ed_homework', ids: number[], now: string): void {
  const stmt = database.prepare(`UPDATE ${table} SET notified_at = ? WHERE id = ?`);
  database.transaction(() => { for (const id of ids) stmt.run(now, id); })();
}

// ---- Journal --------------------------------------------------------------

const KEEP_LOG = 2000;

export function addLog(e: Omit<LogLine, 'id' | 'at'> & { at?: string }): void {
  database.prepare('INSERT INTO ed_sync_log (account_id, at, scope, ok, http_status, ed_code, message, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(e.accountId, e.at || new Date().toISOString(), e.scope, e.ok ? 1 : 0, e.httpStatus, e.edCode, e.message, e.durationMs);
  database.prepare('DELETE FROM ed_sync_log WHERE id <= (SELECT MAX(id) FROM ed_sync_log) - ?').run(KEEP_LOG);
}

export function listLog(limit = 30, accountId?: number): LogLine[] {
  const rows = (accountId
    ? database.prepare('SELECT * FROM ed_sync_log WHERE account_id = ? ORDER BY id DESC LIMIT ?').all(accountId, limit)
    : database.prepare('SELECT * FROM ed_sync_log ORDER BY id DESC LIMIT ?').all(limit)) as Row[];
  return rows.map((r) => ({
    id: r['id'] as number, accountId: n(r['account_id']), at: r['at'] as string, scope: r['scope'] as string, ok: !!r['ok'],
    httpStatus: n(r['http_status']), edCode: n(r['ed_code']), message: String(r['message'] ?? ''), durationMs: n(r['duration_ms']),
  }));
}
