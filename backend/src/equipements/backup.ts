// Sauvegarde, restauration et remise à zéro du seul module « Équipements »,
// calquées sur employes/backup.ts. Ce n'est pas un remplacement de l'archive
// complète (base + répertoire `pieces`) : c'est l'outil du cas précis, rejouer
// une manipulation qui a mal tourné sans toucher au reste du foyer.
//
// Les octets des factures et photos ne voyagent **pas** dans ce fichier : ils
// restent dans `pieces/`, adressés par leur empreinte, et l'archive complète les
// emporte. La sauvegarde porte la liste des fichiers (nom, type, empreinte) ; la
// restauration les reconnaît sur le disque par leur empreinte, quel que soit
// l'identifiant qu'ils avaient ailleurs, et dit combien manquent.
import type { Database } from 'better-sqlite3';
import { EQP_SCHEMA_VERSION, seedRooms } from './schema';
import * as files from '../storage/files';
import { blobPath, relPathFor, releaseBlob } from '../storage/blobs';
import { log } from '../log';

let database: Database;
export function initBackup(db: Database): void { database = db; }

/** Tables du module, dans l'ordre des dépendances. */
const TABLES = ['eqp_rooms', 'eqp_items', 'eqp_attachments', 'eqp_events'] as const;

interface FileEntry { id: number; name: string; mime: string; size: number; sha256: string; ext: string; }

export interface ModuleBackup {
  format: 1;
  schemaVersion: number;
  generatedAt: string;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
  /** Les fichiers cités par eqp_attachments.file_id, sans leurs octets. */
  files: FileEntry[];
}

const extOf = (relPath: string): string => { const m = /(\.[a-z0-9]+)$/i.exec(relPath); return m ? m[1] : ''; };

export function exportModule(generatedAt = new Date().toISOString()): ModuleBackup {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = database.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
    tables[t] = rows;
    counts[t] = rows.length;
  }
  const fileRows = database.prepare(`
    SELECT id, name, mime, size, sha256, rel_path FROM hh_attachments
    WHERE id IN (SELECT DISTINCT file_id FROM eqp_attachments)
  `).all() as (Omit<FileEntry, 'ext'> & { rel_path: string })[];
  return {
    format: 1, schemaVersion: EQP_SCHEMA_VERSION, generatedAt, counts, tables,
    files: fileRows.map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, sha256: f.sha256, ext: extOf(f.rel_path) })),
  };
}

export class RestoreRefused extends Error {}

export interface RestoreReport {
  before: Record<string, number>;
  after: Record<string, number>;
  ignoredColumns: { table: string; columns: string[] }[];
  /** Fichiers cités par la sauvegarde mais absents de `pieces/` : à restaurer depuis l'archive complète. */
  missingFiles: string[];
}

const counts = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = (database.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return out;
};

/** Les lignes de fichier du module, retirées avec leurs octets quand plus rien ne les réclame. */
function dropModuleFiles(): void {
  const ids = (database.prepare("SELECT id FROM hh_attachments WHERE owner_kind = 'equipment'").all() as { id: number }[]).map((r) => r.id);
  for (const id of ids) files.remove(id);
}

/**
 * Remplace les données du module par celles de la sauvegarde. Tout ou rien pour
 * les tables. Une sauvegarde plus récente que le schéma en place est refusée.
 */
export function restoreModule(backup: unknown): RestoreReport {
  const b = backup as Partial<ModuleBackup>;
  if (!b || typeof b !== 'object') throw new RestoreRefused('Fichier illisible : ce n’est pas une sauvegarde du module Équipements.');
  if (b.format !== 1) throw new RestoreRefused('Format de sauvegarde inconnu. Ce fichier ne vient pas de ce module.');
  if (typeof b.schemaVersion !== 'number' || !b.tables) throw new RestoreRefused('Sauvegarde incomplète : version de schéma ou données manquantes.');
  if (b.schemaVersion > EQP_SCHEMA_VERSION) {
    throw new RestoreRefused(`Cette sauvegarde vient d'une version plus récente du module (schéma ${b.schemaVersion} contre ${EQP_SCHEMA_VERSION} ici). Mettez Foyer à jour avant de la restaurer.`);
  }
  for (const t of TABLES) {
    if (b.tables[t] !== undefined && !Array.isArray(b.tables[t])) throw new RestoreRefused(`Sauvegarde corrompue : la table « ${t} » n'est pas une liste.`);
  }
  if (b.files !== undefined && !Array.isArray(b.files)) throw new RestoreRefused('Sauvegarde corrompue : la liste des fichiers n’en est pas une.');

  const before = counts();
  const ignoredColumns: { table: string; columns: string[] }[] = [];
  const missingFiles: string[] = [];
  // Les anciennes lignes de fichier partent avec les tables, mais leurs octets
  // restent sur le disque jusqu'après l'écriture : la sauvegarde cite souvent
  // exactement les mêmes, et les effacer d'abord les perdrait.
  const previous = database.prepare("SELECT rel_path, sha256 FROM hh_attachments WHERE owner_kind = 'equipment'").all() as { rel_path: string; sha256: string }[];

  database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');
    for (const t of [...TABLES].reverse()) database.prepare(`DELETE FROM ${t}`).run();
    database.prepare("DELETE FROM hh_attachments WHERE owner_kind = 'equipment'").run();

    // Les fichiers d'abord : leur identifiant d'ici n'est pas celui de la
    // sauvegarde (une photo de recette peut déjà l'occuper). On le retrouve.
    const fileIds = new Map<number, number>();
    const ins = database.prepare("INSERT INTO hh_attachments (owner_kind, owner_id, name, mime, size, sha256, rel_path) VALUES ('equipment', 'eqp', ?, ?, ?, ?, ?)");
    for (const f of (b.files || []) as FileEntry[]) {
      if (!f || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256) || typeof f.id !== 'number') continue;
      const ext = typeof f.ext === 'string' && /^(\.[a-z0-9]{1,5})?$/i.test(f.ext) ? f.ext : '';
      const rel = relPathFor(f.sha256, ext);
      if (!blobPath(rel)) missingFiles.push(String(f.name || f.sha256));
      const info = ins.run(String(f.name || 'fichier').slice(0, 200), String(f.mime || 'application/octet-stream'), Number(f.size) || 0, f.sha256, rel);
      fileIds.set(f.id, Number(info.lastInsertRowid));
    }

    for (const t of TABLES) {
      let rows = (b.tables![t] || []) as Record<string, unknown>[];
      if (t === 'eqp_attachments') {
        rows = rows.filter((r) => fileIds.has(r['file_id'] as number)).map((r) => ({ ...r, file_id: fileIds.get(r['file_id'] as number) }));
      }
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

  for (const p of previous) releaseBlob(p.rel_path, p.sha256);
  const after = counts();
  if (ignoredColumns.length) {
    log.attention('Restauration (équipements) : colonnes ignorées, absentes du schéma actuel : '
      + ignoredColumns.map((i) => `${i.table} (${i.columns.join(', ')})`).join(' ; '));
  }
  if (missingFiles.length) {
    log.attention(`Restauration (équipements) : ${missingFiles.length} fichier(s) absent(s) du répertoire « pieces ». `
      + `Restaurez-le depuis l’archive complète. Exemple : ${missingFiles[0]}`);
  }
  return { before, after, ignoredColumns, missingFiles };
}

/** Le nombre de lignes par table : pour dire ce qu'un « repartir à zéro » effacerait. */
export function moduleCounts(): Record<string, number> { return counts(); }

/**
 * Efface toutes les données du module (tables eqp_*, et les fichiers qui ne
 * servaient qu'à lui), puis repose les pièces de départ. Rend le décompte d'avant.
 */
export function resetModule(): Record<string, number> {
  const before = counts();
  database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');
    for (const t of [...TABLES].reverse()) database.prepare(`DELETE FROM ${t}`).run();
    dropModuleFiles();
    seedRooms(database);
  })();
  return before;
}
