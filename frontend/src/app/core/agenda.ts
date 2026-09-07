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
