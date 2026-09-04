import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { EMPTY_STATE } from './seed';
import { migrateFinances } from './finances/schema';
import { initFinancesRepo } from './finances/repo';
import { initBlobs, reportOrphansAtBoot } from './storage/blobs';
import { migrateHousehold, setStateVersion, stateVersion } from './storage/schema';
import * as files from './storage/files';
import { initShopping } from './shopping/repo';
import { initTasks } from './tasks/repo';
import { STATE_VERSION, fileStorer, migrateState } from './state/migrations';
import { log } from './log';

const DATA_DIR = process.env.FOYER_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.FOYER_DB_PATH || path.join(DATA_DIR, 'foyer.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// The finances tables rely on foreign keys (cascades, SET NULL); SQLite needs
// this enabled per connection. The legacy tables below declare none, so this is
// a no-op for them.
db.pragma('foreign_keys = ON');

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
// Migration: per-user token version, bumped to revoke all outstanding sessions
// (e.g. on password change or account removal).
try { db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0'); } catch { /* already present */ }

// The bytes of every module live next to the database, in the same data
// directory: one tar of DATA_DIR remains a complete backup.
initBlobs(DATA_DIR);

// Finances module: versioned schema, applied at boot and independent of the rest.
migrateFinances(db);
initFinancesRepo(db);

// Household-side tables (files, ops journals), then the document itself.
migrateHousehold(db);
files.initFiles(db);
initShopping(db);
initTasks(db);
migrateHouseholdDocument();

// Fichiers qu'aucune entité du document ne cite plus (recette supprimée, photo
// remplacée, formulaire abandonné). Le ménage se fait ici plutôt qu'à chaque
// enregistrement : une recette est sauvegardée vingt fois pendant qu'on la
// modifie, et se tromper de sens effacerait la photo qu'on vient de poser.
pruneUnreferencedFiles();

// Both attachment tables are registered by now: the sweep sees the whole disk.
reportOrphansAtBoot();

/**
 * Applique les migrations du document d'état, une fois, au démarrage.
 *
 * Le document d'origine est écrit dans <data>/backups avant la première
 * transformation : revenir en arrière consiste à remettre ce fichier en base
 * (procédure en commandes shell dans docs/cuisine-architecture.md). La lecture,
 * la transformation et l'écriture tiennent dans une transaction : une coupure
 * de courant au milieu laisse le document intact et la migration se rejoue au
 * démarrage suivant.
 */
function migrateHouseholdDocument(): void {
  const from = stateVersion(db);
  if (from >= STATE_VERSION) return;

  const row = db.prepare('SELECT state FROM household WHERE id = 1').get() as { state: string } | undefined;
  if (!row) {
    // Foyer pas encore créé : rien à transformer, mais la version est acquise,
    // le nouvel état naissant déjà à la bonne forme.
    setStateVersion(db, STATE_VERSION);
    return;
  }

  try {
    const doc = JSON.parse(row.state) as Record<string, unknown>;
    const outcome = migrateState(doc, from, {
      storeDataUrl: fileStorer((kind, ownerId, name, buf, type) => files.store(kind, ownerId || 'inconnu', name, buf, type).file.id),
    }, path.join(DATA_DIR, 'backups'));

    db.transaction(() => {
      db.prepare("UPDATE household SET state = ?, version = version + 1, updated_at = datetime('now') WHERE id = 1")
        .run(JSON.stringify(doc));
      setStateVersion(db, outcome.to);
    })();

    for (const m of outcome.applied) {
      log.info(`État : migration ${m.version} appliquée (${m.label}).`);
    }
    for (const note of outcome.notes) {
      log.info('État : ' + note);
    }
    if (outcome.backupPath) {
      log.info(`État : document d'origine sauvegardé dans ${outcome.backupPath}`);
    }
  } catch (e) {
    log.erreur(
      `ERREUR : la migration du document d'état a échoué : ${(e as Error).message}\n` +
      `        Le document reste en version ${stateVersion(db)}, il n'a pas été réécrit.\n` +
      `        Une copie d'origine se trouve dans ${path.join(DATA_DIR, 'backups')} si la sauvegarde avait eu lieu.\n` +
      "        Restaurez-la si nécessaire (voir docs/cuisine-architecture.md) et signalez l'erreur.",
    );
    throw e;
  }
}

/**
 * Retire les fichiers que le document ne désigne plus. Ne fait rien tant qu'un
 * foyer n'a pas été créé : sur une base vierge, « rien n'est référencé » veut
 * dire « rien n'est encore écrit », surtout pas « tout est à effacer ».
 */
function pruneUnreferencedFiles(): void {
  const row = db.prepare('SELECT state FROM household WHERE id = 1').get() as { state: string } | undefined;
  if (!row) return;
  try {
    const doc = JSON.parse(row.state) as { recipes?: { photoId?: number | null }[]; files?: { fileId?: number | null }[] };
    const referenced = new Set<number>();
    for (const r of doc.recipes || []) if (typeof r.photoId === 'number') referenced.add(r.photoId);
    for (const f of doc.files || []) if (typeof f.fileId === 'number') referenced.add(f.fileId);
    const removed = files.pruneUnreferenced(referenced);
    if (removed) {
      log.info(`Fichiers : ${removed} fichier(s) sans propriétaire retiré(s).`);
    }
  } catch (e) {
    // Un document illisible est un problème à signaler, pas une raison de
    // supprimer des fichiers au jugé.
    log.attention('Fichiers : ménage ignoré, document d’état illisible : ' + (e as Error).message);
  }
}

export function countUsers(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
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
  if (password !== undefined) {
    // Changing the password revokes every previously issued token for this user.
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
      .run(bcrypt.hashSync(password, 10), id);
  }
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
  token_version: number;
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
  if (!row) return { state: EMPTY_STATE, version: 1 };
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

// ---- ICS calendar sharing ----
export function getIcsToken(): string | null {
  const row = db.prepare('SELECT ics_token FROM household WHERE id = 1').get() as { ics_token: string | null } | undefined;
  return row?.ics_token || null;
}
export function setIcsToken(token: string): void {
  const info = db.prepare('UPDATE household SET ics_token = ? WHERE id = 1').run(token);
  if (info.changes === 0) db.prepare('INSERT INTO household (id, state, version, ics_token) VALUES (1, ?, 1, ?)').run(JSON.stringify(EMPTY_STATE), token);
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
