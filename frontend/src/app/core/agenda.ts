// La journée du foyer, telle que le module Calendrier la compose.
//
// Ces fonctions sont pures pour que la tuile d'accueil les appelle au lieu de
// refaire le tri : c'est la seule façon qu'un changement de règle de récurrence,
// ou l'ajout d'un repère de journée, atteigne l'accueil sans que personne n'y
// pense.
import { CAL_KINDS } from './constants';
import { ageOn, frenchHolidays, isBirthdayOn, occursOn } from './helpers';
import { taskOccursOn } from './recurrence';
import { EventItem, HouseholdState } from './models';

/** Un repère de journée qui n'est pas un événement : férié, anniversaire, tâche, échéance. `id` : la tâche qu'un tap ouvre. `done` : tâche faite, à barrer comme dans la liste. */
export interface DayExtra { kind: string; label: string; color: string; sub?: string; id?: string; done?: boolean; }
export interface SchoolHoliday { name: string; start: string; end: string; zone: string; }

/** Une plage de vacances scolaires posée en barre continue sur une grille : de la colonne `col` (1-based), sur `span` jours, sur la voie `lane`. `startsHere`/`endsHere` disent si la barre commence/finit vraiment ici ou déborde de la plage affichée. */
export interface HolidayBand { name: string; color: string; col: number; span: number; lane: number; startsHere: boolean; endsHere: boolean; }

/** Jours écoulés depuis l'époque pour une date ISO, en UTC : insensible au fuseau et aux changements d'heure, ce qui suffit pour compter des colonnes. */
function isoDays(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y || 1970, (m || 1) - 1, d || 1) / 86_400_000);
}

/**
 * Les vacances scolaires qui touchent la plage affichée `[rangeStart, rangeEnd]`,
 * en barres étalées plutôt qu'en pastille répétée chaque jour. Chaque plage est
 * bornée à la fenêtre (une barre qui déborde le dit par `startsHere`/`endsHere`),
 * et rangée par voie pour ne jamais se chevaucher, comme les événements « journée
 * entière ». Un foyer a une seule académie, donc ses vacances ne se chevauchent
 * pas : en pratique une seule voie, mais la logique tient si un jour deux plages
 * se touchent.
 */
export function holidayBands(holidays: SchoolHoliday[], rangeStart: string, rangeEnd: string, color: string): HolidayBand[] {
  const base = isoDays(rangeStart);
  const touching = holidays
    .filter((h) => h.end >= rangeStart && h.start <= rangeEnd)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const laneEnd: number[] = [];
  const bands: HolidayBand[] = [];
  for (const h of touching) {
    const s = h.start < rangeStart ? rangeStart : h.start;
    const e = h.end > rangeEnd ? rangeEnd : h.end;
    const col = isoDays(s) - base + 1;
    const span = isoDays(e) - isoDays(s) + 1;
    let lane = laneEnd.findIndex((end) => end < col);
    if (lane === -1) { lane = laneEnd.length; laneEnd.push(0); }
    laneEnd[lane] = col + span - 1;
    bands.push({ name: h.name, color, col, span, lane, startsHere: s === h.start, endsHere: e === h.end });
  }
  return bands;
}

/** Les événements d'un jour, dans l'ordre des heures. Une heure vide vaut « — ». */
export function eventsOn(events: EventItem[], ds: string): EventItem[] {
  return (events || []).filter((e) => occursOn(e, ds)).slice().sort((a, b) => a.time.localeCompare(b.time));
}

export interface DayInput {
  doc: HouseholdState;
  schoolHolidays: SchoolHoliday[];
  /**
   * Repères poussés par les modules qui ne vivent pas dans le document, indexés
   * par date : les échéances de contrat. Ils sont **calculés** ailleurs et
   * jamais recopiés ici, pour qu'une date qui change change son repère.
   */
  external: Record<string, DayExtra[]>;
}

/**
 * Tout ce qui marque un jour hors des événements : jour férié, vacances
 * scolaires, anniversaires, tâches planifiées, échéances de contrat.
 */
export function dayExtrasOn(ds: string, input: DayInput): DayExtra[] {
  const d = input.doc;
  const out: DayExtra[] = [];
  const h = frenchHolidays(parseInt(ds.slice(0, 4), 10)).find((x) => x.date === ds);
  if (h) out.push({ kind: 'holiday', label: h.name, color: CAL_KINDS['holiday'].color });
  for (const sh of input.schoolHolidays) { if (ds >= sh.start && ds <= sh.end) { out.push({ kind: 'school', label: sh.name, color: CAL_KINDS['school'].color }); break; } }
  for (const m of d.members) { if (isBirthdayOn(m.birthday, ds)) { const a = ageOn(m.birthday!, ds); out.push({ kind: 'birthday', label: 'Anniv. ' + m.name, color: m.color, sub: a != null ? a + ' ans' : undefined }); } }
  for (const c of d.contacts) { if (isBirthdayOn(c.birthday, ds)) { const a = ageOn(c.birthday!, ds); out.push({ kind: 'birthday', label: 'Anniv. ' + c.name, color: CAL_KINDS['birthday'].color, sub: a != null ? a + ' ans' : undefined }); } }
  // Une tâche récurrente apparaît sur chacune de ses occurrences, pas seulement à
  // son échéance courante : « faite » ne vaut que pour celle-ci, une occurrence
  // projetée n'a pas encore été faite.
  for (const t of d.tasks) { if (taskOccursOn(t, ds)) { const fait = t.done && t.due === ds; out.push({ kind: 'task', label: t.text, color: CAL_KINDS['task'].color, sub: fait ? 'faite' : (t.time || undefined), id: t.id, done: fait }); } }
  out.push(...(input.external[ds] || []));
  return out;
}
