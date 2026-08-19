// Pièces jointes : les octets sur le disque, les métadonnées dans SQLite.
//
// Ce choix a été pris en connaissance de cause. « better-sqlite3 » n'expose pas
// l'API blob incrémentale de SQLite : un PDF rangé en base est chargé
// intégralement en mémoire à chaque téléchargement, ce qui met un LXC modeste à
// genoux dès que deux personnes ouvrent une facture en même temps. Sur disque,
// le fichier est servi en flux.
//
// Trois conséquences que le reste du fichier assume :
//   - la base et le répertoire peuvent se désynchroniser, donc un balayage au
//     démarrage compte les deux sens de l'écart et le dit dans les logs ;
//   - un fichier supprimé libère sa place tout de suite, ce qu'un DELETE SQL ne
//     fait pas (secure_delete et auto_vacuum sont à zéro par défaut) ;
//   - le répertoire peut vivre sur un volume chiffré à part, ce qui comptera le
//     jour où le foyer y rangera autre chose que des factures.
import type { Database } from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

let database: Database;
let rootDir = '';

export function initAttachments(db: Database, dataDir: string): void {
  database = db;
  rootDir = path.join(dataDir, 'pieces');
  fs.mkdirSync(rootDir, { recursive: true });
}

/**
 * Where the bytes live. Failing loudly beats guessing: a temporary directory
 * chosen behind the operator's back would lose every document at the next
 * reboot, and nothing would have said so.
 */
function root(): string {
  if (!rootDir) throw new Error('Pièces jointes : répertoire de données non configuré (initAttachments).');
  return rootDir;
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

// ---- type detection -------------------------------------------------------
export interface DetectedType { mime: string; ext: string; }

const ascii = (b: Buffer, from: number, length: number): string => b.subarray(from, from + length).toString('latin1');

/** HEIC and its cousins all announce themselves by their ISO-BMFF brand. */
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs'];

/**
 * Identify a file by its leading bytes. The extension is a claim, not evidence:
 * the import layer already learned that lesson on « .xls » files that were HTML.
 */
export function detectType(buf: Buffer): DetectedType | null {
  if (buf.length < 12) return null;
  if (ascii(buf, 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  if (buf[0] === 0x89 && ascii(buf, 1, 3) === 'PNG') return { mime: 'image/png', ext: '.png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (ascii(buf, 0, 3) === 'GIF') return { mime: 'image/gif', ext: '.gif' };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (ascii(buf, 4, 4) === 'ftyp' && HEIF_BRANDS.includes(ascii(buf, 8, 4))) return { mime: 'image/heic', ext: '.heic' };
  return null;
}

export const ACCEPTED_LABEL = 'PDF, JPEG, PNG, WEBP, GIF ou HEIC';

// ---- storage --------------------------------------------------------------
/**
 * Path of a piece, derived from its fingerprint alone. The name given by the
 * user never reaches the filesystem: no traversal, no collision, no surprise
 * with an exotic character.
 */
function relPathFor(sha256: string, ext: string): string {
  return path.join(sha256.slice(0, 2), sha256 + ext);
}

const absolute = (rel: string): string => path.join(root(), rel);

export interface StoreResult { attachment: Attachment; deduplicated: boolean; }

/**
 * Store the bytes and record the piece. Identical bytes are written once: the
 * same invoice attached to a contract and to its operation costs one file.
 */
export function store(ownerKind: OwnerKind, ownerId: number, name: string, buf: Buffer, type: DetectedType): StoreResult {
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const rel = relPathFor(sha256, type.ext);
  const abs = absolute(rel);

  const deduplicated = fs.existsSync(abs);
  if (!deduplicated) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // Written aside then renamed: an interrupted upload never leaves a
    // half-written file under its final, fingerprint-shaped name.
    const tmp = abs + '.part';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, abs);
  }

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
  if (!r) return null;
  const abs = absolute(r.rel_path);
  return fs.existsSync(abs) ? abs : null;
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
  const others = (database.prepare('SELECT COUNT(*) AS n FROM fin_attachments WHERE sha256 = ?').get(r.sha256) as { n: number }).n;
  if (!others) { try { fs.unlinkSync(absolute(r.rel_path)); } catch { /* déjà parti */ } }
  return true;
}

/** Drop every piece of an owner, called when the owner itself goes away. */
export function removeAllFor(ownerKind: OwnerKind, ownerId: number): number {
  const ids = (database.prepare('SELECT id FROM fin_attachments WHERE owner_kind = ? AND owner_id = ?')
    .all(ownerKind, ownerId) as { id: number }[]).map((r) => r.id);
  for (const id of ids) remove(id);
  return ids.length;
}

// ---- orphans --------------------------------------------------------------
export interface SweepReport {
  /** Rows whose file is missing from the disk. */
  danglingRows: { id: number; name: string; relPath: string }[];
  /** Files on the disk that no row claims. */
  orphanFiles: string[];
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (!e.name.endsWith('.part')) out.push(path.relative(root(), full));
  }
  return out;
}

/**
 * Compare the table and the disk, both ways. Nothing is deleted: a missing file
 * is often a restore in progress, and removing what the operator has not seen
 * would be exactly the wrong reflex. The counts are logged so the discrepancy
 * is noticed the day it appears.
 */
export function sweepOrphans(): SweepReport {
  const rows = database.prepare('SELECT id, name, rel_path FROM fin_attachments').all() as
    { id: number; name: string; rel_path: string }[];
  const known = new Set(rows.map((r) => r.rel_path));

  return {
    danglingRows: rows.filter((r) => !fs.existsSync(absolute(r.rel_path)))
      .map((r) => ({ id: r.id, name: r.name, relPath: r.rel_path })),
    orphanFiles: walk(root()).filter((rel) => !known.has(rel)),
  };
}

/** Say it once at boot, with enough detail to act on it. */
export function reportOrphansAtBoot(): SweepReport {
  const report = sweepOrphans();
  if (report.danglingRows.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[foyer] Pièces jointes : ${report.danglingRows.length} fiche(s) sans fichier sur le disque. ` +
      `Restaurez le répertoire « pieces » ou supprimez ces pièces depuis l'application. ` +
      `Exemple : ${report.danglingRows[0].name}`,
    );
  }
  if (report.orphanFiles.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[foyer] Pièces jointes : ${report.orphanFiles.length} fichier(s) sur le disque que la base ne référence plus. ` +
      `Rien n'a été supprimé. Voir docs/finances-architecture.md pour la commande de nettoyage.`,
    );
  }
  return report;
}
