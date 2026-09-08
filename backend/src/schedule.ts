// Récurrence des créneaux d'emploi du temps, portée fidèlement du frontend
// (frontend/src/app/core/schedule.ts) pour que le flux ICS publie exactement ce
// que l'écran dérive. Pur : aucune base, aucun effet de bord, testable seul.
//
// Trois concepts, comme au frontend : une règle hebdomadaire, une fenêtre de
// validité, une liste de dates annulées, plus un filtre scolaire/vacances qui a
// besoin du calendrier. Le repli quand les vacances sont inconnues est d'afficher,
// jamais de cacher (une API tombée ne doit pas faire disparaître l'école).
import { SchedSlot } from './models';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Jour de la semaine d'une date ISO : 1 (lundi) à 7 (dimanche), comme `dow`. */
function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const j = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1)).getUTCDay();
  return j === 0 ? 7 : j;
}

/** Millisecondes du lundi (00:00 UTC) de la semaine contenant `date`. */
function mondayMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.getTime();
}

/** Décalage en jours sur une date ISO. */
export function addDaysIso(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mm + 114) / 31);
  const day = ((h + l - 7 * mm + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Jours fériés de France métropolitaine, en dates ISO, pour une année. */
export function frenchHolidays(year: number): string[] {
  const iso = (dt: Date) => `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  const e = easter(year);
  const plus = (n: number) => { const dt = new Date(e); dt.setUTCDate(dt.getUTCDate() + n); return iso(dt); };
  return [
    `${year}-01-01`, plus(1), `${year}-05-01`, `${year}-05-08`, plus(39), plus(50),
    `${year}-07-14`, `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`,
  ];
}

export interface DayInfo { holiday: boolean; schoolHoliday: boolean | null; }
export type CalendarFacts = (date: string) => DayInfo;

/** Aucune connaissance du calendrier : rien n'est filtré (on affiche). */
export const NO_CALENDAR: CalendarFacts = () => ({ holiday: false, schoolHoliday: null });

/**
 * Les faits calendaires à partir des vacances scolaires. Une liste vide veut dire
 * **inconnue** (`schoolHoliday: null`), pas « aucune vacance » : la source peut
 * être indisponible ou l'académie non renseignée.
 */
export function calendarFacts(schoolHolidays: readonly { start: string; end: string }[]): CalendarFacts {
  const connues = schoolHolidays.length > 0;
  const feries = new Map<string, Set<string>>();
  return (date) => {
    const an = date.slice(0, 4);
    if (!feries.has(an)) feries.set(an, new Set(frenchHolidays(parseInt(an, 10))));
    return {
      holiday: feries.get(an)!.has(date),
      schoolHoliday: connues ? schoolHolidays.some((h) => date >= h.start && date <= h.end) : null,
    };
  };
}

/** Ce créneau a-t-il lieu ce jour-là ? Port fidèle de `occursOn` du frontend. */
export function occursOn(s: SchedSlot, date: string, cal: CalendarFacts = NO_CALENDAR): boolean {
  if (s.rec === 'once') return s.date === date;
  if (weekdayOf(date) !== s.dow) return false;
  if (s.from && date < s.from) return false;
  if (s.until && date > s.until) return false;
  if ((s.skip || []).includes(date)) return false;

  const step = s.interval && s.interval > 1 ? s.interval : 1;
  if (step > 1 && s.from) {
    const weeks = Math.round((mondayMs(date) - mondayMs(s.from)) / (7 * 86_400_000));
    if (weeks % step !== 0) return false;
  }

  const when = s.when || 'always';
  if (when === 'always') return true;
  const jour = cal(date);
  if (jour.schoolHoliday === null) return true;
  const horsEcole = jour.schoolHoliday || jour.holiday;
  return when === 'holidays' ? horsEcole : !horsEcole;
}

/** Une occurrence de créneau publié, résolue pour une date. */
export interface SlotOccurrence { slotId: string; date: string; start: string; end: string; label: string; who: string[]; }

/**
 * Les occurrences des créneaux **publiés à l'agenda** (`sync`) sur une fenêtre
 * [from, to] incluse. Comme à l'écran, elles sont dérivées, jamais stockées.
 */
export function publishedSlotOccurrences(sched: SchedSlot[], from: string, to: string, cal: CalendarFacts = NO_CALENDAR): SlotOccurrence[] {
  const sync = (sched || []).filter((s) => s.sync);
  if (!sync.length) return [];
  const out: SlotOccurrence[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    for (const s of sync) {
      if (occursOn(s, d, cal)) out.push({ slotId: s.id, date: d, start: s.start, end: s.end || '', label: s.label, who: s.who || [] });
    }
  }
  return out;
}
