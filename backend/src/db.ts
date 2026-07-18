import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { SEED_STATE } from './seed';

const DATA_DIR = process.env.FOYER_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.FOYER_DB_PATH || path.join(DATA_DIR, 'foyer.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    member_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS household (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS school_holidays_cache (
    academie TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`);

// Migration: ICS calendar-sharing token (ignored if the column already exists).
try { db.exec('ALTER TABLE household ADD COLUMN ics_token TEXT'); } catch { /* already present */ }

export function countUsers(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

/**
 * First-boot behaviour.
 * By default a fresh database stays EMPTY so the first-run onboarding wizard can
 * create the household, the admin account and the members. Set FOYER_SEED_DEMO=true
 * to instead pre-load the demo dataset + a demo admin (quick trial / old behaviour).
 * Existing databases (that already have users) are never touched.
 */
export function bootstrap(): void {
  const seedDemo = /^(1|true|yes|on)$/i.test(process.env.FOYER_SEED_DEMO || '');
  if (!seedDemo) return;

  const hh = db.prepare('SELECT COUNT(*) AS n FROM household').get() as { n: number };
  if (hh.n === 0) {
    db.prepare('INSERT INTO household (id, state, version) VALUES (1, ?, 1)').run(JSON.stringify(SEED_STATE));
  }
  if (countUsers() === 0) {
    const email = (process.env.FOYER_ADMIN_EMAIL || 'camille.martin@email.fr').toLowerCase();
    const password = process.env.FOYER_ADMIN_PASSWORD || 'foyer';
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (email, password_hash, name, member_id) VALUES (?, ?, ?, ?)').run(email, hash, 'Camille', 'cam');
    // eslint-disable-next-line no-console
    console.log(`[foyer] (démo) Compte initial : ${email} / ${password}`);
  }
}

export function createUserWithMember(email: string, password: string, name: string, memberId: string): UserRow {
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, name, member_id) VALUES (?, ?, ?, ?)')
    .run(email.toLowerCase(), hash, name, memberId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow;
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function getUserByMemberId(memberId: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE member_id = ?').get(memberId) as UserRow | undefined;
}

/** memberId → login email, for every member that has an account. */
export function listMemberAccounts(): { memberId: string; email: string }[] {
  return db.prepare("SELECT member_id AS memberId, email FROM users WHERE member_id IS NOT NULL").all() as { memberId: string; email: string }[];
}

export function updateUserCredentials(id: number, email?: string, password?: string): void {
  if (email !== undefined) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.toLowerCase(), id);
  if (password !== undefined) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
}

export function deleteUser(id: number): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  member_id: string | null;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
}

export function createUser(email: string, password: string, name: string): UserRow {
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run(email.toLowerCase(), hash, name);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow;
}

export function getHousehold(): { state: unknown; version: number } {
  const row = db.prepare('SELECT state, version FROM household WHERE id = 1').get() as
    | { state: string; version: number }
    | undefined;
  if (!row) return { state: SEED_STATE, version: 1 };
  return { state: JSON.parse(row.state), version: row.version };
}

export function saveHousehold(state: unknown): { version: number } {
  const info = db
    .prepare("UPDATE household SET state = ?, version = version + 1, updated_at = datetime('now') WHERE id = 1")
    .run(JSON.stringify(state));
  if (info.changes === 0) {
    db.prepare('INSERT INTO household (id, state, version) VALUES (1, ?, 1)').run(JSON.stringify(state));
    return { version: 1 };
  }
  const row = db.prepare('SELECT version FROM household WHERE id = 1').get() as { version: number };
  return { version: row.version };
}

export function resetHousehold(): { version: number } {
  return saveHousehold(SEED_STATE);
}

// ---- ICS calendar sharing ----
export function getIcsToken(): string | null {
  const row = db.prepare('SELECT ics_token FROM household WHERE id = 1').get() as { ics_token: string | null } | undefined;
  return row?.ics_token || null;
}
export function setIcsToken(token: string): void {
  const info = db.prepare('UPDATE household SET ics_token = ? WHERE id = 1').run(token);
  if (info.changes === 0) db.prepare('INSERT INTO household (id, state, version, ics_token) VALUES (1, ?, 1, ?)').run(JSON.stringify(SEED_STATE), token);
}
export function getStateByIcsToken(token: string): unknown | null {
  if (!token) return null;
  const row = db.prepare('SELECT state FROM household WHERE ics_token = ?').get(token) as { state: string } | undefined;
  return row ? JSON.parse(row.state) : null;
}

// ---- School-holidays cache ----
export function getSchoolHolidaysCache(academie: string): { data: unknown; fetchedAt: number } | null {
  const row = db.prepare('SELECT data, fetched_at AS fetchedAt FROM school_holidays_cache WHERE academie = ?').get(academie) as { data: string; fetchedAt: number } | undefined;
  return row ? { data: JSON.parse(row.data), fetchedAt: row.fetchedAt } : null;
}
export function setSchoolHolidaysCache(academie: string, data: unknown, fetchedAt: number): void {
  db.prepare('INSERT INTO school_holidays_cache (academie, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(academie) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at')
    .run(academie, JSON.stringify(data), fetchedAt);
}
