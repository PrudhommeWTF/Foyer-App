// Sauvegarde et restauration du seul module Finances.
//
// Ce n'est **pas** un remplacement de la sauvegarde du fichier SQLite, qui reste
// la référence et qui, elle, emporte tout. C'est l'outil du cas précis : rejouer
// une manipulation qui a mal tourné, ou déménager les finances vers une autre
// instance, sans toucher au reste du foyer.
//
// La restauration écrase. Elle est donc transactionnelle, refuse ce qu'elle ne
// comprend pas, et exige une confirmation explicite dans la requête.
import type { Database } from 'better-sqlite3';
import { FIN_SCHEMA_VERSION } from './schema';
import { log } from '../log';

let database: Database;
export function initBackup(db: Database): void { database = db; }

/**
 * Tables du module, dans l'ordre des dépendances. `fin_meta` en est absente :
 * la version de schéma voyage dans l'en-tête, pas dans les données.
 */
const TABLES = [
  'fin_accounts', 'fin_account_aliases', 'fin_account_members', 'fin_categories',
  'fin_assets', 'fin_contracts', 'fin_contract_refs', 'fin_contract_members',
  'fin_imports', 'fin_import_coverage',
  'fin_transactions', 'fin_tags', 'fin_transaction_tags',
  'fin_readings', 'fin_rules', 'fin_rule_conditions', 'fin_rule_actions',
  'fin_savings', 'fin_attachments',
] as const;

export interface ModuleBackup {
  /** Format de l'enveloppe, indépendant du schéma SQL. */
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
  return { format: 1, schemaVersion: FIN_SCHEMA_VERSION, generatedAt, counts, tables };
}

export class RestoreRefused extends Error {}

export interface RestoreReport {
  /** Ce qui était là avant, pour pouvoir constater ce qui a été remplacé. */
  before: Record<string, number>;
  after: Record<string, number>;
  /** Pièces jointes référencées par la sauvegarde. Les octets, eux, sont sur le disque. */
  attachments: number;
  /**
   * Colonnes présentes dans la sauvegarde mais absentes du schéma actuel, donc
   * ignorées. Les taire ferait perdre une donnée sans que personne le sache :
   * une sauvegarde d'avant la migration 4 porte par exemple `member_id`, dont le
   * contenu vit désormais dans une table dédiée.
   */
  ignoredColumns: { table: string; columns: string[] }[];
}

const counts = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = (database.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return out;
};

/**
 * Remplace les données du module par celles de la sauvegarde. Tout ou rien.
 *
 * Une sauvegarde plus **récente** que le schéma en place est refusée : elle peut
 * porter des colonnes que cette version ne connaît pas, et les perdre en silence
 * serait pire que refuser. L'inverse est accepté, les migrations du module étant
 * additives : une vieille sauvegarde se relit, les colonnes ajoutées depuis
 * prennent leur valeur par défaut.
 */
export function restoreModule(backup: unknown): RestoreReport {
  const b = backup as Partial<ModuleBackup>;
  if (!b || typeof b !== 'object') throw new RestoreRefused('Fichier illisible : ce n’est pas une sauvegarde du module Finances.');
  if (b.format !== 1) throw new RestoreRefused('Format de sauvegarde inconnu. Ce fichier ne vient pas de ce module.');
  if (typeof b.schemaVersion !== 'number' || !b.tables) {
    throw new RestoreRefused('Sauvegarde incomplète : version de schéma ou données manquantes.');
  }
  if (b.schemaVersion > FIN_SCHEMA_VERSION) {
    throw new RestoreRefused(
      `Cette sauvegarde vient d'une version plus récente du module (schéma ${b.schemaVersion} contre ${FIN_SCHEMA_VERSION} ici). `
      + 'Mettez Foyer à jour avant de la restaurer.',
    );
  }
  for (const t of TABLES) {
    if (b.tables[t] !== undefined && !Array.isArray(b.tables[t])) {
      throw new RestoreRefused(`Sauvegarde corrompue : la table « ${t} » n'est pas une liste.`);
    }
  }

  const before = counts();
  const ignoredColumns: { table: string; columns: string[] }[] = [];

  database.transaction(() => {
    // Les contraintes sont vérifiées au commit et non ligne à ligne : l'ordre
    // d'insertion n'a plus à être parfait, mais une sauvegarde incohérente est
    // toujours refusée en bloc.
    database.pragma('defer_foreign_keys = ON');
    for (const t of [...TABLES].reverse()) database.prepare(`DELETE FROM ${t}`).run();

    for (const t of TABLES) {
      const rows = (b.tables![t] || []) as Record<string, unknown>[];
      if (!rows.length) continue;
      // Colonnes réellement présentes dans ce schéma : une sauvegarde plus
      // ancienne en a moins, et une colonne inconnue ferait échouer l'INSERT.
      const known = new Set((database.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
      const columns = Object.keys(rows[0]).filter((c) => known.has(c));
      const dropped = Object.keys(rows[0]).filter((c) => !known.has(c));
      if (dropped.length) ignoredColumns.push({ table: t, columns: dropped });
      if (!columns.length) throw new RestoreRefused(`Sauvegarde inexploitable : aucune colonne connue dans « ${t} ».`);
      const stmt = database.prepare(
        `INSERT INTO ${t} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      );
      for (const row of rows) stmt.run(...columns.map((c) => row[c] ?? null));
    }
  })();

  const after = counts();
  if (ignoredColumns.length) {
    log.attention('Restauration : colonnes ignorées, absentes du schéma actuel : '
      + ignoredColumns.map((i) => `${i.table} (${i.columns.join(', ')})`).join(' ; '));
  }
  return { before, after, attachments: after['fin_attachments'], ignoredColumns };
}
