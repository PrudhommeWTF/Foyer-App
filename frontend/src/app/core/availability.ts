// La disponibilité des membres affectés, lue dans l'emploi du temps.
//
// Lecture seule, et c'est le choix : l'emploi du temps dit où sont les gens,
// la tâche dit ce qu'il y a à faire, et personne ne veut qu'une tâche
// « réserve » un créneau ni qu'un créneau déplace une tâche. Ce module propose
// et prévient au moment de choisir la date ; il n'écrit rien nulle part.
//
// Sans membre affecté, il ne dit rien : la disponibilité de personne n'est pas
// celle de tout le monde, et « le premier qui passe » n'a pas d'agenda.
import { addDaysIso } from './helpers';
import { SchedSlot } from './models';
import { CalendarFacts, NO_CALENDAR, filterSlots, slotsOn } from './schedule';

/** « 08:30 » vers 510. Une heure mal formée rend 0 plutôt que NaN. */
const toMin = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
};

/** Les créneaux des membres `who` ce jour-là, dans l'ordre des heures. */
export function busyOn(sched: SchedSlot[], date: string, who: readonly string[], cal: CalendarFacts = NO_CALENDAR): SchedSlot[] {
  if (!who.length) return [];
  return filterSlots(slotsOn(sched, date, cal), who);
}

/**
 * Les créneaux qui couvrent une heure. Un créneau sans fin est un instant : le
 * car de 7h50 n'occupe pas la matinée sous prétexte qu'on n'a pas dit quand il
 * arrive.
 */
export function conflictsAt(slots: SchedSlot[], time: string): SchedSlot[] {
  const t = toMin(time);
  return slots.filter((s) => {
    const a = toMin(s.start);
    const b = s.end ? toMin(s.end) : a;
    return b > a ? t >= a && t < b : t === a;
  });
}

/** Minutes occupées par des créneaux ; un créneau sans fin compte pour zéro. */
export function busyMinutes(slots: SchedSlot[]): number {
  return slots.reduce((n, s) => n + (s.end ? Math.max(0, toMin(s.end) - toMin(s.start)) : 0), 0);
}

export interface DayLoad { date: string; minutes: number; slots: number; }

/**
 * Le jour le plus libre parmi les `days` jours à partir de `from` (inclus) :
 * le moins de minutes occupées, puis le moins de créneaux, puis le plus tôt.
 * Null quand tous se valent : il n'y a alors rien à proposer, et proposer
 * quand même ferait passer un hasard pour un conseil.
 */
export function freestDay(sched: SchedSlot[], who: readonly string[], from: string, days = 7, cal: CalendarFacts = NO_CALENDAR): DayLoad | null {
  if (!who.length || days < 1) return null;
  const loads: DayLoad[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysIso(from, i);
    const slots = busyOn(sched, date, who, cal);
    loads.push({ date, minutes: busyMinutes(slots), slots: slots.length });
  }
  const same = loads.every((l) => l.minutes === loads[0].minutes && l.slots === loads[0].slots);
  if (same) return null;
  return loads.slice().sort((a, b) => a.minutes - b.minutes || a.slots - b.slots || a.date.localeCompare(b.date))[0];
}

/** « École 08:30 à 16:30 », « Car 07:50 ». */
export function slotLabel(s: SchedSlot): string {
  return s.label + ' ' + s.start + (s.end ? ' à ' + s.end : '');
}
