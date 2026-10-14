// Une occurrence d'un événement récurrent, ou toute la série.
//
// Une série d'événements ne porte qu'une liste de dates sautées (`skip`) : c'est
// le même dispositif que les créneaux de l'emploi du temps. « Cette occurrence
// seulement » saute la date dans la série et crée à côté un événement ponctuel
// qui porte la modification ; une occurrence retouchée n'est donc pas un
// troisième type d'objet, et le flux ICS la rend par un EXDATE plus un VEVENT.
import { EventItem, Recur } from './models';
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

// Forme canonique : un événement sans heure est une journée entière, drapeau
// posé ou non (les anciens événements ne le portent pas), et n'a pas d'heure de fin.
const norm = (d: EventDraft): string => {
  const allDay = !!d.allDay || !d.time || d.time === '—';
  return JSON.stringify([d.date, d.title, allDay ? '' : d.time, allDay ? null : d.endTime || null, d.place || null, allDay,
    [...(d.who || [])].sort(), d.recur || 'none', d.end || null]);
};
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

/**
 * Les champs du formulaire, tels que saisis. Ouvert sur une occurrence d'une
 * série, la date montrée est celle de l'occurrence.
 */
export interface EventFields {
  title: string; start: string; end: string; allDay: boolean; time: string; endTime: string;
  place: string; who: string[]; recur: Recur;
}

/** Le formulaire pré-rempli d'un événement existant, ou vierge pour une création au jour `date`. */
export function eventFields(ev: EventItem | null, occ: string, date: string): EventFields {
  if (!ev) return { title: '', start: date, end: '', allDay: false, time: '', endTime: '', place: '', who: [], recur: 'none' };
  const allDay = !!ev.allDay || !ev.time || ev.time === '—';
  return {
    title: ev.title, start: occ && isSeries(ev) ? occ : ev.date, end: ev.end || '', allDay, time: allDay ? '' : ev.time,
    endTime: allDay ? '' : ev.endTime || '', place: ev.place || '', who: [...(ev.who || [])], recur: (ev.recur || 'none') as Recur,
  };
}

/**
 * Les champs saisis, mis au propre : journée entière sans heure, heure de fin
 * gardée seulement si elle suit le début (sinon « 18:00 - 09:00 »). Null sans
 * titre : le formulaire le signale.
 */
export function eventDraft(f: EventFields): EventDraft | null {
  const title = f.title.trim(); if (!title) return null;
  const t = f.time.trim(), et = f.endTime.trim();
  return {
    date: f.start, title, time: f.allDay ? '—' : (t || '—'), endTime: f.allDay ? null : (t && et && et > t ? et : null),
    place: f.place.trim() || null, allDay: f.allDay || undefined, who: [...f.who], recur: f.recur, end: f.end || null,
  };
}

/** Retire un événement de la liste, et de quoi le remettre exactement à sa place. */
export function withoutEvent(list: EventItem[], id: string): { list: EventItem[]; restore: (cur: EventItem[]) => EventItem[] } {
  const at = list.findIndex((e) => e.id === id);
  if (at < 0) return { list, restore: (cur) => cur };
  const ev = list[at];
  return {
    list: list.filter((e) => e.id !== id),
    // Rendu tel qu'il était, à son rang, sauf s'il est revenu entre-temps.
    restore: (cur) => (cur.some((e) => e.id === id) ? cur : [...cur.slice(0, at), ev, ...cur.slice(at)]),
  };
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
/**
 * La récurrence d'une série, en clair : « Tous les mardis », « Un mardi sur
 * deux », « Le 1er de chaque mois ». Le jour se lit sur le départ de la série.
 * Vide pour un événement ponctuel.
 */
export function recurText(ev: Pick<EventItem, 'recur' | 'date'>): string {
  const d = parseDay(ev.date);
  const jour = JOURS[d.getDay()];
  switch (ev.recur) {
    case 'daily': return 'Tous les jours';
    case 'weekday': return 'Du lundi au vendredi';
    case 'weekly': return `Tous les ${jour}s`;
    case 'biweekly': return `Un ${jour} sur deux`;
    case 'monthly': return `Le ${d.getDate() === 1 ? '1er' : d.getDate()} de chaque mois`;
    default: return '';
  }
}
