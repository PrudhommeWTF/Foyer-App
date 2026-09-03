// Recopier une journée de l'emploi du temps sur une autre.
//
// C'est le geste central du module, celui qui décide s'il sera tenu à jour. Nos
// journées se ressemblent : ressaisir chaque créneau un par un est la raison
// pour laquelle l'emploi du temps n'est jamais complet, et un emploi du temps
// incomplet ne sert à rien, donc on le remplit encore moins.
//
// Deux façons de coller, et la différence n'est pas cosmétique :
//
//   - **Fusionner** ajoute ce qui manque et laisse le reste intact. Rien n'est
//     détruit, le geste est sans risque, et un créneau déjà identique n'est pas
//     recopié une seconde fois.
//   - **Remplacer** fait du jour visé la copie du jour source, ce qui **supprime**
//     ce qu'il portait. C'est ce qu'on veut quand on repart de zéro, et c'est
//     destructeur : l'écran le dit avant, et le collage s'annule après.
//
// Ce que « remplacer » supprime exactement : **les créneaux que la vue montre**.
// Le collage copie ce qui est affiché (donc filtré), et il remplace ce qui
// serait affiché au même endroit. Sans cette règle, coller la journée de Léa sur
// mardi effacerait aussi celle de tout le monde, ce que personne n'attend.
//
// Le calcul est séparé de l'écriture pour que le rapport puisse être montré
// d'abord, comme pour la copie des repas (voir meal-copy.ts).

import { SchedSlot } from './models';

export type PasteMode = 'merge' | 'replace';

/**
 * Deux créneaux « les mêmes » : mêmes horaires, même intitulé, même type, mêmes
 * membres. C'est cette signature qui empêche une fusion de créer des doublons,
 * et elle ignore volontairement l'identifiant, qui diffère toujours.
 */
export function signatureOf(s: SchedSlot): string {
  const who = (s.who || []).slice().sort().join('+');
  // La récurrence en fait partie : « tennis le mardi jusqu'en juin » et « tennis
  // le mardi toute l'année » ne sont pas le même créneau, et confondre les deux
  // ferait disparaître le second lors d'une fusion.
  const quand = [s.rec === 'once' ? 'once:' + (s.date || '') : 'weekly', s.from || '', s.until || '', s.when || 'always'].join(':');
  return [s.dow, s.start, s.end || '', s.k, (s.label || '').trim().toLowerCase(), who, quand].join('|');
}

const touches = (s: SchedSlot, scope: readonly string[]): boolean =>
  scope.length ? (s.who || []).some((id) => scope.includes(id)) : !(s.who || []).length;

export interface PastePlan {
  mode: PasteMode;
  /** Créneaux à écrire, identifiant déjà attribué pour que l'annulation les vise. */
  added: SchedSlot[];
  /** Créneaux qui seront supprimés. Jamais vide sans que l'écran le dise. */
  removed: SchedSlot[];
  /** Créneaux identiques déjà présents, laissés tels quels. */
  duplicates: number;
  /** Jours effectivement touchés. */
  targets: number[];
  /** Membres que le collage concerne, et donc ce que « remplacer » remplace. */
  scope: string[];
}

export interface PasteInput {
  sched: SchedSlot[];
  /** Ce qu'on colle : les créneaux copiés, tels que la vue les montrait. */
  source: SchedSlot[];
  /** Jours cibles, ou null pour « chaque créneau reste à son jour ». */
  targetDows: number[] | null;
  mode: PasteMode;
  /** Réattribue tous les créneaux collés à ce membre, à horaires identiques. */
  remap?: string | null;
  /**
   * La date que porte un jour cible, dans la semaine affichée. Un créneau
   * ponctuel collé ailleurs doit changer de date, sinon il resterait accroché au
   * jour d'origine tout en prétendant appartenir à un autre.
   */
  dateFor: (dow: number) => string;
  newId: () => string;
}

/** Calcule ce que le collage ferait, sans rien écrire. */
export function planPaste(input: PasteInput): PastePlan {
  const { sched, source, targetDows, mode, dateFor, newId } = input;
  const remap = input.remap || null;
  const scope = remap ? [remap] : [...new Set(source.flatMap((s) => s.who || []))];

  const paires = targetDows
    ? targetDows.flatMap((dow) => source.map((src) => ({ src, dow })))
    : source.map((src) => ({ src, dow: src.dow }));
  // Coller une journée sur elle-même sans réattribution ne ferait que la
  // dupliquer : c'est toujours une fausse manoeuvre, jamais une intention.
  const utiles = paires.filter((p) => remap || p.dow !== p.src.dow);

  const jours = new Set(utiles.map((p) => p.dow));
  const removed = mode === 'replace'
    ? sched.filter((s) => jours.has(s.dow) && touches(s, scope))
    : [];

  // Les identiques se jugent sur ce qui **restera** : en mode remplacer, un
  // créneau qu'on vient de retirer ne doit pas empêcher de le réécrire.
  const partis = new Set(removed.map((s) => s.id));
  const presentes = new Set(sched.filter((s) => !partis.has(s.id)).map(signatureOf));

  const added: SchedSlot[] = [];
  let duplicates = 0;
  for (const p of utiles) {
    const slot: SchedSlot = {
      ...p.src, id: newId(), dow: p.dow,
      who: remap ? [remap] : [...(p.src.who || [])],
      // Un ponctuel prend la date de son nouveau jour ; la période de validité
      // d'un hebdomadaire, elle, se recopie telle quelle.
      ...(p.src.rec === 'once' ? { date: dateFor(p.dow) } : {}),
    };
    // Les exceptions et le lien vers la série d'origine ne se copient pas : ce
    // sont des dates précises, qui ne veulent rien dire sur un autre jour.
    delete slot.skip;
    delete slot.srcId;
    const sig = signatureOf(slot);
    // La signature retenue vaut aussi pour la suite du collage : coller deux
    // fois la même journée n'écrit pas deux fois les mêmes créneaux.
    if (presentes.has(sig)) { duplicates++; continue; }
    presentes.add(sig);
    added.push(slot);
  }

  return { mode, added, removed, duplicates, targets: [...jours].sort((a, b) => a - b), scope };
}

/** Applique un plan. Les suppressions d'abord, les ajouts ensuite. */
export function applyPaste(sched: SchedSlot[], plan: PastePlan): SchedSlot[] {
  const partis = new Set(plan.removed.map((s) => s.id));
  return [...sched.filter((s) => !partis.has(s.id)), ...plan.added.map((s) => ({ ...s, who: [...s.who] }))];
}

/**
 * Défait un collage.
 *
 * Chirurgical, et c'est tout l'intérêt : on retire **les identifiants qu'on a
 * créés** et on remet **les créneaux qu'on a retirés**, plutôt que de remettre
 * une copie de l'emploi du temps entier. À deux sur l'application, une remise en
 * bloc effacerait en silence ce que l'autre appareil a ajouté entre-temps.
 */
export function undoPaste(sched: SchedSlot[], plan: PastePlan): SchedSlot[] {
  const nouveaux = new Set(plan.added.map((s) => s.id));
  const restants = sched.filter((s) => !nouveaux.has(s.id));
  const presents = new Set(restants.map((s) => s.id));
  return [...restants, ...plan.removed.filter((s) => !presents.has(s.id)).map((s) => ({ ...s, who: [...s.who] }))];
}

const pluriel = (n: number, un: string, plusieurs: string): string => n + ' ' + (n > 1 ? plusieurs : un);

/**
 * Ce que le collage a fait, dit exactement : « 5 créneaux collés sur mardi ».
 * Un collage qui supprime le dit toujours, c'est la règle de la perte non muette.
 */
export function pasteSummary(plan: PastePlan, dayName: (dow: number) => string): string {
  if (!plan.added.length && !plan.removed.length) {
    return plan.duplicates ? 'Ces créneaux étaient déjà là' : 'Rien à coller';
  }
  const ou = plan.targets.length === 1 ? dayName(plan.targets[0]).toLowerCase() : pluriel(plan.targets.length, 'jour', 'jours');
  // Coller une journée vide en mode remplacer, c'est vider la cible. Le dire
  // ainsi plutôt que « 0 créneau collé », qui laisserait croire qu'il ne s'est
  // rien passé alors que quelque chose vient de disparaître.
  if (!plan.added.length) return pluriel(plan.removed.length, 'créneau supprimé', 'créneaux supprimés') + ' sur ' + ou;
  const parts = [pluriel(plan.added.length, 'créneau collé', 'créneaux collés') + ' sur ' + ou];
  if (plan.removed.length) parts.push(pluriel(plan.removed.length, 'remplacé', 'remplacés'));
  return parts.join(', ');
}

/**
 * Ce que le presse-papier retient : une journée, ou la semaine d'un ou plusieurs
 * membres. `dow` ne vaut que pour une journée, et sert à ne pas proposer de la
 * coller sur elle-même.
 */
export interface SchedClip { kind: 'day' | 'week'; dow: number; slots: SchedSlot[]; }
