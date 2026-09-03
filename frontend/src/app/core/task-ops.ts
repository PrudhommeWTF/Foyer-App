// Les opérations sur les tâches, et leur application locale.
//
// Une tâche ne s'écrit plus par l'enregistrement du document entier : chaque
// geste est une **intention** (« cette tâche est faite », jamais « inverse son
// état »), estampillée d'un identifiant, mise en file, et appliquée par le
// serveur (backend/src/tasks/ops.ts) qui fait autorité. Ce fichier applique la
// même intention à l'écran, tout de suite, sans attendre le réseau ; sa version
// est volontairement naïve, sans validation ni journal, le serveur s'en charge.
//
// Deux choses vivent ici parce qu'elles doivent être vérifiées et non relues à
// l'œil : l'application locale, et l'**inverse** d'une opération, qui est ce que
// « Annuler » envoie. Annuler ne remet jamais le tableau en bloc : ce serait
// effacer ce que l'autre appareil a écrit entre-temps.
import { TaskItem } from './models';

/** Les champs qu'une modification peut viser. `who` est remplacé, jamais fusionné. */
export interface TaskFields {
  listId?: string; text?: string; note?: string; cat?: string; who?: string[];
  due?: string | null; time?: string | null; shopListId?: string | null;
}

interface OpBase { opId: string; by?: string | null; at?: string; }
export type TaskOp =
  | (OpBase & TaskFields & { op: 'add'; id: string; listId: string; text: string; done?: boolean; doneAt?: string | null; doneBy?: string | null })
  | (OpBase & TaskFields & { op: 'edit'; id: string })
  | (OpBase & { op: 'done'; id: string })
  | (OpBase & { op: 'reopen'; id: string })
  | (OpBase & { op: 'remove'; id: string });

/**
 * Une opération avant qu'on ne l'estampille. Le conditionnel distribue sur
 * l'union : un `Omit` direct la réduirait à ses seules clés communes.
 */
export type TaskOpDraft = TaskOp extends infer T ? (T extends TaskOp ? Omit<T, 'opId' | 'by' | 'at'> : never) : never;

/** Ce qu'une saisie produit : les champs d'une tâche neuve. */
export interface TaskDraft {
  text: string; listId: string; who: string[]; due: string | null; time: string | null; cat: string; note: string;
}

/** Pose les champs, en retirant les clés vides plutôt que de laisser « ». */
function assign(t: TaskItem, f: TaskFields): TaskItem {
  const next: TaskItem = { ...t, ...f };
  if (!next.note) delete next.note;
  if (!next.cat) delete next.cat;
  if (next.time == null) delete next.time;
  if (next.shopListId == null) delete next.shopListId;
  return next;
}

/** Applique une opération à la liste locale. Rend un nouveau tableau, jamais l'ancien modifié. */
export function applyTaskOp(items: TaskItem[], op: TaskOp): TaskItem[] {
  const out = items.map((t) => ({ ...t }));
  const idx = out.findIndex((t) => t.id === op.id);
  const at = op.at ?? new Date().toISOString();
  const by = op.by ?? null;
  switch (op.op) {
    case 'add': {
      if (idx >= 0) break;
      const { op: _op, opId: _id, at: _at, by: _by, done, doneAt, doneBy, ...fields } = op;
      void _op; void _id; void _at; void _by;
      out.push(assign({
        id: op.id, listId: op.listId, text: op.text, who: op.who ?? [], due: op.due ?? null, done: !!done, by, at,
        ...(done ? { doneAt: doneAt ?? at, doneBy: doneBy ?? by } : {}),
      }, fields));
      break;
    }
    case 'edit': {
      if (idx < 0) break;
      const { op: _op, opId: _id, at: _at, by: _by, id: _tid, ...fields } = op;
      void _op; void _id; void _at; void _by; void _tid;
      out[idx] = assign(out[idx], fields);
      break;
    }
    case 'done':
      if (idx >= 0 && !out[idx].done) out[idx] = { ...out[idx], done: true, doneAt: at, doneBy: by };
      break;
    case 'reopen':
      if (idx >= 0 && out[idx].done) out[idx] = { ...out[idx], done: false, doneAt: null, doneBy: null };
      break;
    case 'remove':
      if (idx >= 0) out.splice(idx, 1);
      break;
  }
  return out;
}

/**
 * L'opération qui défait `op`, connaissant la tâche telle qu'elle était avant.
 *
 * Elle vise la tâche par son identifiant et ne touche qu'à ce que l'opération a
 * touché : annuler un report ne remet pas l'intitulé d'avant, annuler une
 * suppression remet la tâche avec sa coche et son auteur.
 */
export function inverseOf(op: TaskOpDraft, before: TaskItem | undefined): TaskOpDraft | null {
  switch (op.op) {
    case 'done': return before && !before.done ? { op: 'reopen', id: op.id } : null;
    case 'reopen': return before && before.done ? { op: 'done', id: op.id } : null;
    case 'add': return { op: 'remove', id: op.id };
    case 'remove': {
      if (!before) return null;
      const { id, listId, text, who, due, done, doneAt, doneBy, note, cat, time, shopListId } = before;
      return {
        op: 'add', id, listId, text, who, due, done,
        ...(done ? { doneAt: doneAt ?? null, doneBy: doneBy ?? null } : {}),
        ...(note ? { note } : {}), ...(cat ? { cat } : {}), ...(time ? { time } : {}), ...(shopListId ? { shopListId } : {}),
      };
    }
    case 'edit': {
      if (!before) return null;
      const { op: _op, id, ...fields } = op;
      void _op;
      const back: TaskFields = {};
      for (const k of Object.keys(fields) as (keyof TaskFields)[]) {
        const v = before[k];
        // Un champ absent avant redevient absent : null pour les dates, vide pour les textes.
        (back as Record<string, unknown>)[k] = v === undefined ? (k === 'due' || k === 'time' || k === 'shopListId' ? null : k === 'who' ? [] : '') : v;
      }
      return { op: 'edit', id, ...back };
    }
  }
}
