/**
 * Qui mange à la maison, et donc pour combien on cuisine.
 *
 * Le choix de fond a changé, et c'est le sujet de cette tranche : la présence
 * **se déduit de l'emploi du temps** au lieu d'être ressaisie. Le module savait
 * déjà que Léa est au collège le lundi midi ; lui redemander dans une grille
 * d'absences tenue à la main, c'était deux sources de vérité pour un seul fait,
 * dont la seconde se démodait en silence.
 *
 * Trois niveaux, du plus général au plus précis, chacun l'emportant sur le
 * précédent :
 *
 *   1. l'**emploi du temps** : un créneau marqué « hors du foyer » qui couvre
 *      l'heure du repas retire ceux qu'il concerne ;
 *   2. la **dérogation du créneau** (`MealValue.away`), pour le soir où Léa
 *      mange chez une amie ;
 *   3. les **couverts posés à la main** (`MealValue.pax`), qui priment sur tout
 *      parce qu'ils sont le seul moyen de compter des invités.
 *
 * Le sens de l'erreur est choisi : en cas de doute, on compte **présent**. Trop
 * de couverts fait un reste au frigo ; pas assez fait quelqu'un qui n'a rien
 * dans son assiette.
 */
import { MEAL_SLOTS } from './constants';
import { MealValue, Member, SchedSlot } from './models';
import { CalendarFacts, NO_CALENDAR, occursOn } from './schedule';

/** L'heure de référence d'un créneau de repas, celle que le foyer a réglée. */
const mealAt = (slot: string): string => MEAL_SLOTS.find((s) => s.key === slot)?.at || '12:00';

/**
 * Les membres que l'emploi du temps place **hors du foyer** à l'heure de ce repas.
 *
 * C'est l'interface de lecture du module : le planning des repas passe par elle
 * et ne fouille jamais dans `sched`. Elle rend un ensemble d'identifiants, pas
 * des créneaux : ce que Cuisine a besoin de savoir, c'est qui manque, pas
 * pourquoi.
 *
 * La règle est volontairement stricte : le créneau doit **couvrir l'heure du
 * repas** (début inclus, fin exclue), pas seulement la frôler. Un créneau sans
 * heure de fin ne retire donc personne, et une course de 12h à 12h30 ne fait pas
 * sauter le déjeuner de 12h30. C'est le sens d'erreur voulu.
 */
export function awayAt(sched: SchedSlot[], date: string, slot: string, cal: CalendarFacts = NO_CALENDAR): Set<string> {
  const at = mealAt(slot);
  const out = new Set<string>();
  for (const s of sched || []) {
    if (!s.away || !s.end) continue;
    if (s.start > at || at >= s.end) continue;
    if (!occursOn(s, date, cal)) continue;
    for (const id of s.who || []) out.add(id);
  }
  return out;
}

export interface Presence {
  present: Member[];
  /** Absents, tous motifs confondus, pour dire pourquoi le compte a baissé. */
  away: Member[];
  /** Couverts retenus : les présents, ou le chiffre posé à la main s'il y en a un. */
  pax: number;
  /** Vrai quand `pax` vient d'une saisie et non du décompte des présents. */
  manual: boolean;
}

/** Ce qu'il faut connaître du foyer pour compter les couverts d'un repas. */
export interface PresenceInput {
  members: Member[];
  /** L'emploi du temps, seule source des absences régulières. */
  sched: SchedSlot[];
  /** Les faits calendaires, pour que les vacances comptent tout le monde à la maison. */
  cal?: CalendarFacts;
}

export function presenceAt(input: PresenceInput, dateStr: string, slot: string, value?: MealValue | null): Presence {
  const dehors = awayAt(input.sched || [], dateStr, slot, input.cal);
  const derogation = new Set(value?.away || []);
  const present: Member[] = [];
  const away: Member[] = [];
  for (const m of input.members || []) {
    if (!dehors.has(m.id) && !derogation.has(m.id)) present.push(m);
    else away.push(m);
  }
  const pose = value?.pax;
  const manual = !!(pose && pose > 0);
  // Au moins un couvert : une liste de courses pour zéro personne ne veut rien
  // dire, et le cas arrive dès qu'un créneau couvre tout le monde par erreur.
  return { present, away, pax: manual ? pose! : Math.max(present.length, 1), manual };
}

/**
 * « 4 couverts », ou « 3 couverts (sans Léa) » quand le compte a baissé.
 *
 * Tourné sans accord : l'application ne connaît pas le genre de ses membres, et
 * « Paul absente » sur le prénom d'un enfant est le genre de détail qui décrédibilise
 * tout le reste.
 */
export function paxLabel(p: Presence): string {
  const base = p.pax + (p.pax > 1 ? ' couverts' : ' couvert');
  if (p.manual || !p.away.length) return base;
  return base + ' (sans ' + p.away.map((m) => m.name).join(', ') + ')';
}
