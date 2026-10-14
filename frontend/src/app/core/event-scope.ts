// Une occurrence d'un événement récurrent, ou toute la série.
//
// Une série d'événements ne porte qu'une liste de dates sautées (`skip`) : c'est
// le même dispositif que les créneaux de l'emploi du temps. « Cette occurrence
// seulement » saute la date dans la série et crée à côté un événement ponctuel
// qui porte la modification ; une occurrence retouchée n'est donc pas un
// troisième type d'objet, et le flux ICS la rend par un EXDATE plus un VEVENT.
import { EventItem } from './models';
import { parseDay } from './helpers';

export type EventScope = 'one' | 'all';

/** Les champs que le formulaire d'événement édite. */
export type EventDraft = Pick<EventItem, 'date' | 'title' | 'time' | 'endTime' | 'place' | 'allDay' | 'who' | 'recur' | 'end'>;

export const isSeries = (ev: Pick<EventItem, 'recur'>): boolean => (ev.recur || 'none') !== 'none';

const DAY = 86_400_000;
function addDays(iso: string, n: number): string {
  const d = parseDay(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const daysBetween = (a: string, b: string): number => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / DAY);

/**
 * Date de départ de la série quand le formulaire a été ouvert sur une
 * occurrence. Le formulaire montre la date de l'occurrence : laissée telle
 * quelle, la série garde son départ ; déplacée de deux jours, toute la série se
 * décale d'autant (« ce mardi devient mercredi, et les suivants aussi »).
 */
export function seriesDate(seriesStart: string, occ: string, draftDate: string): string {
  return draftDate === occ ? seriesStart : addDays(seriesStart, daysBetween(occ, draftDate));
}

const norm = (d: EventDraft): string => JSON.stringify([
  d.date, d.title, d.time, d.endTime || null, d.place || null, !!d.allDay, [...(d.who || [])].sort(), d.recur || 'none', d.end || null,
]);
/** Le brouillon change-t-il quelque chose ? Sauvegarder sans rien toucher ne doit rien écrire, pas même la date de modification. */
export function draftChanges(ev: EventItem, draft: EventDraft): boolean { return norm(ev) !== norm(draft); }

const sortedSet = (xs: string[]): string[] => [...new Set(xs)].sort();
export function withSkip(ev: EventItem, date: string): EventItem { return { ...ev, skip: sortedSet([...(ev.skip || []), date]) }; }
export function withoutSkip(ev: EventItem, date: string): EventItem {
  const { skip: _old, ...rest } = ev;
  const skip = (_old || []).filter((d) => d !== date);
  return skip.length ? { ...rest, skip } : rest;
}

/**
 * Applique un brouillon à toute la série. Un départ déplacé emporte les dates
 * sautées avec lui : sinon le jeudi qu'on avait retiré réapparaîtrait, et un
 * vendredi jamais retiré disparaîtrait.
 */
export function applyToSeries(ev: EventItem, draft: EventDraft, by: string | null, at: string): EventItem {
  const shift = daysBetween(ev.date, draft.date);
  const out: EventItem = { ...ev, ...draft, who: [...draft.who], upBy: by, upAt: at };
  if (shift && ev.skip?.length) out.skip = sortedSet(ev.skip.map((d) => addDays(d, shift)));
  return out;
}

/** « Cette occurrence seulement » : la série saute la date, un événement ponctuel porte la modification. */
export function detachOccurrence(ev: EventItem, occ: string, draft: EventDraft, id: string, by: string | null, at: string): { series: EventItem; single: EventItem } {
  const single: EventItem = { ...draft, id, who: [...draft.who], recur: 'none', by, at };
  return { series: withSkip(ev, occ), single };
}
