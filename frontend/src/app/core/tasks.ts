// Les règles du module Tâches : ce qui se voit, dans quel ordre, et ce qui se
// propose à la saisie.
//
// Tout est pur : l'accueil, l'écran et la saisie rapide appellent ces fonctions
// au lieu de refaire le tri chacun de leur côté. C'est la seule façon qu'un
// changement de règle atteigne les trois sans que personne n'y pense.
//
// Les règles, et leur pourquoi :
//
//   - **Seules les listes « tâches » sont l'affaire du jour.** Une liste de
//     valise ou d'idées ne compte ni dans « Toutes » ni sur l'accueil.
//   - Une liste privée est cachée aux autres membres. Une tâche dont la liste a
//     disparu est **montrée** quand même : rien ne se cache en silence.
//   - Le **compteur** ne compte que ce qui est daté d'aujourd'hui ou dépassé.
//     Une tâche sans date n'est due aucun jour en particulier.
//   - Le retard **récent** passe devant, le retard **ancien** est relégué
//     derrière le jour même : une tâche en retard de trois mois n'est pas
//     l'affaire du jour. Elle n'est jamais supprimée ni décomptée.
import { addDaysIso, normText, parseDay, weekdayOf } from './helpers';
import { ListKind, TaskItem, TaskList } from './models';
import { windowEnd } from './recurrence';

/**
 * Au-delà de ce retard, une tâche cesse d'être l'affaire du jour et passe
 * derrière ce qui l'est. Un mois : en deçà, « je ne l'ai pas encore fait » reste
 * une information utile ; au-delà, c'est un sujet en soi.
 */
export const RELEGATION_DAYS = 30;

export interface TaskLine {
  task: TaskItem;
  /** Jours de retard. Zéro pour une tâche du jour ou sans date. */
  late: number;
}

export interface TodayTasks {
  /** Tâches dues aujourd'hui ou en retard. Zéro n'affiche aucun compteur. */
  due: number;
  lines: TaskLine[];
  /** Il y a des tâches ouvertes, mais aucune pour aujourd'hui. */
  onlyLater: boolean;
}

/** Écart en jours entre deux dates ISO, en jours pleins. */
export function daysLate(due: string, today: string): number {
  const ms = parseDay(today).getTime() - parseDay(due).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

// ---- ce qui se voit ----------------------------------------------------------

/** Une liste se voit si elle est partagée ou à moi. Les archivées sont cachées sauf demande. */
export function visibleLists(lists: TaskList[], me: string | null, includeArchived = false): TaskList[] {
  return (lists || [])
    .filter((l) => (includeArchived || !l.archived) && (l.scope === 'shared' || l.scope === me))
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** L'ordre des types dans les puces : l'affaire du jour d'abord. */
export const KIND_ORDER: ListKind[] = ['taches', 'corvees', 'checklist'];
export const KIND_LABELS: Record<ListKind, string> = { taches: 'Tâches', corvees: 'Corvées', checklist: 'Checklist' };

/**
 * Les tâches de l'affaire du jour : celles des listes « tâches » visibles, plus
 * celles dont la liste n'existe plus, qui sont montrées plutôt que perdues.
 */
export function dailyTasks(tasks: TaskItem[], lists: TaskList[], me: string | null): TaskItem[] {
  const byId = new Map((lists || []).map((l) => [l.id, l]));
  return (tasks || []).filter((t) => {
    const l = byId.get(t.listId);
    return !l || (l.kind === 'taches' && !l.archived && (l.scope === 'shared' || l.scope === me));
  });
}

/**
 * Où en est une tâche datée par rapport au jour. La tolérance d'une série
 * (« vers le 15 avril ») compte : entre l'échéance et la fin de la tolérance,
 * elle est l'affaire du jour, pas en retard.
 */
export function standing(t: TaskItem, today: string): 'late' | 'now' | 'soon' | 'undated' {
  if (!t.due) return 'undated';
  if (t.due > today) return 'soon';
  return windowEnd(t.due, t.rec) < today ? 'late' : 'now';
}
/** Jours de retard, tolérance déduite. */
const lateOf = (t: TaskItem, today: string): number => daysLate(windowEnd(t.due!, t.rec), today);

export function todayTasks(tasks: TaskItem[], today: string, max: number): TodayTasks {
  const open = (tasks || []).filter((t) => !t.done);
  const late = open.filter((t) => standing(t, today) === 'late')
    .map((task) => ({ task, late: lateOf(task, today) }))
    .sort((a, b) => a.late - b.late);
  const now = open.filter((t) => standing(t, today) === 'now').map((task) => ({ task, late: 0 }));
  const undated = open.filter((t) => !t.due).map((task) => ({ task, late: 0 }));
  const later = open.filter((t) => standing(t, today) === 'soon');

  const lines: TaskLine[] = [
    ...late.filter((l) => l.late <= RELEGATION_DAYS),
    ...now,
    ...late.filter((l) => l.late > RELEGATION_DAYS),
    ...undated,
  ].slice(0, max);

  return {
    // Reléguée n'est pas effacée : une tâche en retard ancien compte toujours.
    due: late.length + now.length,
    lines,
    onlyLater: !lines.length && later.length > 0,
  };
}

// ---- l'ordre de l'écran -------------------------------------------------------

export type TaskGroupKey = 'today' | 'late' | 'soon' | 'undated';
export interface TaskGroup { key: TaskGroupKey; label: string; lines: TaskLine[] }

const byDueThenTime = (a: TaskItem, b: TaskItem): number =>
  (a.due || '').localeCompare(b.due || '') || (a.time || '99').localeCompare(b.time || '99');
/** Les plus récentes d'abord : ce qu'on vient de saisir est ce qu'on cherche. */
const newestFirst = (a: TaskItem, b: TaskItem): number => (b.at || '').localeCompare(a.at || '');

/**
 * Les tâches ouvertes d'un écran, par groupe. Le jour même d'abord, puis le
 * retard (récent en tête), puis ce qui vient, puis ce qui n'a pas de date.
 * Une checklist se lit dans l'ordre où elle a été écrite : un seul groupe, sans
 * titre, du premier au dernier.
 */
export function groupOpen(tasks: TaskItem[], today: string, kind: ListKind = 'taches'): TaskGroup[] {
  const open = (tasks || []).filter((t) => !t.done);
  if (kind === 'checklist') {
    const lines = open.slice().sort((a, b) => (a.at || '').localeCompare(b.at || '')).map((task) => ({ task, late: 0 }));
    return lines.length ? [{ key: 'undated', label: '', lines }] : [];
  }
  const groups: TaskGroup[] = [
    { key: 'today', label: 'Aujourd’hui', lines: open.filter((t) => standing(t, today) === 'now').sort(byDueThenTime).map((task) => ({ task, late: 0 })) },
    { key: 'late', label: 'En retard', lines: open.filter((t) => standing(t, today) === 'late').map((task) => ({ task, late: lateOf(task, today) })).sort((a, b) => a.late - b.late) },
    { key: 'soon', label: 'À venir', lines: open.filter((t) => standing(t, today) === 'soon').sort(byDueThenTime).map((task) => ({ task, late: 0 })) },
    { key: 'undated', label: 'Sans date', lines: open.filter((t) => !t.due).sort(newestFirst).map((task) => ({ task, late: 0 })) },
  ];
  return groups.filter((g) => g.lines.length);
}

/** Les tâches faites, la plus récente d'abord. */
export function doneTasks(tasks: TaskItem[]): TaskItem[] {
  return (tasks || []).filter((t) => t.done).slice().sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
}

// ---- la saisie ------------------------------------------------------------------

/**
 * Ce que la liste a déjà vu, dès deux lettres : l'orthographe du foyer, du plus
 * fréquent au plus rare. Une tâche encore ouverte n'est pas proposée, le geste
 * ferait un doublon.
 */
export function suggestTexts(tasks: TaskItem[], listId: string, typed: string, max = 4): string[] {
  const q = normText(typed);
  if (q.length < 2) return [];
  const count = new Map<string, { text: string; n: number }>();
  const open = new Set<string>();
  for (const t of tasks || []) {
    if (t.listId !== listId) continue;
    const k = normText(t.text);
    if (!t.done) open.add(k);
    const c = count.get(k);
    if (c) c.n++; else count.set(k, { text: t.text.trim(), n: 1 });
  }
  return [...count.entries()]
    .filter(([k]) => k.includes(q) && k !== q && !open.has(k))
    .sort((a, b) => b[1].n - a[1].n || a[1].text.localeCompare(b[1].text, 'fr'))
    .slice(0, max)
    .map(([, v]) => v.text);
}

/** Les catégories proposées : celles de départ, puis celles que le foyer a écrites. */
export const DEFAULT_CATEGORIES = ['Maison', 'Enfants', 'Administratif', 'Courses', 'Travail'];
export function categories(tasks: TaskItem[]): string[] {
  const out = [...DEFAULT_CATEGORIES];
  const seen = new Set(out.map(normText));
  for (const t of tasks || []) {
    const c = (t.cat || '').trim();
    if (c && !seen.has(normText(c))) { seen.add(normText(c)); out.push(c); }
  }
  return out;
}

/** Les dates d'un tap : aujourd'hui, demain, le week-end qui vient, la semaine prochaine. */
export function quickDates(today: string): { label: string; date: string }[] {
  const dow = weekdayOf(today);
  // Samedi ou dimanche : « ce week-end », c'est aujourd'hui.
  const weekend = dow >= 6 ? today : addDaysIso(today, 6 - dow);
  const monday = addDaysIso(today, 8 - dow);
  return [
    { label: 'Aujourd’hui', date: today },
    { label: 'Demain', date: addDaysIso(today, 1) },
    { label: 'Ce week-end', date: weekend },
    { label: 'Semaine prochaine', date: monday },
  ];
}

const JOURS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/**
 * L'échéance telle qu'on la lit : « Aujourd’hui », « Demain », « Hier », le jour
 * de la semaine dans les six jours, sinon la date du foyer. L'heure suit.
 */
export function dueLabel(due: string | null | undefined, time: string | null | undefined, today: string, fmt: (iso: string) => string, grace = 0): string {
  if (!due) return '';
  // Avec une tolérance, l'échéance est approximative et se dit comme telle.
  if (grace > 0) return 'vers le ' + fmt(due) + (time ? ` · ${time}` : '');
  const diff = Math.round((parseDay(due).getTime() - parseDay(today).getTime()) / 86400000);
  const jour = diff === 0 ? 'Aujourd’hui' : diff === 1 ? 'Demain' : diff === -1 ? 'Hier'
    : diff > 1 && diff < 7 ? JOURS[weekdayOf(due)] : fmt(due);
  return time ? `${jour} · ${time}` : jour;
}
