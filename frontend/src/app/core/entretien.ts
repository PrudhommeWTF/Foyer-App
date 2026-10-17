// Le module Entretien, côté écran : ce qui se calcule sur un geste sans
// toucher au store, donc ce qui se teste.
//
// Un geste est une tâche de la liste Entretien (voir docs/entretien.md). Rien
// ici ne recalcule une date : la récurrence vit dans recurrence.ts, la coche
// dans task-ops.ts. Ce fichier range les gestes en groupes et les dit en
// français.
import { addDaysIso } from './helpers';
import { MaintenanceStock, Remind, TaskItem, TaskRec } from './models';
import { windowEnd } from './recurrence';
import { TaskOpDraft, parisDay } from './task-ops';

/** L'identifiant fixe de la liste des gestes (voir backend entretien/list.ts). */
export const ENTRETIEN_LIST_ID = 'entretien';

/**
 * L'instant d'une réalisation notée « un autre jour » : midi à Paris (10 h ou
 * 11 h UTC), loin de minuit, pour que le jour de Paris lu par le serveur soit
 * bien celui choisi, heure d'été comme d'hiver.
 */
export const middayOf = (day: string): string => `${day}T10:30:00.000Z`;

/**
 * Les groupes de l'écran, dans leur ordre. « Pas encore noté » vient après
 * les gestes datés : un geste dont on ignore la dernière fois n'est pas en
 * retard, et ne doit pas le paraître.
 */
export type GesteGroup = 'retard' | 'bientot' | 'plustard' | 'jamais' | 'archive';
export const GROUP_ORDER: GesteGroup[] = ['retard', 'bientot', 'plustard', 'jamais', 'archive'];

/** Où se range un geste aujourd'hui. `horizon` : le réglage entretienHorizonJours. */
export function gesteGroup(t: TaskItem, today: string, horizon: number): GesteGroup {
  if (t.done) return 'archive';
  if (!t.due) return 'jamais';
  if (windowEnd(t.due, t.rec) < today) return 'retard';
  return t.due <= addDaysIso(today, horizon) ? 'bientot' : 'plustard';
}

/** Le titre d'un groupe. L'horizon est dit tel quel : « Dans les 14 jours », pas « Cette semaine ». */
export function groupLabel(g: GesteGroup, horizon: number): string {
  switch (g) {
    case 'retard': return 'En retard';
    case 'bientot': return `Dans les ${horizon} jours`;
    case 'plustard': return 'Plus tard';
    case 'jamais': return 'Pas encore noté';
    case 'archive': return 'Archivés';
  }
}

/** « toutes les 4 semaines », « tous les 6 mois », « 1 fois par an », « chaque année, à date fixe ». */
export function freqLabel(rec: TaskRec): string {
  const n = Math.max(1, rec.every || 1);
  const one: Record<TaskRec['freq'], string> = { daily: 'chaque jour', weekly: 'chaque semaine', monthly: 'chaque mois', yearly: rec.base === 'due' ? 'chaque année' : '1 fois par an' };
  const many: Record<TaskRec['freq'], string> = { daily: `tous les ${n} jours`, weekly: `toutes les ${n} semaines`, monthly: `tous les ${n} mois`, yearly: `tous les ${n} ans` };
  return (n === 1 ? one[rec.freq] : many[rec.freq]) + (rec.base === 'due' ? ', à date fixe' : '');
}

/** La dernière réalisation, dite : « Fait le 30/09/2026 par Nolwenn », « … par le foyer ». Vide si jamais faite. */
export function lastDoneLabel(t: TaskItem, fmt: (iso: string) => string, name: (id: string) => string): string {
  const h = t.history?.length ? t.history[t.history.length - 1] : null;
  if (!h) return '';
  return `Fait le ${fmt(parisDay(h.at))} par ${h.by ? name(h.by) || 'un membre parti' : 'le foyer'}${h.via ? ' (via un assistant)' : ''}`;
}

/** Une unité au pluriel, simplement : « cartouches », « piles », mais « jeux » ou « bandelettes ». */
export const plural = (unit: string, qty: number): string => (qty > 1 && unit && !/[sxz]$/.test(unit) ? unit + (/(eu|au)$/.test(unit) ? 'x' : 's') : unit);

/** « Stock au 17/10/2026 : 4 cartouches ». */
export function stockLabel(s: MaintenanceStock, fmt: (iso: string) => string): string {
  return `Stock au ${fmt(s.countedAt)} : ${s.qty}${s.unit ? ' ' + plural(s.unit, s.qty) : ''}`;
}

/** Le stock est-il au seuil ou en dessous ? C'est le moment de racheter. */
export const stockLow = (s: MaintenanceStock | undefined): boolean => !!s && s.qty <= s.threshold;

/** La date qui vient, dite : « Le 28/10/2026 », ou la pause. Vide pour un geste jamais noté ou archivé. */
export function nextLabel(t: TaskItem, today: string, fmt: (iso: string) => string): string {
  if (t.done || !t.due) return '';
  const p = t.maintenance?.pausedUntil;
  if (p && p > today) return `En pause jusqu’au ${fmt(p)}`;
  return `Le ${fmt(t.due)}`;
}

/**
 * Ce qu'on saisit pour créer ou modifier un geste. La fréquence se choisit par
 * préréglage : toutes les N semaines, tous les N mois, tous les N ans (à
 * partir de la réalisation), ou chaque année à une date fixe.
 */
export interface GesteDraft {
  text: string;
  howto: string;
  roomId: string | null;
  freq: 'weekly' | 'monthly' | 'yearly';
  every: number;
  /** Date fixe (`base: 'due'`), chaque année ou tous les N ans : la chaudière en octobre. */
  fixed: boolean;
  /** La date fixe (prochaine occurrence), AAAA-MM-JJ. */
  fixedDate: string;
  grace: number;
  who: string[];
  remind: Remind | null;
  stock: { qty: number; unit: string; use: number; threshold: number; article: string } | null;
  /** Dernière fois que le geste a été fait, si on le sait : il part alors de cette date. */
  lastDone: string | null;
  catalogId: string | null;
  /** L'appareil concerné (module Équipements), ou null. */
  equipmentId: number | null;
}

/** La règle de récurrence d'un brouillon. */
export function draftRec(d: GesteDraft): TaskRec {
  return { freq: d.fixed ? 'yearly' : d.freq, every: Math.max(1, Math.min(99, Math.round(d.every) || 1)), base: d.fixed ? 'due' : 'done', ...(d.grace > 0 ? { grace: d.grace } : {}) };
}

/**
 * L'opération qui crée un geste. Une dernière fois connue (`lastDone`) n'y est
 * pas : le store la note ensuite comme une réalisation datée, dont le serveur
 * déduit la prochaine date comme pour toute autre.
 */
export function createOp(d: GesteDraft, id: string): TaskOpDraft {
  const rec = draftRec(d);
  return {
    op: 'add', id, listId: ENTRETIEN_LIST_ID, text: d.text.trim(), who: d.who, due: d.fixed ? d.fixedDate : null,
    rec, remind: d.remind, note: '',
    maintenance: {
      ...(d.roomId ? { roomId: d.roomId } : {}),
      ...(d.howto.trim() ? { howto: d.howto.trim() } : {}),
      ...(d.catalogId ? { catalogId: d.catalogId } : {}),
      ...(d.equipmentId ? { equipmentId: d.equipmentId } : {}),
      ...(d.stock && d.stock.article.trim() ? { stock: { ...d.stock, article: d.stock.article.trim() } } : {}),
    },
  };
}

/** Le brouillon d'un geste existant, pour le formulaire de modification. */
export function draftOf(t: TaskItem): GesteDraft {
  const r = t.rec ?? { freq: 'monthly', every: 1, base: 'done' as const };
  const m = t.maintenance || {};
  return {
    text: t.text, howto: m.howto || '', roomId: m.roomId || null,
    freq: r.freq === 'daily' ? 'weekly' : r.freq, every: r.freq === 'daily' ? Math.max(1, Math.round(r.every / 7)) : r.every,
    fixed: r.base === 'due', fixedDate: t.due || '', grace: r.grace || 0,
    who: [...t.who], remind: t.remind ?? null,
    stock: m.stock ? { qty: m.stock.qty, unit: m.stock.unit, use: m.stock.use, threshold: m.stock.threshold, article: m.stock.article } : null,
    lastDone: null, catalogId: m.catalogId || null, equipmentId: m.equipmentId ?? null,
  };
}

/**
 * Les opérations qui modifient un geste : la fiche (intitulé, cadence, pièce,
 * détail, stock hors quantité). Une date fixe déplacée est une nouvelle
 * échéance ; passer d'une cadence à l'autre garde l'échéance courante.
 */
export function editOps(t: TaskItem, d: GesteDraft): TaskOpDraft[] {
  const rec = draftRec(d);
  const fixedMoved = d.fixed && !!d.fixedDate && d.fixedDate !== t.due;
  return [{
    op: 'edit', id: t.id, text: d.text.trim(), who: d.who, rec, remind: d.remind,
    ...(fixedMoved ? { due: d.fixedDate } : {}),
    maintenance: {
      roomId: d.roomId, howto: d.howto.trim() || null, equipmentId: d.equipmentId,
      // Sans stock avant, la quantité saisie est le stock de départ ; avec, le serveur ne la réécrit pas.
      stock: d.stock && d.stock.article.trim() ? { ...d.stock, article: d.stock.article.trim() } : null,
    },
  }];
}

/** Une ligne du catalogue (GET /api/entretien/catalogue). */
export interface CatalogueEntry {
  id: string; titre: string; howto?: string; famille: string; piece?: string;
  rec: { freq: TaskRec['freq']; every: number; base: 'due' | 'done'; grace?: number };
  article?: { nom: string; unite: string; use: number; seuil: number };
}
export interface Catalogue { pieces: string[]; gestes: CatalogueEntry[]; }

/** Un brouillon vide, ou prérempli depuis une ligne du catalogue. La pièce est résolue par l'appelant. */
export function draftFromCatalogue(e: CatalogueEntry | null, today: string, roomId: string | null): GesteDraft {
  const fixed = !!e && e.rec.base === 'due';
  return {
    text: e?.titre || '', howto: e?.howto || '', roomId,
    freq: !e || e.rec.freq === 'daily' ? (e ? 'weekly' : 'monthly') : e.rec.freq, every: e ? (e.rec.freq === 'daily' ? 1 : e.rec.every) : 1,
    fixed, fixedDate: fixed ? today : '', grace: e?.rec.grace || 0,
    who: [], remind: 'morning',
    stock: e?.article ? { qty: 0, unit: e.article.unite, use: e.article.use, threshold: e.article.seuil, article: e.article.nom } : null,
    lastDone: null, catalogId: e?.id || null, equipmentId: null,
  };
}

/** Le catalogue rangé par famille, dans l'ordre d'apparition, filtré par une recherche tolérante (accents, casse). */
export function catalogueByFamily(c: Catalogue, query: string): { famille: string; gestes: CatalogueEntry[] }[] {
  const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(query.trim());
  const out: { famille: string; gestes: CatalogueEntry[] }[] = [];
  for (const g of c.gestes) {
    if (q && !norm(g.titre + ' ' + g.famille + ' ' + (g.article?.nom || '')).includes(q)) continue;
    const f = out.find((x) => x.famille === g.famille) ?? (out.push({ famille: g.famille, gestes: [] }), out[out.length - 1]);
    f.gestes.push(g);
  }
  return out;
}
