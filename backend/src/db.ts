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
`);

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
