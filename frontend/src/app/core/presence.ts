/**
 * Qui mange à la maison, et donc pour combien on cuisine.
 *
 * Le choix de fond : la semaine type enregistre les **absences**, pas les
 * présences. Dans un foyer, tout le monde est là presque tout le temps ; noter
 * les exceptions demande cinq gestes là où une grille de présences en
 * demanderait vingt et un, et une case oubliée veut alors dire « comme
 * d'habitude » plutôt que « personne ne mange ».
 *
 * Trois niveaux, du plus général au plus précis, chacun l'emportant sur le
 * précédent :
 *
 *   1. la **semaine type** du membre (`Member.absent`), qui vaut toute l'année ;
 *   2. la **dérogation du créneau** (`MealValue.away`), pour le soir où Léa
 *      mange chez une amie ;
 *   3. les **couverts posés à la main** (`MealValue.pax`), qui priment sur tout
 *      parce qu'ils sont le seul moyen de compter des invités.
 */
import { MealValue, Member } from './models';

/** Clé d'une case de la semaine type : « 1-midi ». Lundi vaut 1, dimanche 7. */
export const weekSlot = (weekday: number, slot: string): string => weekday + '-' + slot;

/** Jour de la semaine d'une date ISO, lundi = 1. Lu sans fuseau : la clé est le jour écrit. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const jour = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1)).getUTCDay();
  return jour === 0 ? 7 : jour;
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

/** Un membre est attendu sauf mention contraire : ne rien savoir de lui le compte présent. */
export const expectedAt = (m: Member, weekday: number, slot: string): boolean =>
  !(m.absent || []).includes(weekSlot(weekday, slot));

export function presenceAt(members: Member[], dateStr: string, slot: string, value?: MealValue | null): Presence {
  const jour = weekdayOf(dateStr);
  const derogation = new Set(value?.away || []);
  const present: Member[] = [];
  const away: Member[] = [];
  for (const m of members || []) {
    if (expectedAt(m, jour, slot) && !derogation.has(m.id)) present.push(m);
    else away.push(m);
  }
  const pose = value?.pax;
  const manual = !!(pose && pose > 0);
  // Au moins un couvert : une liste de courses pour zéro personne ne veut rien
  // dire, et le cas arrive dès qu'on marque tout le monde absent par erreur.
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
