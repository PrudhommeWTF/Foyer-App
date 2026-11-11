// Accès aux données du module « Atelier code ». Chaque fonction prend le membre
// concerné : ce sont les routes qui décident qui a le droit de le nommer.
//
// Les octets des médias sont des fichiers du magasin commun (storage/files.ts,
// genre gardé « atelier ») ; ici ne vivent que leurs noms et leurs propriétaires.
import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import * as files from '../storage/files';
import { DetectedType } from '../storage/blobs';

let database: Database;
export function initAtelierRepo(db: Database): void { database = db; }

export const LEVELS = ['petits'] as const;
export type Level = typeof LEVELS[number];
export const ASSET_KINDS = ['personnage', 'decor'] as const;
export type AssetKind = typeof ASSET_KINDS[number];

export interface ProjectRow {
  id: string; member_id: string; level: Level; name: string; json: string | null; thumbnail_json: string | null; editor_version: string | null;
  version: number; is_sample: number; copied_from: string | null; created_at: string; updated_at: string; archived_at: string | null;
}
export interface MediaRow { id: number; member_id: string; name: string; mime: string; size: number; file_id: number; created_at: string; }
export interface AssetRow {
  id: number; member_id: string; kind: AssetKind; md5: string; altmd5: string | null; name: string | null; scale: string | null;
  width: string | null; height: string | null; ext: string | null; editor_version: string | null; created_at: string; archived_at: string | null;
}

const now = (): string => new Date().toISOString();

// ---- Projets ----------------------------------------------------------------

/** Sans le JSON : une liste de cent projets n'a pas à peser dix mégaoctets. */
const LIST_COLUMNS = 'id, member_id, level, name, thumbnail_json, editor_version, version, is_sample, copied_from, created_at, updated_at, archived_at';

export function projectsOf(memberId: string, archived = false): ProjectRow[] {
  return database.prepare(`SELECT ${LIST_COLUMNS}, NULL AS json FROM atl_projects WHERE member_id = ? AND archived_at IS ${archived ? 'NOT NULL' : 'NULL'} ORDER BY updated_at DESC`)
    .all(memberId) as ProjectRow[];
}
export function countProjects(memberId: string): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM atl_projects WHERE member_id = ? AND archived_at IS NULL').get(memberId) as { n: number }).n;
}
export function getProject(id: string): ProjectRow | null {
  return (database.prepare('SELECT * FROM atl_projects WHERE id = ?').get(id) as ProjectRow | undefined) ?? null;
}
export function createProject(memberId: string, level: Level, name: string, from?: ProjectRow): ProjectRow {
  const id = crypto.randomUUID(), at = now();
  database.prepare(`INSERT INTO atl_projects (id, member_id, level, name, json, thumbnail_json, editor_version, copied_from, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, memberId, level, name, from?.json ?? null, from?.thumbnail_json ?? null, from?.editor_version ?? null, from?.id ?? null, at, at);
  return getProject(id)!;
}
export interface ProjectSave { name: string; json: string; thumbnailJson: string | null; editorVersion: string | null; }
/**
 * Enregistre si `version` est bien celle que le serveur détient, et l'incrémente.
 * Rend null sinon : un autre appareil a enregistré entre-temps, à l'appelant de
 * le dire plutôt que d'écraser.
 */
export function saveProject(id: string, version: number, s: ProjectSave): ProjectRow | null {
  const info = database.prepare(`UPDATE atl_projects SET name = ?, json = ?, thumbnail_json = ?, editor_version = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND version = ? AND archived_at IS NULL`).run(s.name, s.json, s.thumbnailJson, s.editorVersion, now(), id, version);
  return info.changes ? getProject(id) : null;
}
export function renameProject(id: string, name: string): void {
  database.prepare('UPDATE atl_projects SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id);
}
export function archiveProject(id: string): void {
  database.prepare('UPDATE atl_projects SET archived_at = ? WHERE id = ? AND archived_at IS NULL').run(now(), id);
}
export function restoreProject(id: string): void {
  database.prepare('UPDATE atl_projects SET archived_at = NULL WHERE id = ?').run(id);
}

// ---- Médias -----------------------------------------------------------------

export function getMedia(memberId: string, name: string): MediaRow | null {
  return (database.prepare('SELECT * FROM atl_media WHERE member_id = ? AND name = ?').get(memberId, name) as MediaRow | undefined) ?? null;
}
export function usedBytes(memberId: string): number {
  return (database.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM atl_media WHERE member_id = ?').get(memberId) as { n: number }).n;
}
/**
 * Range un média et rend son nom : l'empreinte md5 **du contenu gardé**, suivie
 * de l'extension. Le nom vient donc toujours du serveur, jamais de l'appareil.
 * Deux envois du même contenu rendent le même nom, sans second fichier.
 */
export function putMedia(memberId: string, buf: Buffer, type: DetectedType): { media: MediaRow; existed: boolean } {
  const name = crypto.createHash('md5').update(buf).digest('hex') + type.ext;
  const known = getMedia(memberId, name);
  if (known) return { media: known, existed: true };
  const { file } = files.storeOnce('atelier', 'atl', name, buf, type);
  database.prepare('INSERT INTO atl_media (member_id, name, mime, size, file_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(memberId, name, type.mime, buf.length, file.id, now());
  return { media: getMedia(memberId, name)!, existed: false };
}
/** Un projet, une vignette ou un élément de « mes personnages » du membre cite-t-il encore ce média ? */
export function mediaReferenced(memberId: string, name: string): boolean {
  const like = `%${name}%`;
  return !!database.prepare('SELECT 1 FROM atl_projects WHERE member_id = ? AND (json LIKE ? OR thumbnail_json LIKE ?) LIMIT 1').get(memberId, like, like)
    || !!database.prepare('SELECT 1 FROM atl_assets WHERE member_id = ? AND (md5 = ? OR altmd5 = ?) LIMIT 1').get(memberId, name, name);
}
/** Retire un média, et son fichier du disque quand plus aucun membre ne le détient. */
export function removeMedia(m: MediaRow): void {
  database.prepare('DELETE FROM atl_media WHERE id = ?').run(m.id);
  const left = database.prepare('SELECT 1 FROM atl_media WHERE file_id = ? LIMIT 1').get(m.file_id);
  if (!left) files.remove(m.file_id);
}
/** Les fichiers que le module détient : le ménage du démarrage ne doit pas les prendre pour des orphelins. */
export function referencedFileIds(): number[] {
  return (database.prepare('SELECT DISTINCT file_id FROM atl_media').all() as { file_id: number }[]).map((r) => r.file_id);
}

// ---- Mes personnages, mes décors -------------------------------------------------

export function assetsOf(memberId: string, kind: AssetKind): AssetRow[] {
  return database.prepare('SELECT * FROM atl_assets WHERE member_id = ? AND kind = ? AND archived_at IS NULL ORDER BY id DESC').all(memberId, kind) as AssetRow[];
}
export function getAsset(id: number): AssetRow | null {
  return (database.prepare('SELECT * FROM atl_assets WHERE id = ?').get(id) as AssetRow | undefined) ?? null;
}
export type AssetInput = Pick<AssetRow, 'md5' | 'altmd5' | 'name' | 'scale' | 'width' | 'height' | 'ext' | 'editor_version'>;
export function addAsset(memberId: string, kind: AssetKind, a: AssetInput): AssetRow {
  const info = database.prepare(`INSERT INTO atl_assets (member_id, kind, md5, altmd5, name, scale, width, height, ext, editor_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(memberId, kind, a.md5, a.altmd5, a.name, a.scale, a.width, a.height, a.ext, a.editor_version, now());
  return getAsset(Number(info.lastInsertRowid))!;
}
export function archiveAsset(id: number): void {
  database.prepare('UPDATE atl_assets SET archived_at = ? WHERE id = ? AND archived_at IS NULL').run(now(), id);
}

// ---- Corbeille --------------------------------------------------------------

/**
 * Retire pour de bon les projets archivés depuis plus de `days` jours, puis les
 * médias que plus rien ne cite chez les membres concernés. C'est la seule
 * suppression définitive du module.
 */
export function purgeArchived(days: number): { projects: number; media: number } {
  const limit = new Date(Date.now() - days * 86400000).toISOString();
  const old = database.prepare('SELECT id, member_id FROM atl_projects WHERE archived_at IS NOT NULL AND archived_at < ?').all(limit) as { id: string; member_id: string }[];
  if (!old.length) return { projects: 0, media: 0 };
  let media = 0;
  database.transaction(() => {
    for (const p of old) database.prepare('DELETE FROM atl_projects WHERE id = ?').run(p.id);
    for (const memberId of new Set(old.map((p) => p.member_id))) {
      for (const m of database.prepare('SELECT * FROM atl_media WHERE member_id = ?').all(memberId) as MediaRow[]) {
        if (!mediaReferenced(memberId, m.name)) { removeMedia(m); media++; }
      }
    }
  })();
  return { projects: old.length, media };
}

// ---- Module -----------------------------------------------------------------

export function moduleCounts(): { projets: number; medias: number } {
  const n = (sql: string): number => (database.prepare(sql).get() as { n: number }).n;
  return { projets: n('SELECT COUNT(*) AS n FROM atl_projects'), medias: n('SELECT COUNT(*) AS n FROM atl_media') };
}
/** Remise à zéro du module : tout part, fichiers compris. */
export function resetModule(): void {
  const ids = referencedFileIds();
  database.transaction(() => { for (const t of ['atl_projects', 'atl_media', 'atl_assets']) database.exec(`DELETE FROM ${t}`); })();
  for (const id of ids) files.remove(id);
}
