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
import { ListKind, Maintenance, MaintenancePatch, Remind, TaskDone, TaskItem, TaskRec } from './models';
import { nextOccurrence } from './recurrence';
import { endKey, moveKey, startKey } from './task-order';

/** Les champs qu'une modification peut viser. `who` est remplacé, jamais fusionné. */
export interface TaskFields {
  listId?: string; text?: string; note?: string; cat?: string; who?: string[];
  due?: string | null; time?: string | null; shopListId?: string | null; rec?: TaskRec | null; remind?: Remind | null;
  contractId?: number | null; parentId?: string | null; ord?: string | null;
}

interface OpBase { opId: string; by?: string | null; at?: string; }
export type TaskOp =
  | (OpBase & TaskFields & { op: 'add'; id: string; listId: string; text: string; done?: boolean; doneAt?: string | null; doneBy?: string | null; history?: TaskDone[]; position?: 'debut' | 'fin'; maintenance?: MaintenancePatch | null })
  | (OpBase & TaskFields & { op: 'edit'; id: string; maintenance?: MaintenancePatch | null })
  /** Range une tâche par rapport à une autre (« avant »/« après ») ou aux extrémités. Le serveur calcule la clé. */
  | (OpBase & { op: 'move'; id: string; avant?: string | null; apres?: string | null; position?: 'debut' | 'fin' | null })
  /** Sur une série : `occ` l'échéance soldée, `next` la suivante (null : la série s'arrête). */
  | (OpBase & { op: 'done'; id: string; occ?: string; next?: string | null })
  /** Le stock d'un geste d'entretien : `add` (racheté) ou `set` (compté), jamais une quantité recalculée ici. `on` : le jour du comptage. */
  | (OpBase & { op: 'stock'; id: string; add?: number; set?: number; on?: string })
  /** Passer une occurrence sans la faire. */
  | (OpBase & { op: 'skip'; id: string; occ: string; next: string | null })
  /** Sur une série : `occ` l'échéance à rétablir, celle de la dernière réalisation. */
  | (OpBase & { op: 'reopen'; id: string; occ?: string })
  | (OpBase & { op: 'remove'; id: string })
  /** Remise à zéro d'une liste de préparation : `id` est la liste, ses articles redeviennent à préparer. */
  | (OpBase & { op: 'reset'; id: string });

/**
 * Une opération avant qu'on ne l'estampille. Le conditionnel distribue sur
 * l'union : un `Omit` direct la réduirait à ses seules clés communes.
 */
export type TaskOpDraft = TaskOp extends infer T ? (T extends TaskOp ? Omit<T, 'opId' | 'by' | 'at'> : never) : never;

/** Ce qu'une saisie produit : les champs d'une tâche neuve. */
export interface TaskDraft {
  text: string; listId: string; who: string[]; due: string | null; time: string | null; cat: string; note: string; rec: TaskRec | null; remind: Remind | null;
}

/** Pose les champs, en retirant les clés vides plutôt que de laisser « ». */
function assign(t: TaskItem, f: TaskFields): TaskItem {
  const { ord, ...rest } = { ...t, ...f };
  const next: TaskItem = { ...rest, ...(typeof ord === 'string' && ord ? { ord } : {}) };
  if (!next.note) delete next.note;
  if (!next.cat) delete next.cat;
  if (next.shopListId == null) delete next.shopListId;
  if (next.contractId == null) delete next.contractId;
  if (next.parentId == null) delete next.parentId;
  if (!next.maintenance) delete next.maintenance;
  // Même règle que le serveur : une sous-tâche ne porte ni date, ni récurrence,
  // ni rappel. L'écran doit le montrer tout de suite, pas après l'aller-retour.
  if (next.parentId) { next.due = null; delete next.time; delete next.rec; delete next.remind; }
  if (next.time == null) delete next.time;
  if (!next.rec) delete next.rec;
  // Une série garde son rappel sans échéance (geste d'entretien jamais noté).
  if (!next.remind || (!next.due && !next.rec)) delete next.remind;
  return next;
}

const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Le jour, heure de Paris, d'un instant ISO : celui où le foyer dit avoir fait le geste. */
export function parisDay(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso.slice(0, 10) : PARIS_DAY.format(new Date(t));
}

/** Le jour de la dernière réalisation d'une série, ou '' : c'est ce qui dit « déjà noté aujourd'hui ». */
export const lastDoneDay = (t: TaskItem): string => (t.history?.length ? parisDay(t.history[t.history.length - 1].at) : '');

/** Même fusion que le serveur : la quantité d'un stock déjà là ne bouge jamais par une modification de la fiche. */
function mergeMaintenance(cur: Maintenance | undefined, patch: MaintenancePatch | null | undefined, day: string): Maintenance | undefined {
  if (patch === undefined) return cur;
  if (patch === null) return undefined;
  const next: Maintenance = { ...(cur || {}) };
  for (const k of ['roomId', 'howto', 'pausedUntil', 'catalogId'] as const) {
    if (patch[k] === undefined) continue;
    if (patch[k] === null) delete next[k]; else next[k] = patch[k] as string;
  }
  if (patch.equipmentId === null) delete next.equipmentId; else if (patch.equipmentId !== undefined) next.equipmentId = patch.equipmentId;
  if (patch.stock === null) delete next.stock;
  else if (patch.stock) {
    const { countedAt, ...conf } = patch.stock;
    next.stock = cur?.stock
      ? { ...conf, qty: cur.stock.qty, countedAt: cur.stock.countedAt, ...(cur.stock.alerted ? { alerted: true } : {}) }
      : { ...conf, countedAt: countedAt || day };
  }
  return Object.keys(next).length ? next : undefined;
}

/**
 * Un geste d'entretien noté : miroir de `maintain` côté serveur. Une fois par
 * jour, date suivante calculée depuis le jour du geste, stock repris d'un coup.
 */
function maintain(t: TaskItem, occ: string, at: string, by: string | null): TaskItem {
  if (occ !== (t.due || '')) return t;
  const day = parisDay(at);
  const lastDay = lastDoneDay(t);
  if (lastDay >= day) return t;
  const next = nextOccurrence(t.rec!, t.due || day, day);
  const st = t.maintenance?.stock;
  const used = st ? Math.min(st.use, st.qty) : 0;
  const history = [...(t.history || []), { at, by, due: t.due, ...(used ? { used } : {}) }];
  const { pausedUntil: _p, ...rest } = t.maintenance || {};
  void _p;
  const m: Maintenance = { ...rest, ...(st && used ? { stock: { ...st, qty: st.qty - used, countedAt: day } } : {}) };
  const base: TaskItem = { ...t, history };
  if (Object.keys(m).length) base.maintenance = m; else delete base.maintenance;
  return next ? { ...base, due: next } : { ...base, done: true, doneAt: at, doneBy: by };
}

/**
 * Applique une opération à la liste locale. Rend un nouveau tableau, jamais
 * l'ancien modifié. `kindOf` dit le type d'une liste : une coche dans la liste
 * Entretien suit les règles d'un geste d'entretien.
 */
export function applyTaskOp(items: TaskItem[], op: TaskOp, kindOf: (listId: string) => ListKind | undefined = () => undefined): TaskItem[] {
  const out = items.map((t) => ({ ...t }));
  const idx = out.findIndex((t) => t.id === op.id);
  const at = op.at ?? new Date().toISOString();
  const by = op.by ?? null;
  switch (op.op) {
    case 'add': {
      if (idx >= 0) break;
      const { op: _op, opId: _id, at: _at, by: _by, done, doneAt, doneBy, history, position, maintenance, ...fields } = op;
      void _op; void _id; void _at; void _by;
      const m = mergeMaintenance(undefined, maintenance, parisDay(at));
      // Une clé provisoire pour l'affichage : la même que le serveur calculera
      // (fin globale, ou tête sur demande). Il la confirmera à la synchro.
      const ord = typeof fields.ord === 'string' && fields.ord ? fields.ord : (position === 'debut' ? startKey(out) : endKey(out));
      out.push(assign({
        id: op.id, listId: op.listId, text: op.text, who: op.who ?? [], due: op.due ?? null, done: !!done, by, at,
        ...(done ? { doneAt: doneAt ?? at, doneBy: doneBy ?? by } : {}),
        ...(history?.length ? { history } : {}),
        ...(m ? { maintenance: m } : {}),
      }, { ...fields, ord }));
      break;
    }
    case 'edit': {
      if (idx < 0) break;
      const { op: _op, opId: _id, at: _at, by: _by, id: _tid, maintenance, ...fields } = op;
      void _op; void _id; void _at; void _by; void _tid;
      const next = assign({ ...out[idx], maintenance: mergeMaintenance(out[idx].maintenance, maintenance, parisDay(at)) }, fields);
      // Toute retouche estampille « modifié », sauf un simple rangement (clé d'ordre seule).
      out[idx] = Object.keys(fields).some((k) => k !== 'ord') || maintenance !== undefined ? { ...next, upBy: by, upAt: at } : next;
      break;
    }
    case 'move': {
      if (idx < 0) break;
      // Clé provisoire, relue sur les voisins locaux ; le serveur tranchera. Sans
      // objet (référence absente, autre liste, déjà en place) : on ne bouge rien.
      const k = moveKey(out, op.id, { avant: op.avant, apres: op.apres, position: op.position });
      if (k != null) out[idx] = { ...out[idx], ord: k };
      break;
    }
    case 'done': {
      if (idx < 0) break;
      const t = out[idx];
      if (t.rec && !t.done && kindOf(t.listId) === 'entretien') { out[idx] = maintain(t, op.occ ?? '', at, by); break; }
      if (t.rec && !t.done) {
        if ((op.occ ?? '') !== (t.due || '')) break;
        const history = [...(t.history || []), { at, by, due: t.due }];
        out[idx] = op.next ? { ...t, due: op.next, history } : { ...t, done: true, doneAt: at, doneBy: by, history };
      } else if (!t.done) out[idx] = { ...t, done: true, doneAt: at, doneBy: by };
      break;
    }
    case 'skip': {
      if (idx < 0) break;
      const t = out[idx];
      if (!t.rec || t.done || op.occ !== (t.due || '')) break;
      out[idx] = op.next ? { ...t, due: op.next } : { ...t, done: true, doneAt: at, doneBy: by };
      break;
    }
    case 'reopen': {
      if (idx < 0) break;
      const t = out[idx];
      const last = t.rec && t.history?.length ? t.history[t.history.length - 1] : null;
      // `occ` vide est une vraie valeur : la première réalisation d'un geste jamais noté soldait une échéance vide.
      if (last && op.occ !== undefined && (last.due || '') === op.occ) {
        const back: TaskItem = { ...t, done: false, doneAt: null, doneBy: null, due: last.due, history: t.history!.slice(0, -1) };
        const st = t.maintenance?.stock;
        if (st && last.used) back.maintenance = { ...t.maintenance, stock: { ...st, qty: st.qty + last.used } };
        out[idx] = back;
      } else if (t.done) out[idx] = { ...t, done: false, doneAt: null, doneBy: null };
      break;
    }
    case 'stock': {
      const st = idx >= 0 ? out[idx].maintenance?.stock : undefined;
      if (!st) break;
      const qty = op.set !== undefined ? op.set : Math.max(0, st.qty + (op.add ?? 0));
      out[idx] = { ...out[idx], maintenance: { ...out[idx].maintenance, stock: { ...st, qty, countedAt: op.on || parisDay(at) } }, upBy: by, upAt: at };
      break;
    }
    case 'remove':
      if (idx >= 0) out.splice(idx, 1);
      break;
    case 'reset':
      // `op.id` est la liste : tous ses articles redeviennent à préparer.
      for (let i = 0; i < out.length; i++) {
        const t = out[i];
        if (t.listId === op.id && (t.done || t.doneAt || t.doneBy)) out[i] = { ...t, done: false, doneAt: null, doneBy: null };
      }
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
    case 'done':
      if (!before || before.done) return null;
      // Sur une série, l'annulation rétablit l'occurrence soldée, et elle seule.
      return before.rec ? { op: 'reopen', id: op.id, occ: before.due || '' } : { op: 'reopen', id: op.id };
    case 'skip': return before && !before.done ? { op: 'edit', id: op.id, due: before.due } : null;
    case 'reopen': return before && before.done ? { op: 'done', id: op.id, ...(before.rec ? { occ: before.due || '', next: null } : {}) } : null;
    case 'add': return { op: 'remove', id: op.id };
    // Annuler un comptage remet la quantité d'avant, comptée à sa date d'avant.
    case 'stock': {
      const st = before?.maintenance?.stock;
      return st ? { op: 'stock', id: op.id, set: st.qty, on: st.countedAt } : null;
    }
    case 'move':
      // Annuler un rangement remet la clé d'avant (une clé connue, pas inventée).
      return before && !before.done ? { op: 'edit', id: op.id, ord: before.ord ?? null } : null;
    case 'remove': {
      if (!before) return null;
      const { id, listId, text, who, due, done, doneAt, doneBy, note, cat, time, shopListId, rec, history, remind, contractId, parentId, ord, maintenance } = before;
      return {
        op: 'add', id, listId, text, who, due, done,
        ...(done ? { doneAt: doneAt ?? null, doneBy: doneBy ?? null } : {}),
        ...(note ? { note } : {}), ...(cat ? { cat } : {}), ...(time ? { time } : {}), ...(shopListId ? { shopListId } : {}),
        ...(rec ? { rec } : {}), ...(history?.length ? { history } : {}), ...(remind ? { remind } : {}),
        ...(contractId ? { contractId } : {}),
        ...(maintenance ? { maintenance } : {}),
        ...(parentId ? { parentId } : {}), ...(typeof ord === 'string' && ord ? { ord } : {}),
      };
    }
    case 'edit': {
      if (!before) return null;
      const { op: _op, id, maintenance, ...fields } = op;
      void _op;
      const back: TaskFields & { maintenance?: MaintenancePatch | null } = {};
      // Les champs d'entretien se défont clé par clé : une clé posée par la
      // modification et absente avant doit être retirée, pas laissée en place.
      if (maintenance !== undefined) {
        const was = before.maintenance;
        if (maintenance === null) back.maintenance = was ? { ...was } : null;
        else {
          const m: MaintenancePatch = {};
          for (const k of Object.keys(maintenance) as (keyof MaintenancePatch)[]) (m as Record<string, unknown>)[k] = was?.[k] ?? null;
          back.maintenance = m;
        }
      }
      for (const k of Object.keys(fields) as (keyof TaskFields)[]) {
        const v = before[k];
        // Un champ absent avant redevient absent : null pour les dates, vide pour les textes.
        (back as Record<string, unknown>)[k] = v === undefined ? (k === 'who' ? [] : k === 'text' || k === 'note' || k === 'cat' || k === 'listId' ? '' : null) : v;
      }
      return { op: 'edit', id, ...back };
    }
    // Une remise à zéro n'a pas d'annulation : les coches d'avant sont perdues,
    // et c'est une action confirmée, pas un geste d'un tap.
    case 'reset': return null;
  }
}

/**
 * Les champs qu'un brouillon de modification pose sur une tâche : sans date,
 * ni heure ni rappel ; catégorie et note sans blancs autour.
 */
export function draftFields(d: TaskDraft): TaskFields {
  return { text: d.text, listId: d.listId, who: d.who, due: d.due, time: d.due ? d.time : null, cat: d.cat.trim(), note: d.note.trim(), rec: d.rec, remind: d.due ? d.remind : null };
}

// Forme comparable d'une tâche ou d'un brouillon : l'ordre des membres et les
// valeurs vides (absente, nulle, chaîne vide) ne sont pas des différences.
const shape = (f: TaskFields): string => JSON.stringify([
  f.text?.trim() || '', f.listId || '', [...(f.who || [])].sort(), f.due || null, (f.due && f.time) || null,
  f.cat?.trim() || '', f.note?.trim() || '', f.rec ? JSON.stringify(f.rec, Object.keys(f.rec).sort()) : null, (f.due && f.remind) || null,
]);
/** Le brouillon change-t-il la tâche ? Enregistrer sans rien toucher ne doit rien envoyer. */
export function taskDraftChanges(t: TaskItem, d: TaskDraft): boolean { return shape(t) !== shape(draftFields(d)); }
