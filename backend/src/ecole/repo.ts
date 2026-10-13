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
