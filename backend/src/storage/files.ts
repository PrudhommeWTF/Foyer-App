// Fichiers rattachés aux entités du document d'état (les photos de recettes) et
// aux fiches du module Équipements. Mêmes octets, même déduplication et même balayage que les pièces jointes du
// module Finances, table distincte parce que le propriétaire est désigné par un
// identifiant texte.
import crypto from 'crypto';
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

/**
 * Ce à quoi un fichier peut être rattaché. `document` est un genre **hérité** :
 * le module Documents a été retiré, plus aucun téléversement ne le produit. Il
 * subsiste dans le type pour que la migration 5 (qui a sorti les pièces jointes
 * de l'ancien module hors du document d'état) compile, et pour que les fichiers
 * déjà sur le disque gardent un genre valide. `OWNER_KINDS` ne liste que ce
 * qu'on accepte encore d'écrire **par la route générique** `/api/files`.
 *
 * `equipment` est un genre **gardé** : ses fichiers (factures, plaques
 * signalétiques) ne passent que par les routes du module Équipements, qui
 * vérifient à chaque requête que le module est actif et que le membre a le
 * droit de voir cette pièce (un enfant ne voit ni facture ni plaque). La route
 * générique, qui sert tout fichier à tout membre, les ignore.
 *
 * `maintenance` est gardé de la même façon : les justificatifs d'une
 * réalisation d'entretien (attestation de la chaudière, certificat de
 * ramonage), servis par le module Entretien aux seuls adultes. Le propriétaire
 * est la réalisation, `<geste>@<instant>` (voir entretien/realisations.ts).
 */
export type OwnerKind = 'recipe' | 'shop' | 'document' | 'equipment' | 'maintenance';
export const OWNER_KINDS: OwnerKind[] = ['recipe', 'shop'];
export const GUARDED_KINDS: OwnerKind[] = ['equipment', 'maintenance'];

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

/**
 * Comme `store`, mais une ligne existante du même genre portant les mêmes octets
 * est reprise au lieu d'en créer une seconde : la facture d'une cuisine
 * complète, jointe à six fiches, reste un seul fichier connu une seule fois.
 */
export function storeOnce(ownerKind: OwnerKind, ownerId: string, name: string, buf: Buffer, type: DetectedType): StoreResult {
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const r = database.prepare('SELECT * FROM hh_attachments WHERE owner_kind = ? AND sha256 = ? ORDER BY id LIMIT 1')
    .get(ownerKind, sha256) as Row | undefined;
  if (r && blobPath(r.rel_path)) return { file: toFile(r), deduplicated: true };
  return store(ownerKind, ownerId, name, buf, type);
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

export function remove(id: number): boolean {
  const r = database.prepare('SELECT rel_path, sha256 FROM hh_attachments WHERE id = ?').get(id) as
    { rel_path: string; sha256: string } | undefined;
  if (!r) return false;
  database.prepare('DELETE FROM hh_attachments WHERE id = ?').run(id);
  releaseBlob(r.rel_path, r.sha256);
  return true;
}

/**
 * Fichiers qu'aucune entité du document ni aucune fiche d'équipement ne cite plus, par exemple la photo
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
