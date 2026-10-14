// Le formulaire d'un créneau de l'emploi du temps, sans Angular : ce qu'il
// montre à l'ouverture, le créneau qu'il décrit, et s'il change quelque chose.
import { SchedRec, SchedSlot, SchedType, SchedWhen } from './models';
import { addDaysIso, weekdayOf } from './helpers';
import { SCHED_AWAY_DEFAULT } from './constants';

/** Les champs tels que saisis. `every` : une semaine sur `every` (1 = toutes). */
export interface SlotFields {
  rec: SchedRec; every: number; date: string; dow: number;
  who: string[]; start: string; end: string; label: string; type: SchedType;
  away: boolean; sync: boolean; from: string; until: string; when: SchedWhen;
}

/** Ce qu'une création reçoit d'office : le jour choisi, les membres du filtre, l'heure qui suit le dernier créneau. */
export interface SlotDefaults { date: string; who: string[]; start: string; }

/** Le formulaire pré-rempli d'un créneau, ou d'un créneau neuf au jour `d.date`. */
export function slotFields(s: SchedSlot | null, occ: string, d: SlotDefaults): SlotFields {
  if (!s) {
    // La validité part de la première occurrence : une récurrence mise en place
    // aujourd'hui ne doit pas paraître avoir eu lieu les semaines passées.
    return { rec: 'weekly', every: 1, date: d.date, dow: weekdayOf(d.date), who: [...d.who], start: d.start, end: '', label: '',
      type: 'ecole', away: !!SCHED_AWAY_DEFAULT['ecole'], sync: false, from: d.date, until: '', when: 'always' };
  }
  return {
    rec: s.rec === 'once' ? 'once' : 'weekly', every: s.interval && s.interval > 1 ? s.interval : 1,
    date: s.date || occ, dow: s.dow, who: [...(s.who || [])], start: s.start || '', end: s.end || '', label: s.label, type: s.k,
    away: !!s.away, sync: !!s.sync, from: s.from || '', until: s.until || '', when: s.when || 'always',
  };
}

/**
 * Les réglages de période ne se déplient d'office que s'ils sont **utilisés** :
 * un simple début de validité déjà passé (celui que reçoit tout nouveau
 * créneau) n'a rien à montrer ; une fin, un filtre, un démarrage futur ou une
 * cadence d'une semaine sur deux méritent d'être vus.
 */
export function periodShown(f: SlotFields, today: string): boolean {
  if (f.rec !== 'weekly') return false;
  const startedPlain = !!f.from && !f.until && f.when === 'always' && f.every === 1 && f.from <= today;
  return !startedPlain && (!!f.from || !!f.until || f.when !== 'always' || f.every > 1);
}

/** Le lundi de la semaine d'une date : l'ancre d'une récurrence d'une semaine sur deux. */
export const mondayOf = (iso: string): string => addDaysIso(iso, -(weekdayOf(iso) - 1));

/**
 * Le créneau que décrivent les champs, sans identifiant ni exceptions, ou la
 * raison de le refuser (dite telle quelle à l'utilisateur).
 */
export function slotOf(f: SlotFields, occ: string): Omit<SchedSlot, 'id'> | string {
  const label = f.label.trim(); if (!label) return 'Donne un intitulé';
  const start = f.start.trim(); if (!start) return 'Indique une heure de début';
  // Un créneau sans personne ne veut rien dire, et c'est ce qui force la reprise
  // des créneaux orphelins : les rouvrir demande de leur attribuer quelqu'un.
  if (!f.who.length) return 'Choisis au moins un membre';
  if (f.rec === 'once' && !f.date) return 'Indique la date du créneau';
  if (f.rec === 'weekly' && f.from && f.until && f.until < f.from) return 'La fin de période est avant son début';
  const commun = { who: [...f.who], start, end: f.end.trim(), label, k: f.type, ...(f.away ? { away: true } : {}), ...(f.sync ? { sync: true } : {}) };
  if (f.rec === 'once') return { ...commun, rec: 'once', dow: weekdayOf(f.date), date: f.date };
  // Une semaine sur deux a besoin d'une phase : sans début choisi, le lundi de
  // la semaine de l'occurrence ouverte.
  const biweekly = f.every > 1;
  const from = f.from || (biweekly ? mondayOf(occ) : '');
  return {
    ...commun, rec: 'weekly', dow: f.dow,
    ...(biweekly ? { interval: f.every } : {}),
    ...(from ? { from } : {}),
    ...(f.until ? { until: f.until } : {}),
    ...(f.when !== 'always' ? { when: f.when } : {}),
  };
}

// Forme comparable : ce que le formulaire peut changer, valeurs vides confondues.
const shape = (s: Omit<SchedSlot, 'id'>): string => JSON.stringify([
  s.rec, s.rec === 'once' ? s.date || '' : s.dow, [...(s.who || [])].sort(), s.start || '', s.end || '', s.label, s.k, !!s.away, !!s.sync,
  s.rec === 'weekly' ? [s.interval && s.interval > 1 ? s.interval : 1, s.from || '', s.until || '', s.when || 'always'] : null,
]);
/** Le créneau décrit change-t-il le créneau enregistré ? Rien de changé : rien n'est écrit. */
export function slotChanges(s: SchedSlot, forme: Omit<SchedSlot, 'id'>): boolean { return shape(s) !== shape(forme); }
