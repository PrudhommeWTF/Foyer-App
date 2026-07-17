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

/** Seed the single household document and a demo admin user on first boot. */
export function bootstrap(): void {
  const row = db.prepare('SELECT COUNT(*) AS n FROM household').get() as { n: number };
  if (row.n === 0) {
    db.prepare('INSERT INTO household (id, state, version) VALUES (1, ?, 1)').run(JSON.stringify(SEED_STATE));
  }

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (userCount.n === 0) {
    const email = (process.env.FOYER_ADMIN_EMAIL || 'camille.martin@email.fr').toLowerCase();
    const password = process.env.FOYER_ADMIN_PASSWORD || 'foyer';
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (email, password_hash, name, member_id) VALUES (?, ?, ?, ?)').run(
      email, hash, 'Camille', 'cam',
    );
    // eslint-disable-next-line no-console
    console.log(`[foyer] Compte initial créé : ${email} / ${password} (à changer via FOYER_ADMIN_*)`);
  }
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
