// Lecture et écriture brutes du document d'état, pour les sous-arbres qui
// s'écrivent par opérations (courses, tâches).
//
// Le document reste unique et dans une seule ligne SQLite : une archive du
// répertoire de données demeure une sauvegarde complète. Ce qui change pour ces
// sous-arbres, c'est le chemin d'écriture, pas l'endroit.
import type { Database } from 'better-sqlite3';

let database: Database;

export function initDoc(db: Database): void { database = db; }

/** La base, pour les journaux d'opérations qui vivent à côté du document. */
export function docDb(): Database { return database; }

export type Doc = Record<string, any>;

interface HouseholdRow { state: string; version: number }

export function readDoc(): { doc: Doc; version: number } {
  const row = database.prepare('SELECT state, version FROM household WHERE id = 1').get() as HouseholdRow | undefined;
  if (!row) return { doc: {}, version: 0 };
  return { doc: JSON.parse(row.state), version: row.version };
}

export function writeDoc(doc: unknown): number {
  database.prepare("UPDATE household SET state = ?, version = version + 1, updated_at = datetime('now') WHERE id = 1")
    .run(JSON.stringify(doc));
  return (database.prepare('SELECT version FROM household WHERE id = 1').get() as { version: number }).version;
}

/** Les identifiants d'une collection du document, en ensemble. */
export const idsOf = (doc: Doc, key: string): Set<string> =>
  new Set((Array.isArray(doc[key]) ? doc[key] : []).map((x: any) => String(x?.id ?? '')));
