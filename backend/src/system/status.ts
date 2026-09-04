// L'état du service, tel qu'on veut le lire sans ouvrir un terminal.
//
// Ce que porte ce module est ce qu'un exploitant regarde en premier quand
// quelque chose cloche : depuis quand le service tourne, où sont les données,
// combien il reste de place, et quand remonte la dernière sauvegarde. Rien de
// tout cela n'était visible dans l'application.
//
// Tout est **calculé à la demande** : aucune de ces valeurs n'est stockée, donc
// aucune ne peut être fausse pour cause de cache.
import fs from 'fs';
import path from 'path';

export interface DiskUsage {
  /** Octets libres et taille totale du système de fichiers qui porte les données. */
  free: number;
  total: number;
}

export interface Snapshot { name: string; bytes: number; at: string; }

export interface SystemStatus {
  version: string;
  /** Secondes depuis le démarrage du service. */
  uptime: number;
  nodeVersion: string;
  dataDir: string;
  /** Taille de la base (journal WAL compris) et du dossier de données, en octets. */
  dbBytes: number;
  dataBytes: number;
  disk: DiskUsage | null;
  /**
   * Le contact déclaré aux services push. Il est ici parce qu'un refus d'Apple
   * se présente comme un « HTTP 403 » à côté d'un appareil, sans dire que c'est
   * ce contact qui ne convient pas.
   */
  pushSubject: string;
  snapshots: Snapshot[];
  /** Le document et ses sous-arbres, pour situer ce qui pèse. */
  counts: { members: number; events: number; tasks: number; recipes: number; files: number };
}

/** Le dossier où vivent les instantanés de la base. Créé à la première sauvegarde. */
export const snapshotDir = (dataDir: string): string => path.join(dataDir, 'sauvegardes');

/** Taille d'un fichier, ou 0 s'il n'existe pas. Jamais une exception : c'est de l'affichage. */
function taille(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

/**
 * Ce que la base occupe réellement sur le disque.
 *
 * En mode WAL, le fichier principal peut ne peser que quelques kilo-octets
 * pendant que tout le contenu attend dans le journal `-wal`. N'afficher que le
 * premier ferait croire à une base vide sur une installation bien remplie.
 */
export function dbBytes(dbPath: string): number {
  return taille(dbPath) + taille(dbPath + '-wal') + taille(dbPath + '-shm');
}

/**
 * Poids d'un dossier, fichiers inclus, sans suivre les liens.
 *
 * Volontairement borné en profondeur : le dossier de données contient des
 * fichiers du foyer, pas une arborescence infinie, et une boucle de liens ne
 * doit pas faire tourner une requête HTTP jusqu'à la fin des temps.
 */
export function dirBytes(dir: string, depth = 6): number {
  let total = 0;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) total += dirBytes(full, depth - 1); }
    else if (e.isFile()) total += taille(full);
  }
  return total;
}

/**
 * Place restante sur le système de fichiers qui porte les données.
 *
 * Son absence rend `null`, et l'écran dit alors qu'il ne sait pas, plutôt que
 * d'afficher un zéro qui ressemblerait à un disque plein.
 */
export function diskUsage(dir: string): DiskUsage | null {
  try {
    const statfs = (fs as unknown as { statfsSync?: (p: string) => { bsize: number; blocks: number; bavail: number } }).statfsSync;
    const s = statfs?.(dir);
    if (!s) return null;
    return { free: s.bsize * s.bavail, total: s.bsize * s.blocks };
  } catch { return null; }
}

/** Les instantanés présents, du plus récent au plus ancien. */
export function listSnapshots(dataDir: string): Snapshot[] {
  const dir = snapshotDir(dataDir);
  let noms: string[];
  try { noms = fs.readdirSync(dir); } catch { return []; }
  return noms
    .filter((n) => n.endsWith('.db'))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, bytes: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

/**
 * Un nom d'instantané est-il celui que ce service a écrit ?
 *
 * Le nom vient d'une requête HTTP : sans ce contrôle, « ../../etc/passwd »
 * serait un nom de sauvegarde acceptable.
 */
export function safeSnapshotName(name: string): boolean {
  return /^foyer-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(name);
}

/** Le nom de l'instantané d'un instant donné. */
export function snapshotName(at: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `foyer-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}.db`;
}

export function buildStatus(input: {
  version: string;
  dataDir: string;
  dbPath: string;
  pushSubject: string;
  counts: SystemStatus['counts'];
}): SystemStatus {
  return {
    version: input.version,
    uptime: Math.round(process.uptime()),
    nodeVersion: process.version,
    dataDir: input.dataDir,
    dbBytes: dbBytes(input.dbPath),
    dataBytes: dirBytes(input.dataDir),
    disk: diskUsage(input.dataDir),
    pushSubject: input.pushSubject,
    snapshots: listSnapshots(input.dataDir),
    counts: input.counts,
  };
}
