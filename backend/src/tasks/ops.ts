// Mutations granulaires des tâches.
//
// Même dispositif que pour la liste de courses (voir shopping/ops.ts), pour la
// même raison : deux personnes cochent en même temps, et une écriture du
// document entier partie d'un téléphone périmé décochait ce que l'autre venait
// de cocher. Le rejeu des mutations sur la version du serveur n'y changeait
// rien, parce que « cocher » était écrit comme une bascule.
//
// D'où ces opérations, qui disent une **intention** et jamais une bascule :
// « cette tâche est faite » rejouée deux fois laisse la tâche faite. Chacune
// porte un identifiant que le serveur retient, pour qu'un « ajouter » rejoué
// après une coupure ne ressuscite pas une tâche supprimée entre-temps.
//
// Ce fichier ne touche ni au disque ni au réseau : c'est ce qui permet de le
// tester sur les cas tordus (rejeu, ordre inversé, liste supprimée sous les pieds).

export interface TaskItem {
  id: string;
  listId: string;
  text: string;
  note?: string;
  /** Catégorie libre : « maison », « administratif »… Sert à organiser, pas à filtrer le jour. */
  cat?: string;
  /** Membres affectés. Vide veut dire « le premier qui passe », et c'est licite. */
  who: string[];
  /** Échéance, AAAA-MM-JJ. Null : aucun jour en particulier. */
  due: string | null;
  /** Heure de l'échéance, HH:MM. Ignorée sans `due`. */
  time?: string | null;
  done: boolean;
  /** Qui a coché, et quand. Sert à l'afficher, pas à arbitrer. */
  doneAt?: string | null;
  doneBy?: string | null;
  /** Auteur et date de création. */
  by?: string | null;
  at?: string | null;
  /**
   * Liste de courses que cette tâche ouvre. La tâche reste entièrement à
   * l'utilisateur (il la coche, la déplace, la supprime) : le lien n'est qu'un
   * raccourci, et le compte des articles restants, une information de plus.
   */
  shopListId?: string | null;
}

/** Les champs qu'une modification peut viser. `who` est remplacé, jamais fusionné. */
export interface TaskFields {
  listId?: string; text?: string; note?: string; cat?: string; who?: string[];
  due?: string | null; time?: string | null; shopListId?: string | null;
}

interface Base { opId: string; by?: string | null; at?: string | null; }
export type TaskOp =
  /** `done` et compagnie sont acceptés à l'ajout : c'est ce qui permet d'annuler une suppression. */
  | (Base & TaskFields & { op: 'add'; id: string; listId: string; text: string; done?: boolean; doneAt?: string | null; doneBy?: string | null })
  | (Base & TaskFields & { op: 'edit'; id: string })
  | (Base & { op: 'done'; id: string })
  | (Base & { op: 'reopen'; id: string })
  | (Base & { op: 'remove'; id: string });

export interface OpsContext {
  /** Listes existantes. Une tâche ne peut pas atterrir dans une liste inconnue. */
  listIds: Set<string>;
  /** Membres existants. Un membre inconnu est retiré de l'affectation, sans faire échouer l'opération. */
  memberIds: Set<string>;
  /** Listes de courses existantes, pour le lien. */
  shopListIds: Set<string>;
  /** Vrai quand cette opération a déjà été appliquée (rejeu après coupure réseau). */
  alreadyApplied: (opId: string) => boolean;
}

export interface SkippedOp { opId: string; reason: string }
export interface ApplyResult {
  items: TaskItem[];
  /** Identifiants retenus : l'appelant les inscrit au journal et le client les retire de sa file. */
  applied: string[];
  /**
   * Opérations écartées, avec la raison. Elles sont définitivement écartées, pas
   * différées : un client qui les garderait en file les rejouerait sans fin.
   */
  skipped: SkippedOp[];
}

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM = /^\d{2}:\d{2}$/;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const trimmed = (v: unknown, max: number): string => str(v).trim().slice(0, max);
const TEXT_MAX = 300;
const NOTE_MAX = 2000;
const CAT_MAX = 40;

/** Un tableau d'identifiants de membres connus, dans l'ordre reçu, sans doublon. */
function whoOf(v: unknown, members: Set<string>): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const m of v) { const id = trimmed(m, 80); if (id && members.has(id) && !out.includes(id)) out.push(id); }
  return out;
}

/**
 * Lit les champs d'une tâche depuis une opération. Rend la raison du refus, ou
 * les champs présents. Un champ absent de l'opération n'est pas touché.
 */
function readFields(o: Record<string, unknown>, ctx: OpsContext): { fields: TaskFields } | { reason: string } {
  const f: TaskFields = {};
  if (o['text'] !== undefined) {
    const text = trimmed(o['text'], TEXT_MAX);
    if (!text) return { reason: 'Tâche sans intitulé.' };
    f.text = text;
  }
  if (o['listId'] !== undefined) {
    const listId = trimmed(o['listId'], 80);
    if (!ctx.listIds.has(listId)) return { reason: 'La liste visée n’existe plus.' };
    f.listId = listId;
  }
  if (o['due'] !== undefined) {
    if (o['due'] === null || o['due'] === '') f.due = null;
    else if (ISO_DAY.test(str(o['due']))) f.due = str(o['due']);
    else return { reason: 'Date d’échéance illisible : ' + str(o['due']) };
  }
  if (o['time'] !== undefined) {
    if (o['time'] === null || o['time'] === '') f.time = null;
    else if (HHMM.test(str(o['time']))) f.time = str(o['time']);
    else return { reason: 'Heure illisible : ' + str(o['time']) };
  }
  if (o['note'] !== undefined) f.note = trimmed(o['note'], NOTE_MAX);
  if (o['cat'] !== undefined) f.cat = trimmed(o['cat'], CAT_MAX);
  if (o['who'] !== undefined) f.who = whoOf(o['who'], ctx.memberIds);
  if (o['shopListId'] !== undefined) {
    const id = trimmed(o['shopListId'], 80);
    // Une liste de courses disparue ne fait pas échouer la tâche : le lien tombe.
    f.shopListId = id && ctx.shopListIds.has(id) ? id : null;
  }
  return { fields: f };
}

/** Pose les champs lus sur une tâche, en retirant les clés vides plutôt que de les laisser à « ». */
function assign(t: TaskItem, f: TaskFields): TaskItem {
  const next: TaskItem = { ...t, ...f };
  if (!next.note) delete next.note;
  if (!next.cat) delete next.cat;
  if (next.time === null || next.time === undefined) delete next.time;
  if (next.shopListId === null || next.shopListId === undefined) delete next.shopListId;
  return next;
}

/**
 * Applique un lot d'opérations. Chaque opération est indépendante : l'une est
 * écartée sans faire tomber les autres, parce qu'un lot vient d'une file
 * d'attente hors ligne et qu'une tâche périmée ne doit pas bloquer les neuf
 * autres coches faites dans la journée.
 */
export function applyOps(items: TaskItem[], ops: unknown, ctx: OpsContext): ApplyResult {
  const out: TaskItem[] = items.map((i) => ({ ...i }));
  const applied: string[] = [];
  const skipped: SkippedOp[] = [];
  const seen = new Set<string>();

  if (!Array.isArray(ops)) return { items: out, applied, skipped: [{ opId: '', reason: 'Lot d’opérations illisible.' }] };

  for (const raw of ops) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const opId = trimmed(o['opId'], 80);
    if (!opId) { skipped.push({ opId: '', reason: 'Opération sans identifiant.' }); continue; }
    // Doublon dans le lot lui-même : déjà traité, et déjà acquitté une fois.
    if (seen.has(opId)) continue;
    seen.add(opId);
    // Déjà appliquée lors d'un envoi précédent : acquittée sans être rejouée.
    if (ctx.alreadyApplied(opId)) { applied.push(opId); continue; }

    const id = trimmed(o['id'], 80);
    if (!id) { skipped.push({ opId, reason: 'Opération sans tâche visée.' }); continue; }
    const at = trimmed(o['at'], 40) || new Date().toISOString();
    const by = trimmed(o['by'], 80) || null;
    const idx = out.findIndex((i) => i.id === id);

    switch (o['op']) {
      case 'add': {
        // Rejeu d'un ajout déjà passé sous un autre identifiant d'opération :
        // la tâche existe, il n'y a rien à faire et ce n'est pas une erreur.
        if (idx >= 0) { applied.push(opId); break; }
        const read = readFields(o, ctx);
        if ('reason' in read) { skipped.push({ opId, reason: read.reason }); break; }
        const f = read.fields;
        if (!f.text) { skipped.push({ opId, reason: 'Tâche sans intitulé.' }); break; }
        if (!f.listId) { skipped.push({ opId, reason: 'La liste visée n’existe plus.' }); break; }
        const done = o['done'] === true;
        out.push(assign({
          id, listId: f.listId, text: f.text, who: f.who ?? [], due: f.due ?? null, done, by, at,
          ...(done ? { doneAt: trimmed(o['doneAt'], 40) || at, doneBy: trimmed(o['doneBy'], 80) || by } : {}),
        }, f));
        applied.push(opId);
        break;
      }
      case 'edit': {
        // Une tâche disparue n'est pas une erreur du client : quelqu'un l'a
        // supprimée pendant qu'il était hors ligne. L'opération est sans objet.
        if (idx < 0) { applied.push(opId); break; }
        const read = readFields(o, ctx);
        if ('reason' in read) { skipped.push({ opId, reason: read.reason }); break; }
        out[idx] = assign(out[idx], read.fields);
        applied.push(opId);
        break;
      }
      case 'done': {
        if (idx < 0) { applied.push(opId); break; }
        // Déjà faite : on garde qui l'a faite en premier, c'est l'information vraie.
        if (!out[idx].done) out[idx] = { ...out[idx], done: true, doneAt: at, doneBy: by };
        applied.push(opId);
        break;
      }
      case 'reopen': {
        if (idx < 0) { applied.push(opId); break; }
        if (out[idx].done) out[idx] = { ...out[idx], done: false, doneAt: null, doneBy: null };
        applied.push(opId);
        break;
      }
      case 'remove': {
        if (idx >= 0) out.splice(idx, 1);
        applied.push(opId);
        break;
      }
      default:
        skipped.push({ opId, reason: 'Opération inconnue : ' + str(o['op']) });
    }
  }

  return { items: out, applied, skipped };
}

export interface ReconcileReport {
  items: TaskItem[];
  /** Tâches parties avec leur liste : c'est ce que l'écran annonce en supprimant une liste. */
  dropped: number;
  /** Affectations à un membre qui n'existe plus. */
  unassigned: number;
  /** Liens vers une liste de courses disparue. */
  unlinked: number;
}

/**
 * Rattrape ce que l'édition des listes, des membres et des listes de courses
 * implique pour les tâches. Ces trois-là s'éditent par l'enregistrement du
 * document complet, dans lequel les tâches ne voyagent plus : il faut donc
 * appliquer ici les conséquences.
 */
export function reconcile(items: TaskItem[], listIds: Set<string>, memberIds: Set<string>, shopListIds: Set<string>): ReconcileReport {
  const kept = items.filter((t) => listIds.has(t.listId));
  let unassigned = 0;
  let unlinked = 0;
  const out = kept.map((t) => {
    let next = t;
    const who = (t.who || []).filter((m) => memberIds.has(m));
    if (who.length !== (t.who || []).length) { unassigned++; next = { ...next, who }; }
    if (t.shopListId && !shopListIds.has(t.shopListId)) { unlinked++; next = { ...next }; delete next.shopListId; }
    return next;
  });
  return { items: out, dropped: items.length - kept.length, unassigned, unlinked };
}
