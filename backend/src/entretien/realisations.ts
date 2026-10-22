// Ce qu'on ajoute après coup à une réalisation d'entretien : une note (« conduit
// propre ») et des justificatifs (l'attestation d'entretien de la chaudière, à
// garder deux ans ; le certificat de ramonage, que l'assureur demande après un
// sinistre).
//
// Une réalisation est désignée par son geste et son instant (history[].at),
// comme ses montants (ent_spend). La note vit dans ent_done_notes ; un
// justificatif est une ligne de hh_attachments de genre « maintenance », dont
// le propriétaire est `<geste>@<instant>`. Le genre est gardé : seul ce module
// le sert, et aux seuls adultes (une attestation porte un prix et une adresse).
//
// Rien n'est effacé quand une réalisation est annulée : sa note et ses
// justificatifs restent, signalés « réalisation annulée ». Un geste supprimé
// emporte ses notes (dans la transaction du lot, voir forgetRemoved) ; ses
// fichiers quittent le disque au ménage du démarrage suivant, qui ne garde que
// ceux des gestes encore là. Effacer un fichier dans la transaction serait
// irréversible si elle échouait ensuite.
import type { Database } from 'better-sqlite3';
import type { TaskItem } from '../tasks/ops';
import { parisDay } from '../tasks/ops';
import type { DetectedType } from '../storage/blobs';
import * as files from '../storage/files';
import { ENTRETIEN_LIST_ID } from './list';

let database: Database;
export function initRealisations(db: Database): void { database = db; }

export const NOTE_MAX = 1000;

const ownerOf = (taskId: string, doneAt: string): string => `${taskId}@${doneAt}`;
/** `<geste>@<instant>` : l'instant (ISO) ne contient pas d'arobase, le dernier sépare. */
const splitOwner = (owner: string): { taskId: string; doneAt: string } | null => {
  const i = owner.lastIndexOf('@');
  return i > 0 ? { taskId: owner.slice(0, i), doneAt: owner.slice(i + 1) } : null;
};

export interface ProofFile { id: number; name: string; mime: string; size: number; createdAt: string; }
export interface Extras {
  doneAt: string;
  day: string;
  note: string;
  noteBy: string | null;
  /** Absent pour un enfant : il ne voit pas les justificatifs, ni leur nombre. */
  files?: ProofFile[];
}

interface NoteRow { task_id: string; done_at: string; day: string; note: string; updated_by: string | null; }
interface FileRow { id: number; owner_id: string; name: string; mime: string; size: number; created_at: string; }

/** Les notes et justificatifs de tous les gestes, ou d'un seul : par geste, le plus récent d'abord. */
export function extrasByGeste(taskId?: string, withFiles = true): Map<string, Extras[]> {
  const notes = (taskId
    ? database.prepare('SELECT * FROM ent_done_notes WHERE task_id = ?').all(taskId)
    : database.prepare('SELECT * FROM ent_done_notes').all()) as NoteRow[];
  const proofs = !withFiles ? [] : (taskId
    ? database.prepare("SELECT id, owner_id, name, mime, size, created_at FROM hh_attachments WHERE owner_kind = 'maintenance' AND substr(owner_id, 1, ?) = ? ORDER BY id")
      .all(taskId.length + 1, taskId + '@')
    : database.prepare("SELECT id, owner_id, name, mime, size, created_at FROM hh_attachments WHERE owner_kind = 'maintenance' ORDER BY id").all()) as FileRow[];
  const by = new Map<string, Map<string, Extras>>();
  const slot = (t: string, at: string): Extras => {
    const g = by.get(t) ?? new Map<string, Extras>(); by.set(t, g);
    let e = g.get(at);
    if (!e) { e = { doneAt: at, day: parisDay(at), note: '', noteBy: null, ...(withFiles ? { files: [] } : {}) }; g.set(at, e); }
    return e;
  };
  for (const n of notes) { const e = slot(n.task_id, n.done_at); e.note = n.note; e.noteBy = n.updated_by; }
  for (const f of proofs) {
    const o = splitOwner(f.owner_id); if (!o) continue;
    slot(o.taskId, o.doneAt).files!.push({ id: f.id, name: f.name, mime: f.mime, size: f.size, createdAt: f.created_at });
  }
  return new Map([...by].map(([t, g]) => [t, [...g.values()].sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1))]));
}

/** La note d'une réalisation ; une note vide la retire. */
export function setNote(taskId: string, doneAt: string, note: string, by: string | null): void {
  if (!note) { database.prepare('DELETE FROM ent_done_notes WHERE task_id = ? AND done_at = ?').run(taskId, doneAt); return; }
  database.prepare(`
    INSERT INTO ent_done_notes (task_id, done_at, day, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(task_id, done_at) DO UPDATE SET note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(taskId, doneAt, parisDay(doneAt), note, by);
}

/** Une réalisation porte-t-elle déjà une note ou un justificatif ? (On en modifie la note même annulée.) */
export function hasExtras(taskId: string, doneAt: string): boolean {
  return !!database.prepare('SELECT 1 FROM ent_done_notes WHERE task_id = ? AND done_at = ?').get(taskId, doneAt)
    || !!database.prepare("SELECT 1 FROM hh_attachments WHERE owner_kind = 'maintenance' AND owner_id = ?").get(ownerOf(taskId, doneAt));
}

export function attach(taskId: string, doneAt: string, name: string, buf: Buffer, type: DetectedType): ProofFile {
  const { file } = files.store('maintenance', ownerOf(taskId, doneAt), name, buf, type);
  return { id: file.id, name: file.name, mime: file.mime, size: file.size, createdAt: file.createdAt };
}

/** Le justificatif `id`, avec la réalisation qui le porte ; null si ce n'en est pas un. */
export function proof(id: number): { taskId: string; doneAt: string; name: string } | null {
  const f = files.get(id);
  const o = f && f.ownerKind === 'maintenance' ? splitOwner(f.ownerId) : null;
  return o && f ? { ...o, name: f.name } : null;
}

/**
 * Les justificatifs que le ménage du démarrage doit garder : ceux des gestes
 * encore présents dans le document (`gestes`, leurs identifiants).
 */
export function referencedFileIds(gestes: Set<string>): number[] {
  return (database.prepare("SELECT id, owner_id FROM hh_attachments WHERE owner_kind = 'maintenance'").all() as { id: number; owner_id: string }[])
    .filter((r) => { const o = splitOwner(r.owner_id); return !!o && gestes.has(o.taskId); }).map((r) => r.id);
}

/** Branché sur le moteur des tâches, dans sa transaction : un geste supprimé emporte ses notes. */
export function forgetRemoved(before: TaskItem[], after: TaskItem[]): void {
  const still = new Set(after.filter((t) => t.listId === ENTRETIEN_LIST_ID).map((t) => t.id));
  const del = database.prepare('DELETE FROM ent_done_notes WHERE task_id = ?');
  for (const t of before) if (t.listId === ENTRETIEN_LIST_ID && !still.has(t.id)) del.run(t.id);
}

/** Pour la confirmation d'une remise à zéro du module. */
export function countProofs(): number {
  return (database.prepare("SELECT COUNT(*) AS n FROM hh_attachments WHERE owner_kind = 'maintenance'").get() as { n: number }).n;
}
