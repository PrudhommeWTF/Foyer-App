// Fichiers rattachés aux entités du document d'état (aujourd'hui : les photos
// de recettes). Mêmes octets, même déduplication et même balayage que les pièces
// jointes du module Finances, table distincte parce que le propriétaire est
// désigné par un identifiant texte.
import type { Database } from 'better-sqlite3';
import { DetectedType, blobPath, registerHolder, releaseBlob, writeBlob } from './blobs';

let database: Database;

export function initFiles(db: Database): void {
  database = db;
  registerHolder({
    label: 'Foyer/fichiers',
    countBySha: (sha) => (database.prepare('SELECT COUNT(*) AS n FROM hh_attachments WHERE sha256 = ?').get(sha) as { n: number }).n,
    referencedPaths: () => (database.prepare('SELECT rel_path, name FROM hh_attachments').all() as { rel_path: string; name: string }[])
      .map((r) => ({ relPath: r.rel_path, name: r.name })),
  });
}

/** Ce à quoi un fichier peut être rattaché. Un module suivant ajoute son genre ici. */
export type OwnerKind = 'recipe';
export const OWNER_KINDS: OwnerKind[] = ['recipe'];

export interface StoredFile {
  id: number;
  ownerKind: OwnerKind;
  ownerId: string;
  /** Nom tel que l'utilisateur le connaît. Jamais utilisé pour construire un chemin. */
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

interface Row {
  id: number; owner_kind: OwnerKind; owner_id: string; name: string;
  mime: string; size: number; sha256: string; rel_path: string; created_at: string;
}

const toFile = (r: Row): StoredFile => ({
  id: r.id, ownerKind: r.owner_kind, ownerId: r.owner_id,
  name: r.name, mime: r.mime, size: r.size, createdAt: r.created_at,
});

export interface StoreResult { file: StoredFile; deduplicated: boolean; }

export function store(ownerKind: OwnerKind, ownerId: string, name: string, buf: Buffer, type: DetectedType): StoreResult {
  const { sha256, relPath, deduplicated } = writeBlob(buf, type.ext);
  const info = database.prepare(`
    INSERT INTO hh_attachments (owner_kind, owner_id, name, mime, size, sha256, rel_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(ownerKind, ownerId, name, type.mime, buf.length, sha256, relPath);
  return { file: get(Number(info.lastInsertRowid))!, deduplicated };
}

export function get(id: number): StoredFile | null {
  const r = database.prepare('SELECT * FROM hh_attachments WHERE id = ?').get(id) as Row | undefined;
  return r ? toFile(r) : null;
}

/** Chemin absolu et type d'un fichier, ou null quand il a disparu du disque. */
export function fileOf(id: number): { path: string; mime: string; name: string } | null {
  const r = database.prepare('SELECT rel_path, mime, name FROM hh_attachments WHERE id = ?')
    .get(id) as { rel_path: string; mime: string; name: string } | undefined;
  if (!r) return null;
  const abs = blobPath(r.rel_path);
  return abs ? { path: abs, mime: r.mime, name: r.name } : null;
}

export function listFor(ownerKind: OwnerKind, ownerId: string): StoredFile[] {
  return (database.prepare(
    'SELECT * FROM hh_attachments WHERE owner_kind = ? AND owner_id = ? ORDER BY created_at, id',
  ).all(ownerKind, ownerId) as Row[]).map(toFile);
}

export function remove(id: number): boolean {
  const r = database.prepare('SELECT rel_path, sha256 FROM hh_attachments WHERE id = ?').get(id) as
    { rel_path: string; sha256: string } | undefined;
  if (!r) return false;
  database.prepare('DELETE FROM hh_attachments WHERE id = ?').run(id);
  releaseBlob(r.rel_path, r.sha256);
  return true;
}

/**
 * Retire les fichiers d'un propriétaire, sauf ceux encore réclamés. Appelé quand
 * une recette est supprimée : sans cela, sa photo resterait sur le disque sans
 * que rien ne la nomme.
 */
export function removeAllFor(ownerKind: OwnerKind, ownerId: string, keepIds: number[] = []): number {
  const keep = new Set(keepIds);
  const ids = (database.prepare('SELECT id FROM hh_attachments WHERE owner_kind = ? AND owner_id = ?')
    .all(ownerKind, ownerId) as { id: number }[]).map((r) => r.id).filter((id) => !keep.has(id));
  for (const id of ids) remove(id);
  return ids.length;
}

/**
 * Fichiers qu'aucune entité du document ne cite plus, par exemple la photo
 * remplacée d'une recette. Le ménage se fait au démarrage plutôt qu'à chaque
 * enregistrement : une recette peut être sauvegardée vingt fois pendant qu'on
 * la modifie, et se tromper de sens ici effacerait la photo qu'on vient de poser.
 */
export function pruneUnreferenced(referenced: Set<number>): number {
  const ids = (database.prepare('SELECT id FROM hh_attachments').all() as { id: number }[])
    .map((r) => r.id).filter((id) => !referenced.has(id));
  for (const id of ids) remove(id);
  return ids.length;
}
