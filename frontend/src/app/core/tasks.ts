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
//   - Une **sous-tâche** est un détail de son parent : elle ne compte pas dans
//     les compteurs et ne fait pas de ligne à elle seule. Sauf quand son parent
//     n'est pas dans ce qu'on regarde (la vue « À moi ») : elle redevient alors
//     une ligne, plutôt que de disparaître.
//   - L'**ordre manuel** (`pos`, posé au glisser-déposer) décide dans le jour
//     même, dans une checklist, dans les tâches sans date et sous un parent.
//     Sur ce qui s'étale (« En retard », « À venir »), la date passe devant :
//     elle est l'information utile, et l'ordre manuel n'y fait que départager.
import { addDaysIso, normText, parseDay, weekdayOf } from './helpers';
import { ListKind, Remind, TaskItem, TaskList } from './models';
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
  /** Les sous-tâches de cette ligne, dans leur ordre. Vide quand il n'y en a pas. */
  subs: TaskItem[];
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

/**
 * Une tâche fait-elle une ligne à part entière ici ?
 *
 * Une sous-tâche se range sous son parent, sauf dans deux cas où s'y ranger la
 * rendrait invisible : son parent n'est pas dans ce qu'on regarde (la vue
 * « À moi »), ou il est coché alors qu'elle ne l'est pas (un autre appareil a
 * coché le parent seul). Elle redevient alors une ligne, plutôt que de
 * disparaître sous une ligne barrée.
 */
const isRoot = (t: TaskItem, byId: Map<string, TaskItem>): boolean => {
  if (!t.parentId) return true;
  const parent = byId.get(t.parentId);
  return !parent || (parent.done && !t.done);
};
/** L'ordre manuel d'abord ; sans lui, la tâche passe après celles qui en ont un. */
const byPos = (a: TaskItem, b: TaskItem): number => (a.pos ?? Number.MAX_SAFE_INTEGER) - (b.pos ?? Number.MAX_SAFE_INTEGER);
/** La date, puis l'heure, l'ordre manuel départageant. Pour ce qui s'étale sur plusieurs jours. */
const byDueThenTime = (a: TaskItem, b: TaskItem): number =>
  (a.due || '').localeCompare(b.due || '') || (a.time || '99').localeCompare(b.time || '99') || byPos(a, b);
/**
 * L'ordre manuel devant tout le reste. C'est celui du jour même : les tâches y
 * sont toutes du même jour, donc l'heure ne dit pas l'ordre dans lequel on s'y
 * prend. Une tâche jamais déplacée passe après celles qui l'ont été, à son heure.
 */
const byManualThenTime = (a: TaskItem, b: TaskItem): number => byPos(a, b) || byDueThenTime(a, b);
/** Les plus récentes d'abord : ce qu'on vient de saisir est ce qu'on cherche. */
const newestFirst = (a: TaskItem, b: TaskItem): number => (b.at || '').localeCompare(a.at || '');

/** Les sous-tâches d'une tâche, dans leur ordre : l'ordre manuel, puis la saisie. */
export function subtasksOf(tasks: TaskItem[], parentId: string): TaskItem[] {
  return (tasks || []).filter((t) => t.parentId === parentId).sort((a, b) => byPos(a, b) || (a.at || '').localeCompare(b.at || ''));
}

/** Combien de sous-tâches faites sur combien. Null quand il n'y en a pas : rien à afficher. */
export function subProgress(subs: TaskItem[]): { done: number; total: number } | null {
  return subs.length ? { done: subs.filter((s) => s.done).length, total: subs.length } : null;
}

/** Ce qui reste ouvert, sans compter les sous-tâches : un compteur dit des choses à faire, pas des détails. */
export function openCount(tasks: TaskItem[]): number {
  return (tasks || []).filter((t) => !t.done && !t.parentId).length;
}

/** Ce qui m'est affecté, sous-tâches comprises : une sous-tâche à mon nom est à moi. */
export function assignedTo(tasks: TaskItem[], me: string | null): TaskItem[] {
  return me ? (tasks || []).filter((t) => (t.who || []).includes(me)) : [];
}

/**
 * Le nouvel ordre après un glisser-déposer : l'élément de `from` va en `to`,
 * les autres se décalent. Rend le tableau inchangé si les indices ne veulent
 * rien dire, plutôt qu'un ordre inventé.
 */
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  const out = items.slice();
  if (from < 0 || to < 0 || from >= out.length || to >= out.length || from === to) return out;
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
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
  // Les sous-tâches ne montent pas sur l'accueil : elles n'ont pas de date, et
  // les compter ferait passer une tâche en cinq points pour cinq tâches.
  const open = (tasks || []).filter((t) => !t.done && !t.parentId);
  const late = open.filter((t) => standing(t, today) === 'late')
    .map((task) => ({ task, late: lateOf(task, today), subs: [] }))
    .sort((a, b) => a.late - b.late);
  const now = open.filter((t) => standing(t, today) === 'now').sort(byManualThenTime).map((task) => ({ task, late: 0, subs: [] }));
  const undated = open.filter((t) => !t.due).sort(byPos).map((task) => ({ task, late: 0, subs: [] }));
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

/**
 * Les tâches ouvertes d'un écran, par groupe. Le jour même d'abord, puis le
 * retard (récent en tête), puis ce qui vient, puis ce qui n'a pas de date.
 * Une checklist se lit dans l'ordre où elle a été écrite : un seul groupe, sans
 * titre, du premier au dernier.
 *
 * Les sous-tâches viennent sous leur parent au lieu de faire une ligne. Celle
 * dont le parent n'est pas dans `tasks` en fait une : c'est ce qui rend la vue
 * « À moi » juste, et ce qui empêche une sous-tâche de disparaître.
 */
export function groupOpen(tasks: TaskItem[], today: string, kind: ListKind = 'taches'): TaskGroup[] {
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  const line = (task: TaskItem, late = 0): TaskLine => ({ task, late, subs: subtasksOf(tasks, task.id) });
  const open = (tasks || []).filter((t) => !t.done && isRoot(t, byId));
  if (kind === 'checklist') {
    const lines = open.slice().sort((a, b) => byPos(a, b) || (a.at || '').localeCompare(b.at || '')).map((t) => line(t));
    return lines.length ? [{ key: 'undated', label: '', lines }] : [];
  }
  const groups: TaskGroup[] = [
    { key: 'today', label: 'Aujourd’hui', lines: open.filter((t) => standing(t, today) === 'now').sort(byManualThenTime).map((t) => line(t)) },
    { key: 'late', label: 'En retard', lines: open.filter((t) => standing(t, today) === 'late').map((t) => line(t, lateOf(t, today))).sort((a, b) => a.late - b.late) },
    { key: 'soon', label: 'À venir', lines: open.filter((t) => standing(t, today) === 'soon').sort(byDueThenTime).map((t) => line(t)) },
    { key: 'undated', label: 'Sans date', lines: open.filter((t) => !t.due).sort((a, b) => byPos(a, b) || newestFirst(a, b)).map((t) => line(t)) },
  ];
  return groups.filter((g) => g.lines.length);
}

/**
 * Les groupes qui se rangent à la main.
 *
 * Le jour même en fait partie : ses tâches sont toutes du même jour, l'heure ne
 * dit donc pas dans quel ordre on s'y prend, et l'ordre manuel y passe devant.
 * « En retard » garde son classement par ancienneté et « À venir » reste
 * chronologique : là, la date est l'information utile, et une poignée y
 * cacherait le calendrier au lieu de servir.
 */
export const REORDERABLE: TaskGroupKey[] = ['today', 'undated'];

/** Les tâches faites, la plus récente d'abord. Les sous-tâches restent sous leur parent. */
export function doneTasks(tasks: TaskItem[]): TaskItem[] {
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  return (tasks || []).filter((t) => t.done && isRoot(t, byId)).slice().sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
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

/** Les réglages de rappel, dans l'ordre où la barre d'action les propose. */
export const REMINDS: Remind[] = ['at', '1h', 'eve', 'morning'];
export const REMIND_LABELS: Record<Remind, string> = { at: 'À l’heure', '1h': '1 h avant', eve: 'La veille à 18 h', morning: 'Le matin à 9 h' };

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
