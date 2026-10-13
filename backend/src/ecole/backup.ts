// Sauvegarde et restauration du seul module « École », calquées sur celles du
// module Employés. L'instantané de la base entière (Paramètres, Exploitation)
// emporte déjà les tables ed_* ; ceci sert à déménager ou rejouer le module
// seul.
//
// Les colonnes chiffrées voyagent chiffrées. Restaurées sur un serveur dont la
// clé FOYER_SECRET_KEY diffère, elles ne se rouvrent pas : le compte passe en
// « identifiants à ressaisir » à sa prochaine connexion, rien ne plante.
import type { Database } from 'better-sqlite3';
import { ED_SCHEMA_VERSION } from './schema';
import { log } from '../log';

let database: Database;
export function initBackup(db: Database): void { database = db; }

/** Tables du module, dans l'ordre des dépendances. `ed_meta` absente : la version voyage dans l'en-tête. */
const TABLES = ['ed_accounts', 'ed_students', 'ed_sync_log', 'ed_homework', 'ed_lessons', 'ed_grades', 'ed_averages', 'ed_life'] as const;

export interface ModuleBackup {
  format: 1;
  module: 'ecole';
  schemaVersion: number;
  generatedAt: string;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
}

const counts = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = (database.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return out;
};

export function exportModule(generatedAt = new Date().toISOString()): ModuleBackup {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) tables[t] = database.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
  return { format: 1, module: 'ecole', schemaVersion: ED_SCHEMA_VERSION, generatedAt, counts: counts(), tables };
}

export class RestoreRefused extends Error {}

/** Remplace les données du module par celles de la sauvegarde. Tout ou rien. */
export function restoreModule(backup: unknown): { before: Record<string, number>; after: Record<string, number> } {
  const b = backup as Partial<ModuleBackup>;
  if (!b || typeof b !== 'object' || b.format !== 1 || b.module !== 'ecole') throw new RestoreRefused('Ce fichier n’est pas une sauvegarde du module École.');
  if (typeof b.schemaVersion !== 'number' || !b.tables) throw new RestoreRefused('Sauvegarde incomplète : version de schéma ou données manquantes.');
  if (b.schemaVersion > ED_SCHEMA_VERSION) {
    throw new RestoreRefused(`Cette sauvegarde vient d’une version plus récente du module (schéma ${b.schemaVersion} contre ${ED_SCHEMA_VERSION} ici). Mettez Foyer à jour avant de la restaurer.`);
  }
  for (const t of TABLES) {
    if (b.tables[t] !== undefined && !Array.isArray(b.tables[t])) throw new RestoreRefused(`Sauvegarde corrompue : la table « ${t} » n’est pas une liste.`);
  }
  const before = counts();
  const ignored: string[] = [];
  database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');
    for (const t of [...TABLES].reverse()) database.prepare(`DELETE FROM ${t}`).run();
    for (const t of TABLES) {
      const rows = (b.tables![t] || []) as Record<string, unknown>[];
      if (!rows.length) continue;
      const known = new Set((database.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
      const columns = Object.keys(rows[0]).filter((c) => known.has(c));
      ignored.push(...Object.keys(rows[0]).filter((c) => !known.has(c)).map((c) => `${t}.${c}`));
      if (!columns.length) throw new RestoreRefused(`Sauvegarde inexploitable : aucune colonne connue dans « ${t} ».`);
      const stmt = database.prepare(`INSERT INTO ${t} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
      for (const row of rows) stmt.run(...columns.map((c) => row[c] ?? null));
    }
  })();
  if (ignored.length) log.attention('Restauration (école) : colonnes ignorées, absentes du schéma actuel : ' + ignored.join(', '));
  return { before, after: counts() };
}

/** Le nombre de lignes par table : pour dire ce qu'un « repartir à zéro » effacerait. */
export function moduleCounts(): Record<string, number> { return counts(); }

/** Efface toutes les données du module, secrets compris. Rend le décompte d'avant. */
export function resetModule(): Record<string, number> {
  const before = counts();
  database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');
    for (const t of [...TABLES].reverse()) database.prepare(`DELETE FROM ${t}`).run();
  })();
  return before;
}
