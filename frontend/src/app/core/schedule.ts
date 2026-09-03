// La semaine type de l'emploi du temps.
//
// Les créneaux sont enregistrés par **jour de la semaine** (lundi = 1), pas par
// date : une semaine type, qui vaut toute l'année. Traduire une date en numéro
// de jour est donc la seule chose à faire, et elle mérite d'être écrite une fois
// plutôt que devinée à chaque appel.
//
// Une règle traverse tout ce fichier, et c'est celle de la vue par défaut :
// **aucune sélection veut dire tout le monde, jamais rien.** Un filtre vide ne
// filtre pas, il laisse passer. L'inverse (un écran vide tant qu'on n'a pas
// cliqué) était la raison pour laquelle le module ne servait à rien.
import { SCHED_DAYS } from './constants';
import { frenchHolidays } from './helpers';
import { Member, SchedSlot } from './models';
import { weekdayOf } from './presence';

/** Le nom du jour, pour l'affichage. `dow` va de 1 (lundi) à 7 (dimanche). */
export function dowLabel(dow: number): string {
  return SCHED_DAYS[dow - 1] ?? SCHED_DAYS[0];
}

/**
 * L'ordre d'affichage : par heure de début, puis de fin, puis par intitulé.
 *
 * Les deux critères de repli ne sont pas du zèle : chez nous plusieurs créneaux
 * commencent à la même heure (deux enfants partent à 7h50), et sans ordre stable
 * ils changeraient de place d'un rendu à l'autre.
 */
export function sortSlots(slots: SchedSlot[]): SchedSlot[] {
  return slots.slice().sort((a, b) =>
    (a.start || '').localeCompare(b.start || '')
    || (a.end || '').localeCompare(b.end || '')
    || (a.label || '').localeCompare(b.label || ''));
}

// ---- récurrence -------------------------------------------------------------
//
// Trois concepts, pas plus : une règle hebdomadaire, une fenêtre de validité,
// une liste de dates annulées. C'est le squelette d'iCalendar (RRULE, EXDATE,
// RECURRENCE-ID) réduit à ce qu'un foyer utilise réellement. Une bibliothèque
// saurait exprimer « le troisième mardi ouvré des mois pairs » ; le besoin est
// « toutes les semaines, de septembre à juin, sauf pendant les vacances ».

/** Ce que le calendrier sait d'un jour. */
export interface DayInfo {
  holiday: boolean;
  /**
   * Null quand la source des vacances n'est pas connue (pas de réseau, service
   * en panne, académie non renseignée). Ce n'est **pas** « ce n'est pas les
   * vacances » : la différence décide si l'on cache ou non des créneaux.
   */
  schoolHoliday: boolean | null;
}
export type CalendarFacts = (date: string) => DayInfo;

/**
 * Les faits calendaires du foyer, à partir des vacances de son académie.
 *
 * Une liste vide veut dire **inconnue**, pas « aucune vacance » : il y a
 * toujours des vacances dans une année, donc une liste vide ne peut venir que
 * d'une source indisponible ou d'une académie non renseignée.
 */
export function calendarFacts(schoolHolidays: readonly { start: string; end: string }[]): CalendarFacts {
  const connues = schoolHolidays.length > 0;
  const feries = new Map<string, Set<string>>();
  return (date) => {
    const an = date.slice(0, 4);
    if (!feries.has(an)) feries.set(an, new Set(frenchHolidays(parseInt(an, 10)).map((h) => h.date)));
    return {
      holiday: feries.get(an)!.has(date),
      schoolHoliday: connues ? schoolHolidays.some((h) => date >= h.start && date <= h.end) : null,
    };
  };
}

/** Aucune connaissance du calendrier : rien n'est filtré. Pour les appels sans contexte. */
export const NO_CALENDAR: CalendarFacts = () => ({ holiday: false, schoolHoliday: null });

/**
 * Ce créneau a-t-il lieu ce jour-là ?
 *
 * Le repli quand les vacances ne sont pas connues est une décision, pas un
 * oubli : on **affiche**. Cacher l'école à 7h50 parce qu'une API est tombée est
 * une faute bien pire que de montrer un créneau en trop un jour de vacances.
 */
export function occursOn(s: SchedSlot, date: string, cal: CalendarFacts = NO_CALENDAR): boolean {
  if (s.rec === 'once') return s.date === date;
  if (weekdayOf(date) !== s.dow) return false;
  if (s.from && date < s.from) return false;
  if (s.until && date > s.until) return false;
  if ((s.skip || []).includes(date)) return false;

  const when = s.when || 'always';
  if (when === 'always') return true;
  const jour = cal(date);
  if (jour.schoolHoliday === null) return true;
  // Un jour férié n'est pas un jour d'école, quoi qu'en dise le calendrier des
  // vacances. Qui travaille certains fériés laisse son créneau sur « toujours ».
  const horsEcole = jour.schoolHoliday || jour.holiday;
  return when === 'holidays' ? horsEcole : !horsEcole;
}

/** Les créneaux d'une date, dans l'ordre des heures, tous membres confondus. */
export function slotsOn(sched: SchedSlot[], date: string, cal: CalendarFacts = NO_CALENDAR): SchedSlot[] {
  return sortSlots((sched || []).filter((s) => occursOn(s, date, cal)));
}

/**
 * La période de validité d'un créneau, en français : « du 1er sept. au 30 juin »,
 * « jusqu'au 30 juin », « à partir du 1er sept. ». Vide quand il vaut toujours.
 */
export function validityLabel(s: SchedSlot, fmt: (iso: string) => string): string {
  if (s.rec === 'once') return s.date ? fmt(s.date) : '';
  if (s.from && s.until) return 'du ' + fmt(s.from) + ' au ' + fmt(s.until);
  if (s.until) return 'jusqu’au ' + fmt(s.until);
  if (s.from) return 'à partir du ' + fmt(s.from);
  return '';
}

/**
 * À quoi s'applique une modification ou une suppression d'occurrence.
 *
 *   - `once`   : cette fois seulement. La série saute la date.
 *   - `future` : à partir de cette date. La série est coupée en deux.
 *   - `all`    : toute la série, passé compris.
 */
export type SchedScope = 'once' | 'future' | 'all';

export const WHEN_LABELS: Record<string, string> = {
  always: '', school: 'période scolaire', holidays: 'vacances',
};

/**
 * Le filtre par membre, qui est un **affinage** et non un prérequis.
 *
 * Filtre vide : tout passe. Sinon, un créneau passe s'il porte au moins un des
 * membres retenus. Les créneaux sans membre (dont le membre a été supprimé)
 * passent aussi tant qu'on ne filtre pas : les cacher les rendrait
 * irréparables, puisqu'on ne peut pas sélectionner un membre qui n'existe plus.
 */
export function matchesWho(slot: SchedSlot, who: readonly string[]): boolean {
  if (!who.length) return true;
  return (slot.who || []).some((id) => who.includes(id));
}

export function filterSlots(slots: SchedSlot[], who: readonly string[]): SchedSlot[] {
  return slots.filter((s) => matchesWho(s, who));
}

/** Nombre de marqueurs d'identité affichés avant de compter le débordement. */
export const WHO_SHOWN = 3;

/** Une pastille d'identité : couleur du membre et initiales, jamais la couleur seule. */
export interface WhoBadge { id: string; ini: string; color: string; name: string }

/**
 * Les marqueurs d'un créneau, dans l'ordre des membres du foyer pour qu'une même
 * personne soit toujours à la même place d'une ligne à l'autre.
 *
 * Un identifiant qui ne correspond à plus aucun membre rend une pastille grise
 * « ? » plutôt que rien : un créneau orphelin doit se voir pour se réparer.
 */
export function whoBadges(slot: SchedSlot, members: Member[]): WhoBadge[] {
  const ids = new Set(slot.who || []);
  const out: WhoBadge[] = members.filter((m) => ids.has(m.id)).map((m) => ({ id: m.id, ini: m.ini, color: m.color, name: m.name }));
  const connus = new Set(out.map((b) => b.id));
  for (const id of ids) if (!connus.has(id)) out.push({ id, ini: '?', color: '#8A7E74', name: 'Membre supprimé' });
  return out;
}

// ---- les trous de la journée ------------------------------------------------
//
// La vue en listes absorbe les chevauchements, mais elle fait perdre le sens des
// **trous** : on ne voit plus d'un coup d'oeil qu'il y a trois heures de libre
// entre deux créneaux. Les calculer les rend visibles, et fait d'eux l'endroit
// naturel où taper pour créer un créneau à cette heure-là.

/** Un intervalle libre entre deux créneaux d'une même journée. */
export interface FreeGap { start: string; end: string; minutes: number; }

/** « 08:30 » vers 510. Une heure mal formée rend 0 plutôt que NaN. */
const toMin = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
};

/** Heure de démarrage proposée quand la journée est vide et qu'on n'a rien d'autre. */
export const DEFAULT_START = '08:00';

/**
 * Les intervalles libres d'une journée, à partir de ses créneaux.
 *
 * Un créneau sans heure de fin compte comme un instant : le car scolaire de 7h50
 * n'occupe pas le reste de la matinée sous prétexte qu'on n'a pas dit quand il
 * arrive. Les trous plus courts que `minMinutes` sont ignorés : cinq minutes
 * entre deux cours ne sont pas du temps libre, et les afficher noierait les
 * vrais trous.
 */
export function gapsOf(slots: SchedSlot[], minMinutes = 30): FreeGap[] {
  const out: FreeGap[] = [];
  let fin = '';
  for (const s of sortSlots(slots)) {
    if (fin && toMin(s.start) - toMin(fin) >= minMinutes) {
      out.push({ start: fin, end: s.start, minutes: toMin(s.start) - toMin(fin) });
    }
    const bout = s.end || s.start;
    if (!fin || toMin(bout) > toMin(fin)) fin = bout;
  }
  return out;
}

/**
 * L'heure à proposer pour un nouveau créneau : juste après le dernier de la
 * journée, ou l'heure de démarrage par défaut quand elle est vide. Une saisie
 * qui commence par la bonne heure est une saisie de moins.
 */
export function nextFreeStart(slots: SchedSlot[]): string {
  let fin = '';
  for (const s of slots) {
    const bout = s.end || s.start;
    if (!fin || toMin(bout) > toMin(fin)) fin = bout;
  }
  return fin || DEFAULT_START;
}

/**
 * Les intitulés déjà employés dans le foyer, les plus fréquents d'abord.
 *
 * C'est la réponse sobre aux « modèles de créneaux » : une bibliothèque de
 * modèles serait une seconde chose à tenir à jour, alors que proposer ce qu'on a
 * déjà écrit coûte une ligne et couvre le même besoin (« École », « Car »,
 * « Cabinet » reviennent tous les jours).
 */
export function knownLabels(sched: SchedSlot[]): string[] {
  const compte = new Map<string, number>();
  for (const s of sched || []) {
    const l = (s.label || '').trim();
    if (l) compte.set(l, (compte.get(l) || 0) + 1);
  }
  return [...compte.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
}
