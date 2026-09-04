// La sauvegarde de la base, déclenchée depuis l'application.
//
// La base est en mode WAL : copier `foyer.db` pendant que le service tourne
// donne une archive **corrompue**, silencieusement. `VACUUM INTO` écrit un
// instantané cohérent sans arrêter le service, et c'est la seule façon sûre de
// sauvegarder à chaud. C'est déjà la procédure Docker documentée dans le README ;
// elle devient un bouton.
//
// Ce que cet instantané **ne contient pas** : les fichiers et les photos, qui
// vivent sur le disque à côté de la base. L'écran le dit, et donne la commande
// d'archive complète. Mieux vaut une sauvegarde partielle annoncée qu'une
// sauvegarde complète supposée.
import fs from 'fs';
import path from 'path';
import type { Database } from 'better-sqlite3';
import { Snapshot, listSnapshots, safeSnapshotName, snapshotDir, snapshotName } from './status';

export class BackupRefused extends Error {}

/**
 * Écrit un instantané, puis élague les plus anciens.
 *
 * L'élagage vient après l'écriture, jamais avant : une sauvegarde qui commence
 * par effacer l'avant-dernière laisserait le foyer sans rien si elle échoue.
 */
export function makeSnapshot(db: Database, dataDir: string, keep: number, now = new Date()): { snapshot: Snapshot; deleted: string[] } {
  const dir = snapshotDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const name = snapshotName(now);
  const cible = path.join(dir, name);
  // VACUUM INTO refuse d'écraser : un second appel dans la même minute doit le
  // dire, pas remplacer l'instantané précédent en silence.
  if (fs.existsSync(cible)) throw new BackupRefused('Une sauvegarde de cette minute existe déjà. Réessayez dans une minute.');
  db.prepare('VACUUM INTO ?').run(cible);

  const deleted: string[] = [];
  for (const vieux of listSnapshots(dataDir).slice(Math.max(1, keep))) {
    if (!safeSnapshotName(vieux.name)) continue;
    try { fs.unlinkSync(path.join(dir, vieux.name)); deleted.push(vieux.name); } catch { /* déjà parti */ }
  }
  const st = fs.statSync(cible);
  return { snapshot: { name, bytes: st.size, at: st.mtime.toISOString() }, deleted };
}

/** Le chemin d'un instantané à servir, ou null quand le nom ne convient pas. */
export function snapshotPath(dataDir: string, name: string): string | null {
  if (!safeSnapshotName(name)) return null;
  const p = path.join(snapshotDir(dataDir), name);
  return fs.existsSync(p) ? p : null;
}

/** Efface un instantané. Rend false quand il n'existait pas ou que le nom ne convient pas. */
export function removeSnapshot(dataDir: string, name: string): boolean {
  const p = snapshotPath(dataDir, name);
  if (!p) return false;
  fs.unlinkSync(p);
  return true;
}
