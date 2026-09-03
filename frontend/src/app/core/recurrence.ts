// Le moteur de récurrence des tâches : quand revient une tâche qu'on vient de
// faire.
//
// Il vit côté client, et lui seul : le serveur reçoit l'occurrence suivante
// avec la coche et vérifie sa forme, pas son calcul. C'est cohérent avec le
// reste de l'application (le store frontend porte la logique métier), et ça
// évite deux moteurs identiques dans deux paquets qui ne partagent aucun code.
//
// Deux modes, explicites, et c'est ce qui compte vraiment chez nous :
//
//   - **À date fixe** (`base: 'due'`) : les poubelles du mardi. La suivante est
//     la première date de la règle **strictement après** la plus tardive des
//     deux, échéance ou réalisation. Faite avec trois semaines de retard, la
//     série ne rattrape pas les occurrences manquées : elles ne sont plus à
//     faire, et l'accumuler serait un reproche.
//   - **Après la réalisation** (`base: 'done'`) : le test de l'eau de la piscine,
//     toutes les semaines à partir du moment où il a été fait. Fait le dimanche
//     avec deux jours de retard, la suivante tombe le dimanche d'après, pas le
//     samedi. Les jours de la semaine n'ont pas de sens ici : la cadence part
//     du geste.
//
// L'échéance de la série est **toujours** une date : sans elle, « toutes les
// semaines » ne veut rien dire. La saisie en pose une par défaut.
import { addDaysIso, parseDay, weekdayOf } from './helpers';
import { TaskRec } from './models';

/** Au-delà, on cesse de chercher : une règle qui ne tombe sur rien en cinq ans est vide. */
const HORIZON_DAYS = 366 * 5;

const daysBetween = (a: string, b: string): number => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
const dom = (iso: string): number => parseInt(iso.slice(8, 10), 10);
const month = (iso: string): number => parseInt(iso.slice(5, 7), 10);
const year = (iso: string): number => parseInt(iso.slice(0, 4), 10);
const daysInMonth = (y: number, m: number): number => new Date(y, m, 0).getDate();
const pad = (n: number): string => String(n).padStart(2, '0');
/** Le lundi de la semaine d'une date. */
const mondayOf = (iso: string): string => addDaysIso(iso, 1 - weekdayOf(iso));

/** Ajoute des mois en gardant le jour du mois, borné à la fin du mois d'arrivée (le 31 janvier + 1 mois = le 28 février). */
export function addMonthsClamped(iso: string, n: number): string {
  const y = year(iso); const m = month(iso); const d = dom(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12); const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

/** La règle tombe-t-elle ce jour-là, la série étant ancrée sur `origin` ? */
function matches(rec: TaskRec, origin: string, day: string): boolean {
  const every = Math.max(1, rec.every || 1);
  switch (rec.freq) {
    case 'daily': return daysBetween(origin, day) % every === 0;
    case 'weekly': {
      const days = rec.days?.length ? rec.days : [weekdayOf(origin)];
      if (!days.includes(weekdayOf(day))) return false;
      const weeks = Math.round(daysBetween(mondayOf(origin), mondayOf(day)) / 7);
      return weeks % every === 0;
    }
    case 'monthly': {
      const months = (year(day) - year(origin)) * 12 + (month(day) - month(origin));
      return months % every === 0 && dom(day) === Math.min(dom(origin), daysInMonth(year(day), month(day)));
    }
    case 'yearly':
      return (year(day) - year(origin)) % every === 0 && month(day) === month(origin)
        && dom(day) === Math.min(dom(origin), daysInMonth(year(day), month(day)));
  }
}

/** La première date de la règle strictement après `after`, ou null au-delà de l'horizon. */
function firstMatchAfter(rec: TaskRec, origin: string, after: string): string | null {
  let day = addDaysIso(after, 1);
  for (let i = 0; i < HORIZON_DAYS; i++, day = addDaysIso(day, 1)) if (matches(rec, origin, day)) return day;
  return null;
}

/** Un pas de la cadence à partir d'une date : N jours, N semaines, N mois, N ans. */
function stepFrom(iso: string, rec: TaskRec): string {
  const n = Math.max(1, rec.every || 1);
  switch (rec.freq) {
    case 'daily': return addDaysIso(iso, n);
    case 'weekly': return addDaysIso(iso, 7 * n);
    case 'monthly': return addMonthsClamped(iso, n);
    case 'yearly': return addMonthsClamped(iso, 12 * n);
  }
}

/**
 * L'échéance suivante d'une série dont on vient de solder l'occurrence `due`,
 * le jour `doneOn`. Null quand la série s'arrête (fin dépassée).
 */
export function nextOccurrence(rec: TaskRec, due: string, doneOn: string): string | null {
  const next = rec.base === 'done'
    ? stepFrom(doneOn, rec)
    : firstMatchAfter(rec, due, due > doneOn ? due : doneOn);
  if (!next) return null;
  if (rec.until && next > rec.until) return null;
  return next;
}

/** L'échéance courante d'une série, décalée d'une occurrence sans la faire. */
export function skipOccurrence(rec: TaskRec, due: string, today: string): string | null {
  return nextOccurrence(rec, due, rec.base === 'done' ? (due > today ? due : today) : due);
}

/** Dernier jour où une occurrence n'est pas encore en retard : l'échéance, plus la tolérance. */
export function windowEnd(due: string, rec: TaskRec | null | undefined): string {
  return rec?.grace ? addDaysIso(due, rec.grace) : due;
}

export const DOW_SHORT = ['', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
export const FREQ_LABELS: Record<TaskRec['freq'], string> = { daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois', yearly: 'Chaque année' };
const EVERY_LABELS: Record<TaskRec['freq'], (n: number) => string> = {
  daily: (n) => `Tous les ${n} jours`,
  weekly: (n) => `Toutes les ${n} semaines`,
  monthly: (n) => `Tous les ${n} mois`,
  yearly: (n) => `Tous les ${n} ans`,
};

/** « Toutes les 2 semaines (lun., jeu.) », « Chaque semaine après la réalisation, souplesse 3 j ». */
export function recLabel(rec: TaskRec, fmt?: (iso: string) => string): string {
  const n = Math.max(1, rec.every || 1);
  let s = n === 1 ? FREQ_LABELS[rec.freq] : EVERY_LABELS[rec.freq](n);
  if (rec.freq === 'weekly' && rec.base === 'due' && rec.days?.length) s += ' (' + rec.days.map((d) => DOW_SHORT[d]).join(', ') + ')';
  if (rec.base === 'done') s += ' après la réalisation';
  if (rec.grace) s += `, souplesse ${rec.grace} j`;
  if (rec.until && fmt) s += `, jusqu'au ${fmt(rec.until)}`;
  return s;
}
