// Les matières du module Révisions : leur nom affiché et l'ordre du bilan.
// En configuration (backend/config/revisions/matieres.json), surchargeable au
// même chemin dans le dossier de données, relue quand elle change. Une matière
// déclarée par un exercice mais absente d'ici s'affiche sous son identifiant.
import fs from 'fs';
import path from 'path';
import { log } from '../log';

export interface Matiere { id: string; label: string; }
const FILE = path.join('revisions', 'matieres.json');
const SHIPPED = path.join(__dirname, '..', '..', 'config', FILE);

function read(file: string): Matiere[] | null {
  if (!fs.existsSync(file)) return null;
  const v = JSON.parse(fs.readFileSync(file, 'utf8')) as { matieres?: unknown };
  if (!Array.isArray(v.matieres)) throw new Error('« matieres » doit être une liste');
  return v.matieres.filter((m): m is Matiere => !!m && typeof (m as Matiere).id === 'string' && typeof (m as Matiere).label === 'string')
    .map((m) => ({ id: m.id, label: m.label }));
}

let cache: { key: string; value: Matiere[] } | null = null;
export function matieres(dataDir: string): Matiere[] {
  const override = path.join(dataDir, FILE);
  let stamp = 'absent';
  try { stamp = String(fs.statSync(override).mtimeMs); } catch { /* pas de surcharge */ }
  if (cache?.key === stamp) return cache.value;
  let value: Matiere[] = [];
  try { value = read(SHIPPED) ?? []; } catch (e) { log.attention(`Révisions : liste des matières livrée illisible : ${(e as Error).message}.`); }
  try { const o = read(override); if (o) value = o; } catch (e) { log.attention(`Révisions : surcharge des matières illisible (${override}) : ${(e as Error).message}.`); }
  cache = { key: stamp, value };
  return value;
}

export const matiereLabel = (list: Matiere[], id: string): string => list.find((m) => m.id === id)?.label ?? id;
