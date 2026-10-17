// Les outils d'assistant du module Entretien. Un geste est une tâche de la
// liste Entretien : ces outils écrivent par les mêmes opérations que l'écran
// (applyTaskOps), donc mêmes règles (une réalisation par jour, date suivante
// calculée par le serveur depuis le jour du geste, stock repris d'un coup),
// même journal, et l'attribution « via » l'assistant.
//
// Tous les membres y ont accès (rien de sensible) ; les outils d'écriture ne
// sont offerts qu'à un jeton write, et tous disparaissent avec le module.
import { db, getHousehold, saveHousehold } from '../db';
import type { HouseholdState, Room, TaskItem } from '../models';
import { applyTaskOps } from '../tasks/repo';
import { parisDay } from '../tasks/ops';
import { recLabel, windowEnd } from '../tasks/recurrence';
import { effectiveSetting } from '../settings/repo';
import { listItems as eqpItems } from '../equipements/repo';
import { ENTRETIEN_LIST_ID } from '../entretien/list';
import type { McpCtx } from './tools';
import { parseFrequence } from '../entretien/frequence';

const state = (): HouseholdState => getHousehold().state as HouseholdState;
const norm = (s: string): string => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const genId = (p: string): string => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fr = (iso: string): string => iso.split('-').reverse().join('/');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const today = (): string => parisDay(new Date().toISOString());
const addDays = (iso: string, n: number): string => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);
/** Midi à Paris ce jour-là, loin de minuit : le jour lu par le serveur est bien celui dit. */
const midday = (day: string): string => `${day}T10:30:00.000Z`;

const gestes = (s: HouseholdState): TaskItem[] => (s.tasks || []).filter((t) => t.listId === ENTRETIEN_LIST_ID && !t.parentId);
const eqpOn = (): boolean => effectiveSetting('modEquipements') !== false;
const eqpName = (id: number | undefined): string => (id && eqpOn() ? eqpItems(true).find((i) => i.id === id)?.name || '' : '');
const roomName = (s: HouseholdState, id: string | undefined): string => (id ? (s.rooms || []).find((r) => r.id === id)?.name || '' : '');
const memberName = (s: HouseholdState, id: string | null): string => (id ? s.members.find((m) => m.id === id)?.name || 'un membre parti' : 'le foyer');

/** Un geste par identifiant, ou par intitulé (début ou contenu, sans accents). Rend les candidats en cas de doute. */
function resolve(s: HouseholdState, q: string): TaskItem | string {
  const all = gestes(s);
  const byId = all.find((t) => t.id === q.trim());
  if (byId) return byId;
  const n = norm(q);
  if (!n) return 'Précisez le geste (son intitulé ou son [id], voir entretien_liste).';
  const exact = all.filter((t) => norm(t.text) === n);
  const hits = exact.length ? exact : all.filter((t) => norm(t.text).includes(n));
  if (hits.length === 1) return hits[0];
  if (!hits.length) return `Aucun geste ne correspond à « ${q} ». Voir entretien_liste.`;
  return `Plusieurs gestes correspondent à « ${q} » : ${hits.slice(0, 6).map((t) => `${t.text} [${t.id}]`).join(' ; ')}. Précisez.`;
}

/** Une ligne de geste, telle que l'assistant la lit. */
function line(s: HouseholdState, t: TaskItem, day: string): string {
  const m = t.maintenance || {};
  const h = t.history?.length ? t.history[t.history.length - 1] : null;
  const parts = [`${t.text} [${t.id}]`];
  const where = [roomName(s, m.roomId), eqpName(m.equipmentId)].filter(Boolean).join(', ');
  if (where) parts.push(where);
  if (t.rec) parts.push(recLabel(t.rec).toLowerCase());
  parts.push(h ? `fait le ${fr(parisDay(h.at))} par ${memberName(s, h.by)}${h.via ? ' (via un assistant)' : ''}` : 'pas encore noté');
  if (t.done) parts.push('archivé');
  else if (m.pausedUntil && m.pausedUntil > day) parts.push(`en pause jusqu’au ${fr(m.pausedUntil)}`);
  else if (t.due) parts.push(`prochaine fois le ${fr(t.due)}${windowEnd(t.due, t.rec) < day ? ' (en retard)' : ''}`);
  if (m.stock) parts.push(`stock : ${m.stock.qty}${m.stock.unit ? ' ' + m.stock.unit : ''}${m.stock.qty <= m.stock.threshold ? ' (bas, racheter : ' + m.stock.article + ')' : ''}`);
  return '- ' + parts.join(' · ');
}

export function entretienListe(_ctx: McpCtx, a: { quand?: string; piece?: string; equipement?: string }): string {
  const s = state();
  const day = today();
  const quand = a.quand === 'retard' || a.quand === 'tous' ? a.quand : 'semaine';
  let list = gestes(s).filter((t) => !t.done);
  if (quand === 'retard') list = list.filter((t) => !!t.due && windowEnd(t.due, t.rec) < day);
  if (quand === 'semaine') list = list.filter((t) => !!t.due && t.due <= addDays(day, 7));
  if (a.piece?.trim()) list = list.filter((t) => norm(roomName(s, t.maintenance?.roomId)).includes(norm(a.piece!)));
  if (a.equipement?.trim()) list = list.filter((t) => norm(eqpName(t.maintenance?.equipmentId)).includes(norm(a.equipement!)));
  list.sort((x, y) => (x.due || '9999').localeCompare(y.due || '9999') || x.text.localeCompare(y.text, 'fr'));
  const titre = quand === 'retard' ? 'Gestes d’entretien en retard' : quand === 'semaine' ? 'Gestes d’entretien d’ici 7 jours (retards compris)' : 'Tous les gestes d’entretien';
  if (!list.length) {
    return quand === 'tous' ? 'Aucun geste d’entretien noté. On en crée un avec entretien_creer.' : `${titre} : rien. Les gestes jamais notés n’ont pas de date et ne sont jamais en retard.`;
  }
  return `${titre} :\n` + list.map((t) => line(s, t, day)).join('\n');
}

export function entretienFait(ctx: McpCtx, a: { id: string; date?: string; par?: string }): string {
  const s = state();
  const g = resolve(s, a.id || '');
  if (typeof g === 'string') return g;
  if (g.done) return `« ${g.text} » est archivé : réactivez-le dans Foyer d’abord.`;
  const day = a.date && ISO.test(a.date) ? a.date : today();
  if (day > today()) return 'Un geste se note une fois fait, pas à l’avance.';
  let by: string | null = ctx.memberId;
  if (a.par?.trim()) {
    if (/^(le )?foyer$/.test(norm(a.par))) by = null;
    else {
      const m = s.members.find((x) => norm(x.name) === norm(a.par!));
      if (!m) return `Aucun membre « ${a.par} ». Membres : ${s.members.map((x) => x.name).join(', ')}, ou « le foyer ».`;
      by = m.id;
    }
  }
  const avant = g.history?.length || 0;
  const r = applyTaskOps([{ op: 'done', opId: genId('op'), id: g.id, occ: g.due || '', at: midday(day), by, via: ctx.via }]);
  if (r.skipped.length) return r.skipped[0].reason;
  const t = gestes(state()).find((x) => x.id === g.id)!;
  if ((t.history?.length || 0) === avant) return `« ${t.text} » était déjà noté ce jour-là : rien de plus.`;
  const st = t.maintenance?.stock;
  return `Noté : « ${t.text} », fait le ${fr(day)} par ${memberName(s, by)}.`
    + (t.due ? ` Prochaine fois le ${fr(t.due)}.` : '')
    + (st ? ` Stock : ${st.qty}${st.unit ? ' ' + st.unit : ''}${st.qty <= st.threshold ? ` (bas : « ${st.article} » est à racheter)` : ''}.` : '');
}

export function entretienCreer(ctx: McpCtx, a: { titre: string; frequence: string; piece?: string; equipement?: string; stock?: { qte?: number; unite?: string; article?: string; seuil?: number } }): string {
  const titre = (a.titre || '').trim();
  if (!titre) return 'Donnez le geste (« Carafe filtrante : changer la cartouche »).';
  const f = parseFrequence(a.frequence || '');
  if (!f) return `Fréquence illisible : « ${a.frequence} ». Exemples : « toutes les 4 semaines », « tous les 6 mois », « 1 fois par an ».`;
  let equipmentId: number | null = null;
  if (a.equipement?.trim()) {
    if (!eqpOn()) return 'Le module Équipements est désactivé : pas d’équipement à rattacher.';
    const hits = eqpItems(false).filter((i) => norm(i.name).includes(norm(a.equipement!)));
    if (hits.length !== 1) return hits.length ? `Plusieurs équipements correspondent : ${hits.map((i) => i.name).join(', ')}.` : `Aucun équipement « ${a.equipement} ».`;
    equipmentId = hits[0].id;
  }
  // La pièce, retrouvée par son nom ou créée : comme à l'écran.
  let roomId: string | null = null;
  if (a.piece?.trim()) {
    const nom = a.piece.trim().slice(0, 60);
    roomId = db.transaction((): string => {
      const s = state();
      const found = (s.rooms || []).find((r) => norm(r.name) === norm(nom));
      if (found) return found.id;
      const room: Room = { id: genId('p'), name: nom, position: (s.rooms || []).length };
      s.rooms = [...(s.rooms || []), room];
      saveHousehold(s);
      return room.id;
    })();
  }
  const st = a.stock && a.stock.article?.trim()
    ? { article: a.stock.article.trim(), unit: (a.stock.unite || '').trim(), qty: Math.max(0, Math.round(a.stock.qte ?? 0)), use: 1, threshold: Math.max(0, Math.round(a.stock.seuil ?? 1)) }
    : null;
  const id = genId('t');
  const r = applyTaskOps([{
    op: 'add', opId: genId('op'), id, listId: ENTRETIEN_LIST_ID, text: titre, who: [], due: null,
    rec: { ...f, base: 'done' }, remind: 'morning', by: ctx.memberId, via: ctx.via,
    maintenance: { ...(roomId ? { roomId } : {}), ...(equipmentId ? { equipmentId } : {}), ...(st ? { stock: st } : {}) },
  }]);
  if (r.skipped.length) return r.skipped[0].reason;
  return `Geste créé : « ${titre} » [${id}], ${recLabel({ ...f, base: 'done' }).toLowerCase()}. Il reste « pas encore noté » (sans date ni rappel) jusqu’à la première fois : entretien_fait le note.`;
}

export function entretienStock(ctx: McpCtx, a: { id: string; qte: number; mode?: string; date?: string }): string {
  const s = state();
  const g = resolve(s, a.id || '');
  if (typeof g === 'string') return g;
  const st = g.maintenance?.stock;
  if (!st) return `« ${g.text} » n’a pas de stock suivi.`;
  if (typeof a.qte !== 'number' || !Number.isInteger(a.qte)) return 'Donnez une quantité entière.';
  const compte = a.mode === 'compte';
  const r = applyTaskOps([{ op: 'stock', opId: genId('op'), id: g.id, ...(compte ? { set: a.qte } : { add: a.qte }), ...(a.date && ISO.test(a.date) ? { on: a.date } : {}), by: ctx.memberId, via: ctx.via }]);
  if (r.skipped.length) return r.skipped[0].reason;
  const now = gestes(state()).find((x) => x.id === g.id)?.maintenance?.stock;
  return `Stock de « ${g.text} » : ${now?.qty ?? '?'}${st.unit ? ' ' + st.unit : ''} au ${fr(now?.countedAt || today())}.`;
}

export function entretienPause(ctx: McpCtx, a: { id: string; jusqu_au: string }): string {
  const s = state();
  const g = resolve(s, a.id || '');
  if (typeof g === 'string') return g;
  if (!a.jusqu_au || !ISO.test(a.jusqu_au) || a.jusqu_au <= today()) return 'Donnez une date de reprise à venir (AAAA-MM-JJ).';
  const r = applyTaskOps([{ op: 'edit', opId: genId('op'), id: g.id, due: a.jusqu_au, maintenance: { pausedUntil: a.jusqu_au }, by: ctx.memberId, via: ctx.via }]);
  if (r.skipped.length) return r.skipped[0].reason;
  return `« ${g.text} » en pause jusqu’au ${fr(a.jusqu_au)} : il revient tout seul ce jour-là, rappel compris.`;
}
