// La journée de l'emploi du temps.
//
// Les créneaux sont enregistrés par **jour de la semaine** (« Lundi »), pas par
// date : c'est une semaine type, qui vaut toute l'année. Traduire une date en
// nom de jour est donc la seule chose à faire, et elle mérite d'être écrite une
// fois plutôt que devinée à chaque appel.
import { SCHED_DAYS } from './constants';
import { SchedSlot } from './models';
import { weekdayOf } from './presence';

/** Le nom du jour d'une date ISO, tel que l'emploi du temps le nomme. */
export function scheduleDayOf(dateStr: string): string {
  return SCHED_DAYS[weekdayOf(dateStr) - 1] ?? SCHED_DAYS[0];
}

/** Les créneaux d'un jour, dans l'ordre des heures, tous membres confondus. */
export function slotsOn(sched: SchedSlot[], dateStr: string): SchedSlot[] {
  const jour = scheduleDayOf(dateStr);
  return (sched || []).filter((s) => s.day === jour).slice().sort((a, b) => a.start.localeCompare(b.start));
}
