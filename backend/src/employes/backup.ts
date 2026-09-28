// Sauvegarde et restauration du seul module « Employé à domicile », calquée sur
// finances/backup.ts. Ce n'est pas un remplacement du snapshot du fichier SQLite
// (qui, lui, emporte tout) : c'est l'outil du cas précis, rejouer une manip qui
// a mal tourné ou déménager le module, sans toucher au reste du foyer. La
// restauration écrase : transactionnelle, refuse ce qu'elle ne comprend pas.
import type { Database } from 'better-sqlite3';
import { EMP_SCHEMA_VERSION } from './schema';
import { log } from '../log';

let database: Database;
export function initBackup(db: Database): void { database = db; }

/** Tables du module, dans l'ordre des dépendances. `emp_meta` absente : la version voyage dans l'en-tête. */
const TABLES = ['emp_employees', 'emp_rates', 'emp_shifts', 'emp_months'] as const;

export interface ModuleBackup {
  format: 1;
  schemaVersion: number;
  generatedAt: string;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
}

export function exportModule(generatedAt = new Date().toISOString()): ModuleBackup {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = database.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
    tables[t] = rows;
    counts[t] = rows.length;
  }
  return { format: 1, schemaVersion: EMP_SCHEMA_VERSION, generatedAt, counts, tables };
}

export class RestoreRefused extends Error {}

export interface RestoreReport {
  before: Record<string, number>;
  after: Record<string, number>;
  ignoredColumns: { table: string; columns: string[] }[];
}

const counts = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = (database.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return out;
};

/**
 * Remplace les données du module par celles de la sauvegarde. Tout ou rien. Une
 * sauvegarde plus récente que le schéma en place est refusée (elle peut porter
 * des colonnes inconnues, les perdre en silence serait pire) ; l'inverse est
 * accepté, les migrations étant additives.
 */
export function restoreModule(backup: unknown): RestoreReport {
  const b = backup as Partial<ModuleBackup>;
  if (!b || typeof b !== 'object') throw new RestoreRefused('Fichier illisible : ce n’est pas une sauvegarde du module Employé à domicile.');
  if (b.format !== 1) throw new RestoreRefused('Format de sauvegarde inconnu. Ce fichier ne vient pas de ce module.');
  if (typeof b.schemaVersion !== 'number' || !b.tables) throw new RestoreRefused('Sauvegarde incomplète : version de schéma ou données manquantes.');
  if (b.schemaVersion > EMP_SCHEMA_VERSION) {
    throw new RestoreRefused(
      `Cette sauvegarde vient d'une version plus récente du module (schéma ${b.schemaVersion} contre ${EMP_SCHEMA_VERSION} ici). Mettez Foyer à jour avant de la restaurer.`,
    );
  }
  for (const t of TABLES) {
    if (b.tables[t] !== undefined && !Array.isArray(b.tables[t])) throw new RestoreRefused(`Sauvegarde corrompue : la table « ${t} » n'est pas une liste.`);
  }

  const before = counts();
  const ignoredColumns: { table: string; columns: string[] }[] = [];

  database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');
    for (const t of [...TABLES].reverse()) database.prepare(`DELETE FROM ${t}`).run();
    for (const t of TABLES) {
      const rows = (b.tables![t] || []) as Record<string, unknown>[];
      if (!rows.length) continue;
      const known = new Set((database.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
      const columns = Object.keys(rows[0]).filter((c) => known.has(c));
      const dropped = Object.keys(rows[0]).filter((c) => !known.has(c));
      if (dropped.length) ignoredColumns.push({ table: t, columns: dropped });
      if (!columns.length) throw new RestoreRefused(`Sauvegarde inexploitable : aucune colonne connue dans « ${t} ».`);
      const stmt = database.prepare(`INSERT INTO ${t} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
      for (const row of rows) stmt.run(...columns.map((c) => row[c] ?? null));
    }
  })();

  const after = counts();
  if (ignoredColumns.length) {
    log.attention('Restauration (employés) : colonnes ignorées, absentes du schéma actuel : '
      + ignoredColumns.map((i) => `${i.table} (${i.columns.join(', ')})`).join(' ; '));
  }
  return { before, after, ignoredColumns };
}
