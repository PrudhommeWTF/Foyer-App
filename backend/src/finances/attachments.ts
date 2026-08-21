// Pièces jointes du module Finances : les métadonnées dans SQLite, les octets
// dans le magasin partagé du foyer (voir storage/blobs.ts, qui porte désormais
// le raisonnement d'origine sur le stockage disque et la déduplication).
import type { Database } from 'better-sqlite3';
import {
  ACCEPTED_LABEL, DetectedType, blobPath, detectType,
  registerHolder, releaseBlob, writeBlob,
} from '../storage/blobs';

export { ACCEPTED_LABEL, detectType };
export type { DetectedType };

let database: Database;

export function initAttachments(db: Database): void {
  database = db;
  // Le magasin ne sait pas qui référence quoi : cette table le lui dit, pour la
  // déduplication comme pour le balayage des orphelins au démarrage.
  registerHolder({
    label: 'Finances/pièces jointes',
    countBySha: (sha) => (database.prepare('SELECT COUNT(*) AS n FROM fin_attachments WHERE sha256 = ?').get(sha) as { n: number }).n,
    referencedPaths: () => (database.prepare('SELECT rel_path, name FROM fin_attachments').all() as { rel_path: string; name: string }[])
      .map((r) => ({ relPath: r.rel_path, name: r.name })),
  });
}

/** What a piece can be attached to. A future module adds its own kind here. */
export type OwnerKind = 'contract' | 'asset' | 'transaction';
export const OWNER_KINDS: OwnerKind[] = ['contract', 'asset', 'transaction'];

export interface Attachment {
  id: number;
  ownerKind: OwnerKind;
  ownerId: number;
  /** Name as the user knows it. Never used to build a path. */
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
}

interface Row {
  id: number; owner_kind: OwnerKind; owner_id: number; name: string;
  mime: string; size: number; sha256: string; rel_path: string; created_at: string;
}

const toAttachment = (r: Row): Attachment => ({
  id: r.id, ownerKind: r.owner_kind, ownerId: r.owner_id, name: r.name,
  mime: r.mime, size: r.size, sha256: r.sha256, createdAt: r.created_at,
});

// ---- stockage ------------------------------------------------------------
export interface StoreResult { attachment: Attachment; deduplicated: boolean; }

/**
 * Store the bytes and record the piece. Identical bytes are written once: the
 * same invoice attached to a contract and to its operation costs one file.
 */
export function store(ownerKind: OwnerKind, ownerId: number, name: string, buf: Buffer, type: DetectedType): StoreResult {
  const { sha256, relPath: rel, deduplicated } = writeBlob(buf, type.ext);

  const info = database.prepare(`
    INSERT INTO fin_attachments (owner_kind, owner_id, name, mime, size, sha256, rel_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(ownerKind, ownerId, name, type.mime, buf.length, sha256, rel);

  return { attachment: get(Number(info.lastInsertRowid))!, deduplicated };
}

export function listFor(ownerKind: OwnerKind, ownerId: number): Attachment[] {
  return (database.prepare(
    'SELECT * FROM fin_attachments WHERE owner_kind = ? AND owner_id = ? ORDER BY created_at, id',
  ).all(ownerKind, ownerId) as Row[]).map(toAttachment);
}

/** Pieces of several owners at once, keyed by owner id. */
export function countsFor(ownerKind: OwnerKind): Map<number, number> {
  const rows = database.prepare(
    'SELECT owner_id AS id, COUNT(*) AS n FROM fin_attachments WHERE owner_kind = ? GROUP BY owner_id',
  ).all(ownerKind) as { id: number; n: number }[];
  return new Map(rows.map((r) => [r.id, r.n]));
}

export function get(id: number): Attachment | null {
  const r = database.prepare('SELECT * FROM fin_attachments WHERE id = ?').get(id) as Row | undefined;
  return r ? toAttachment(r) : null;
}

/** Absolute path of a piece, or null when the file is gone from the disk. */
export function fileOf(id: number): string | null {
  const r = database.prepare('SELECT rel_path FROM fin_attachments WHERE id = ?').get(id) as { rel_path: string } | undefined;
  return r ? blobPath(r.rel_path) : null;
}

/**
 * Remove a piece. The file only leaves the disk once no other row points at the
 * same bytes, otherwise deleting one copy would break the other.
 */
export function remove(id: number): boolean {
  const r = database.prepare('SELECT rel_path, sha256 FROM fin_attachments WHERE id = ?').get(id) as
    { rel_path: string; sha256: string } | undefined;
  if (!r) return false;

  database.prepare('DELETE FROM fin_attachments WHERE id = ?').run(id);
  releaseBlob(r.rel_path, r.sha256);
  return true;
}

/** Drop every piece of an owner, called when the owner itself goes away. */
export function removeAllFor(ownerKind: OwnerKind, ownerId: number): number {
  const ids = (database.prepare('SELECT id FROM fin_attachments WHERE owner_kind = ? AND owner_id = ?')
    .all(ownerKind, ownerId) as { id: number }[]).map((r) => r.id);
  for (const id of ids) remove(id);
  return ids.length;
}

// ---- orphelins -----------------------------------------------------------
// Le balayage vit dans le magasin, qui seul voit le disque et toutes les tables
// qui le référencent (voir storage/blobs.ts, sweepOrphans).
export { sweepOrphans, reportOrphansAtBoot } from '../storage/blobs';
