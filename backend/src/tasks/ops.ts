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

/**
 * Comment une tâche revient. Deux modes, et c'est le choix de fond du module :
 * `base: 'due'` à date fixe (les poubelles du mardi), `base: 'done'` à partir
 * de la réalisation (le test de la piscine, une semaine après l'avoir fait,
 * qu'il ait été fait samedi ou dimanche). `grace` est la tolérance en jours
 * avant d'être en retard : l'ouverture de la piscine se fait « vers le 15
 * avril », pas le 15 à midi. Le calcul de l'occurrence suivante vit côté
 * client (frontend recurrence.ts), qui l'envoie avec la coche.
 */
export interface TaskRec {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  every: number;
  days?: number[];
  base: 'due' | 'done';
  grace?: number;
  until?: string | null;
}
/** Le réglage de rappel d'une tâche. Aucun par défaut ; voir notify/reminders.ts pour l'heure qui en découle. */
export type Remind = 'at' | '1h' | 'eve' | 'morning';
const REMINDS: Remind[] = ['at', '1h', 'eve', 'morning'];
/** Une réalisation passée d'une série : quand, par qui, et l'échéance qu'elle soldait. */
export interface TaskDone { at: string; by: string | null; due: string | null; }

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
  /** Une série : la tâche porte son échéance courante, et l'historique de ses réalisations. */
  rec?: TaskRec | null;
  history?: TaskDone[];
  /** Rappel avant l'échéance. Sans échéance, il n'a pas de sens et n'est pas gardé. */
  remind?: Remind | null;
  /**
   * Contrat du module Finances dont la tâche découle (échéance ou piste
   * d'économie). Comme la liste de courses, c'est un raccourci : la tâche
   * reste au foyer. Les contrats vivent dans leurs propres tables, hors du
   * document ; le serveur vérifie la forme, et l'écran dit si le contrat a
   * disparu entre-temps.
   */
  contractId?: number | null;
  /** Document du foyer (FileItem.id) que la tâche ouvre. Tombe avec le document. */
  docId?: string | null;
}

/** Les champs qu'une modification peut viser. `who` est remplacé, jamais fusionné. */
export interface TaskFields {
  listId?: string; text?: string; note?: string; cat?: string; who?: string[];
  due?: string | null; time?: string | null; shopListId?: string | null; rec?: TaskRec | null; remind?: Remind | null;
  contractId?: number | null; docId?: string | null;
}

interface Base { opId: string; by?: string | null; at?: string | null; }
export type TaskOp =
  /** `done` et compagnie sont acceptés à l'ajout : c'est ce qui permet d'annuler une suppression. */
  | (Base & TaskFields & { op: 'add'; id: string; listId: string; text: string; done?: boolean; doneAt?: string | null; doneBy?: string | null })
  | (Base & TaskFields & { op: 'edit'; id: string })
  /**
   * Sur une série, `occ` est l'échéance que la coche solde et `next` la
   * suivante, calculée par le client. Une coche dont `occ` n'est plus
   * l'échéance courante arrive après que l'autre appareil a coché la même
   * occurrence : elle est sans objet, et surtout pas une seconde avance.
   */
  | (Base & { op: 'done'; id: string; occ?: string; next?: string | null })
  /** Passer une occurrence sans la faire : la série avance, sans ligne d'historique. */
  | (Base & { op: 'skip'; id: string; occ: string; next: string | null })
  /** Sur une série, `occ` est l'échéance à rétablir : celle de la dernière réalisation. */
  | (Base & { op: 'reopen'; id: string; occ?: string })
  | (Base & { op: 'remove'; id: string });

export interface OpsContext {
  /** Listes existantes. Une tâche ne peut pas atterrir dans une liste inconnue. */
  listIds: Set<string>;
  /** Membres existants. Un membre inconnu est retiré de l'affectation, sans faire échouer l'opération. */
  memberIds: Set<string>;
  /** Listes de courses existantes, pour le lien. */
  shopListIds: Set<string>;
  /** Documents existants, pour le lien. */
  docIds: Set<string>;
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
const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
const HISTORY_MAX = 200;

/** Lit une règle de récurrence. Null pour « aucune », une raison si elle est illisible. */
function readRec(v: unknown): { rec: TaskRec | null } | { reason: string } {
  if (v === null || v === undefined || v === '') return { rec: null };
  if (typeof v !== 'object') return { reason: 'Récurrence illisible.' };
  const o = v as Record<string, unknown>;
  const freq = str(o['freq']);
  if (!FREQS.includes(freq)) return { reason: 'Fréquence de récurrence inconnue : ' + freq };
  const every = typeof o['every'] === 'number' && Number.isInteger(o['every']) && o['every'] >= 1 && o['every'] <= 99 ? o['every'] : 1;
  const base = o['base'] === 'done' ? 'done' : 'due';
  const rec: TaskRec = { freq: freq as TaskRec['freq'], every, base };
  if (Array.isArray(o['days'])) {
    const days = [...new Set(o['days'].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))] as number[];
    if (days.length) rec.days = days.sort((a, b) => a - b);
  }
  if (typeof o['grace'] === 'number' && Number.isInteger(o['grace']) && o['grace'] > 0 && o['grace'] <= 365) rec.grace = o['grace'];
  if (typeof o['until'] === 'string' && o['until']) {
    if (!ISO_DAY.test(o['until'])) return { reason: 'Fin de récurrence illisible : ' + o['until'] };
    rec.until = o['until'];
  }
  return { rec };
}

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
  if (o['rec'] !== undefined) {
    const r = readRec(o['rec']);
    if ('reason' in r) return { reason: r.reason };
    f.rec = r.rec;
  }
  if (o['remind'] !== undefined) {
    if (o['remind'] === null || o['remind'] === '') f.remind = null;
    else if (REMINDS.includes(o['remind'] as Remind)) f.remind = o['remind'] as Remind;
    else return { reason: 'Réglage de rappel inconnu : ' + str(o['remind']) };
  }
  if (o['shopListId'] !== undefined) {
    const id = trimmed(o['shopListId'], 80);
    // Une liste de courses disparue ne fait pas échouer la tâche : le lien tombe.
    f.shopListId = id && ctx.shopListIds.has(id) ? id : null;
  }
  if (o['docId'] !== undefined) {
    const id = trimmed(o['docId'], 80);
    f.docId = id && ctx.docIds.has(id) ? id : null;
  }
  if (o['contractId'] !== undefined) {
    const v = o['contractId'];
    if (v === null || v === '') f.contractId = null;
    else if (typeof v === 'number' && Number.isInteger(v) && v > 0) f.contractId = v;
    else return { reason: 'Contrat illisible : ' + str(v) };
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
  if (next.docId === null || next.docId === undefined) delete next.docId;
  if (next.contractId === null || next.contractId === undefined) delete next.contractId;
  if (!next.rec) { delete next.rec; }
  if (!next.remind || !next.due) delete next.remind;
  return next;
}

/** Les réalisations passées d'une série, telles qu'un ajout peut les restituer. Ce qui n'a pas la forme est ignoré. */
function readHistory(v: unknown): TaskDone[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
    .map((h) => ({ at: trimmed(h['at'], 40), by: trimmed(h['by'], 80) || null, due: ISO_DAY.test(str(h['due'])) ? str(h['due']) : null }))
    .filter((h) => !!h.at)
    .slice(-HISTORY_MAX);
}

/** L'échéance suivante d'une coche ou d'un saut : une date, ou null quand la série s'arrête là. */
function readNext(v: unknown): { next: string | null } | { reason: string } {
  if (v === null || v === undefined || v === '') return { next: null };
  if (ISO_DAY.test(str(v))) return { next: str(v) };
  return { reason: 'Échéance suivante illisible : ' + str(v) };
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
        const history = readHistory(o['history']);
        out.push(assign({
          id, listId: f.listId, text: f.text, who: f.who ?? [], due: f.due ?? null, done, by, at,
          ...(done ? { doneAt: trimmed(o['doneAt'], 40) || at, doneBy: trimmed(o['doneBy'], 80) || by } : {}),
          ...(history.length ? { history } : {}),
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
        const t = out[idx];
        if (t.rec && !t.done) {
          // Une série : la coche solde l'occurrence courante et fait avancer
          // l'échéance. Une coche pour une autre occurrence est sans objet.
          const occ = trimmed(o['occ'], 40);
          if (occ !== (t.due || '')) { applied.push(opId); break; }
          const n = readNext(o['next']);
          if ('reason' in n) { skipped.push({ opId, reason: n.reason }); break; }
          const history = [...(t.history || []), { at, by, due: t.due }].slice(-HISTORY_MAX);
          out[idx] = n.next ? { ...t, due: n.next, history } : { ...t, done: true, doneAt: at, doneBy: by, history };
          applied.push(opId);
          break;
        }
        // Déjà faite : on garde qui l'a faite en premier, c'est l'information vraie.
        if (!t.done) out[idx] = { ...t, done: true, doneAt: at, doneBy: by };
        applied.push(opId);
        break;
      }
      case 'skip': {
        if (idx < 0) { applied.push(opId); break; }
        const t = out[idx];
        if (!t.rec || t.done || trimmed(o['occ'], 40) !== (t.due || '')) { applied.push(opId); break; }
        const n = readNext(o['next']);
        if ('reason' in n) { skipped.push({ opId, reason: n.reason }); break; }
        out[idx] = n.next ? { ...t, due: n.next } : { ...t, done: true, doneAt: at, doneBy: by };
        applied.push(opId);
        break;
      }
      case 'reopen': {
        if (idx < 0) { applied.push(opId); break; }
        const t = out[idx];
        const occ = trimmed(o['occ'], 40);
        const last = t.rec && t.history?.length ? t.history[t.history.length - 1] : null;
        if (last && occ && (last.due || '') === occ) {
          // Défaire la dernière coche d'une série : l'échéance qu'elle soldait revient.
          out[idx] = { ...t, done: false, doneAt: null, doneBy: null, due: last.due, history: t.history!.slice(0, -1) };
        } else if (t.done) {
          out[idx] = { ...t, done: false, doneAt: null, doneBy: null };
        }
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
  /** Liens vers une liste de courses ou un document disparus. */
  unlinked: number;
}

/**
 * Rattrape ce que l'édition des listes, des membres, des listes de courses et
 * des documents implique pour les tâches. Ces quatre-là s'éditent par
 * l'enregistrement du document complet, dans lequel les tâches ne voyagent
 * plus : il faut donc appliquer ici les conséquences.
 */
export function reconcile(items: TaskItem[], listIds: Set<string>, memberIds: Set<string>, shopListIds: Set<string>, docIds: Set<string> = new Set()): ReconcileReport {
  const kept = items.filter((t) => listIds.has(t.listId));
  let unassigned = 0;
  let unlinked = 0;
  const out = kept.map((t) => {
    let next = t;
    const who = (t.who || []).filter((m) => memberIds.has(m));
    if (who.length !== (t.who || []).length) { unassigned++; next = { ...next, who }; }
    if (t.shopListId && !shopListIds.has(t.shopListId)) { unlinked++; next = { ...next }; delete next.shopListId; }
    if (t.docId && !docIds.has(t.docId)) { unlinked++; next = { ...next }; delete next.docId; }
    return next;
  });
  return { items: out, dropped: items.length - kept.length, unassigned, unlinked };
}
