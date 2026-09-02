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

/** Les créneaux d'un jour de la semaine, dans l'ordre des heures. */
export function slotsOnDow(sched: SchedSlot[], dow: number): SchedSlot[] {
  return sortSlots((sched || []).filter((s) => s.dow === dow));
}

/** Les créneaux d'une date, dans l'ordre des heures, tous membres confondus. */
export function slotsOn(sched: SchedSlot[], dateStr: string): SchedSlot[] {
  return slotsOnDow(sched, weekdayOf(dateStr));
}

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
