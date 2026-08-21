// Le magasin d'octets partagé du foyer : les fichiers sur le disque, les
// métadonnées dans la table du module qui les possède.
//
// Ce code vient des pièces jointes du module Finances, dont il garde les choix
// (voir finances/attachments.ts pour le raisonnement d'origine : « better-sqlite3 »
// n'expose pas l'API blob incrémentale, un PDF rangé en base est chargé
// intégralement en mémoire à chaque téléchargement). Il en est extrait parce que
// les photos de recettes ont exactement le même besoin, et qu'un second magasin
// à côté du premier voudrait dire deux répertoires à sauvegarder, deux
// déduplications qui s'ignorent et deux balayages d'orphelins.
//
// Les octets sont adressés par leur empreinte : la même photo attachée deux fois
// coûte un fichier. Un fichier ne quitte le disque que lorsque plus aucune table
// ne le réclame, d'où le registre de détenteurs ci-dessous.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

let rootDir = '';

/** Le répertoire est celui des pièces Finances : une archive de plus à faire, zéro. */
export function initBlobs(dataDir: string): void {
  rootDir = path.join(dataDir, 'pieces');
  fs.mkdirSync(rootDir, { recursive: true });
}

/**
 * Où vivent les octets. Échouer bruyamment vaut mieux que deviner : un
 * répertoire temporaire choisi dans le dos de l'exploitant perdrait tous les
 * fichiers au prochain redémarrage, et rien ne l'aurait dit.
 */
function root(): string {
  if (!rootDir) throw new Error('Magasin de fichiers : répertoire de données non configuré (initBlobs).');
  return rootDir;
}

// ---- registre des détenteurs ---------------------------------------------
/**
 * Chaque table qui référence des octets se déclare ici. Le magasin s'en sert
 * pour deux questions qu'il ne peut pas trancher seul : « ce fichier sert-il
 * encore à quelqu'un ? » et « quels fichiers du disque sont orphelins ? ».
 */
export interface BlobHolder {
  /** Nom lisible dans les journaux, par ex. « Finances/pièces jointes ». */
  label: string;
  /** Nombre de lignes de cette table qui pointent sur cette empreinte. */
  countBySha(sha256: string): number;
  /**
   * Chemins relatifs référencés, avec le nom que l'utilisateur connaît. Le
   * chemin est une empreinte SHA-256 : illisible pour décider quoi restaurer,
   * d'où le nom qui l'accompagne dans les journaux.
   */
  referencedPaths(): { relPath: string; name: string }[];
}

const holders: BlobHolder[] = [];
export function registerHolder(h: BlobHolder): void {
  if (!holders.some((x) => x.label === h.label)) holders.push(h);
}

// ---- détection de type ----------------------------------------------------
export interface DetectedType { mime: string; ext: string; }

const ascii = (b: Buffer, from: number, length: number): string => b.subarray(from, from + length).toString('latin1');

/** HEIC et ses cousins s'annoncent tous par leur marque ISO-BMFF. */
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs'];

/**
 * Identifier un fichier par ses premiers octets. L'extension est une
 * déclaration, pas une preuve : la couche d'import a déjà appris la leçon sur
 * des fichiers « .xls » qui étaient du HTML.
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
/** Les photos de recettes n'ont aucune raison d'accepter un PDF. */
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic'];
export const ACCEPTED_IMAGE_LABEL = 'JPEG, PNG, WEBP, GIF ou HEIC';

// ---- stockage -------------------------------------------------------------
/**
 * Chemin d'un fichier, dérivé de sa seule empreinte. Le nom donné par
 * l'utilisateur n'atteint jamais le système de fichiers : pas de traversée, pas
 * de collision, pas de surprise avec un caractère exotique.
 */
export function relPathFor(sha256: string, ext: string): string {
  return path.join(sha256.slice(0, 2), sha256 + ext);
}

export const absolute = (rel: string): string => path.join(root(), rel);

export interface WriteResult { sha256: string; relPath: string; deduplicated: boolean; }

/** Écrit les octets et rend leur adresse. Des octets identiques ne sont écrits qu'une fois. */
export function writeBlob(buf: Buffer, ext: string): WriteResult {
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const relPath = relPathFor(sha256, ext);
  const abs = absolute(relPath);

  const deduplicated = fs.existsSync(abs);
  if (!deduplicated) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // Écrit à côté puis renommé : un téléversement interrompu ne laisse jamais
    // un fichier à moitié écrit sous son nom définitif.
    const tmp = abs + '.part';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, abs);
  }
  return { sha256, relPath, deduplicated };
}

/** Chemin absolu d'un fichier, ou null quand il a disparu du disque. */
export function blobPath(relPath: string): string | null {
  const abs = absolute(relPath);
  return fs.existsSync(abs) ? abs : null;
}

/**
 * Rend les octets au disque, mais seulement si plus aucune table ne les
 * réclame : supprimer une copie casserait l'autre. À appeler après avoir retiré
 * la ligne, sinon le détenteur se compte lui-même.
 */
export function releaseBlob(relPath: string, sha256: string): boolean {
  if (holders.some((h) => h.countBySha(sha256) > 0)) return false;
  try { fs.unlinkSync(absolute(relPath)); } catch { /* déjà parti */ }
  return true;
}

// ---- orphelins ------------------------------------------------------------
export interface SweepReport {
  /** Lignes dont le fichier manque sur le disque, par détenteur. */
  danglingPaths: { holder: string; relPath: string; name: string }[];
  /** Fichiers du disque qu'aucune ligne ne réclame. */
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
 * Compare les tables et le disque, dans les deux sens. Rien n'est supprimé : un
 * fichier manquant est souvent une restauration en cours, et effacer ce que
 * l'exploitant n'a pas vu serait exactement le mauvais réflexe. Les comptes
 * partent dans les journaux pour que l'écart se remarque le jour où il apparaît.
 */
export function sweepOrphans(): SweepReport {
  const known = new Set<string>();
  const danglingPaths: SweepReport['danglingPaths'] = [];
  for (const h of holders) {
    for (const { relPath, name } of h.referencedPaths()) {
      known.add(relPath);
      if (!fs.existsSync(absolute(relPath))) danglingPaths.push({ holder: h.label, relPath, name });
    }
  }
  return { danglingPaths, orphanFiles: walk(root()).filter((rel) => !known.has(rel)) };
}

/** Le dire une fois au démarrage, avec assez de détail pour agir. */
export function reportOrphansAtBoot(): SweepReport {
  const report = sweepOrphans();
  if (report.danglingPaths.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[foyer] Fichiers : ${report.danglingPaths.length} fiche(s) sans fichier sur le disque ` +
      `(${[...new Set(report.danglingPaths.map((d) => d.holder))].join(', ')}). ` +
      'Restaurez le répertoire « pieces » ou supprimez ces pièces depuis l’application. ' +
      `Exemple : ${report.danglingPaths[0].name}`,
    );
  }
  if (report.orphanFiles.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[foyer] Fichiers : ${report.orphanFiles.length} fichier(s) sur le disque qu'aucune table ne référence. ` +
      'Rien n’a été supprimé. Voir docs/cuisine-architecture.md pour la commande de nettoyage.',
    );
  }
  return report;
}
