// Quand une tâche doit rappeler, et à qui.
//
// Tout est pur et se calcule sur l'heure murale du foyer (Europe/Paris), en
// chaînes « AAAA-MM-JJTHH:MM » comparables : c'est ce qui permet de tester le
// planificateur sans horloge, et d'être insensible aux changements d'heure,
// une tâche « à 18 h » restant à 18 h.
//
// Le volume est décidé ici, pas dans le canal : un rappel par tâche qui en
// demande un, aux membres affectés (ou à tout le foyer quand la tâche n'a pas
// de responsable), et une notification quand quelqu'un d'autre m'affecte une
// tâche. Rien d'autre.
import type { TaskItem } from '../tasks/ops';

/** Les réglages de rappel qu'une tâche peut porter. Aucun par défaut. */
export type Remind = 'at' | '1h' | 'eve' | 'morning';
export const REMINDS: Remind[] = ['at', '1h', 'eve', 'morning'];
export const REMIND_LABELS: Record<Remind, string> = { at: 'À l’heure', '1h': '1 h avant', eve: 'La veille à 18 h', morning: 'Le matin à 9 h' };

/** Heure de référence d'une tâche datée sans heure, et heure du rappel « la veille ». */
export const MORNING = '09:00';
export const EVE = '18:00';
export const HOUSEHOLD_TZ = 'Europe/Paris';

/** Au-delà de ce retard, un rappel n'est plus envoyé : il est noté manqué. */
export const LATE_WINDOW_MIN = 120;

const pad = (n: number): string => String(n).padStart(2, '0');

/** L'heure murale du foyer, « AAAA-MM-JJTHH:MM », pour un instant donné. */
export function parisWall(at: Date = new Date()): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: HOUSEHOLD_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: HOUSEHOLD_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  return `${day}T${hm === '24:00' ? '00:00' : hm}`;
}

/** Arithmétique sur l'heure murale : des minutes en plus ou en moins, calendrier compris. */
export function wallAdd(wall: string, minutes: number): string {
  const [d, hm] = wall.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, da, h, mi + minutes));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/**
 * Les heures de silence du foyer. `from` peut être après `to` : la fenêtre
 * enjambe alors minuit, ce qui est le cas normal (21:30 à 07:00).
 */
export interface QuietHours { from: string; to: string; }

/** L'heure murale HH:MM tombe-t-elle dans la fenêtre de silence ? */
export function inQuiet(wall: string, q: QuietHours): boolean {
  if (!q.from || !q.to || q.from === q.to) return false;
  const hm = wall.slice(11, 16);
  return q.from < q.to ? hm >= q.from && hm < q.to : hm >= q.from || hm < q.to;
}

/**
 * Décale un instant hors des heures de silence, à la première minute de reprise.
 *
 * Un rappel qui tombe la nuit n'est pas perdu, il attend le matin : le perdre
 * ferait rater l'échéance, et l'envoyer quand même ferait sonner la maison à
 * trois heures. Une fenêtre qui enjambe minuit reporte au lendemain matin.
 */
export function deferPastQuiet(wall: string, q: QuietHours): string {
  if (!inQuiet(wall, q)) return wall;
  const jour = wall.slice(0, 10);
  const hm = wall.slice(11, 16);
  // Fenêtre à cheval sur minuit et instant situé avant minuit : la reprise est le lendemain.
  const lendemain = q.from > q.to && hm >= q.from;
  return `${lendemain ? wallAdd(`${jour}T00:00`, 24 * 60).slice(0, 10) : jour}T${q.to}`;
}

/**
 * L'instant mural où la tâche rappelle, ou null si elle ne rappelle pas.
 *
 * Les heures de silence, quand elles sont données, repoussent l'instant à la
 * reprise plutôt que d'annuler le rappel.
 */
export function fireAt(t: Pick<TaskItem, 'due' | 'time' | 'remind'>, quiet?: QuietHours): string | null {
  if (!t.due || !t.remind || !REMINDS.includes(t.remind)) return null;
  const ref = `${t.due}T${t.time || MORNING}`;
  const brut = t.remind === 'at' ? ref
    : t.remind === '1h' ? wallAdd(ref, -60)
    : t.remind === 'morning' ? `${t.due}T${MORNING}`
    : wallAdd(`${t.due}T${EVE}`, -24 * 60);
  return quiet ? deferPastQuiet(brut, quiet) : brut;
}

export interface ReminderHit {
  /** Clé d'idempotence : la tâche, l'échéance et le réglage. Une tâche reportée rappelle à nouveau. */
  key: string;
  taskId: string;
  memberIds: string[];
  title: string;
  body: string;
  fireAt: string;
}

/** « Aujourd’hui à 18:00 », « Demain », « Le 05/09 à 09:00 ». */
export function whenLabel(t: Pick<TaskItem, 'due' | 'time'>, nowWall: string): string {
  const today = nowWall.slice(0, 10);
  const tomorrow = wallAdd(today + 'T00:00', 24 * 60).slice(0, 10);
  const jour = t.due === today ? 'Aujourd’hui' : t.due === tomorrow ? 'Demain' : 'Le ' + t.due!.slice(8, 10) + '/' + t.due!.slice(5, 7);
  return t.time ? `${jour} à ${t.time}` : jour;
}

/**
 * Les rappels à envoyer maintenant, et ceux qu'on a manqués (service arrêté
 * plus de deux heures) : ceux-là sont notés, pas envoyés, un rappel de 18 h
 * reçu à 23 h ne servant plus à rien.
 */
export function dueReminders(
  tasks: TaskItem[],
  accountMemberIds: string[],
  nowWall: string,
  quiet?: QuietHours,
  lateWindowMin = LATE_WINDOW_MIN,
): { hits: ReminderHit[]; missed: ReminderHit[] } {
  const floor = wallAdd(nowWall, -lateWindowMin);
  const hits: ReminderHit[] = [];
  const missed: ReminderHit[] = [];
  for (const t of tasks || []) {
    if (t.done) continue;
    const at = fireAt(t, quiet);
    if (!at || at > nowWall) continue;
    const hit: ReminderHit = {
      key: `rem|${t.id}|${t.due}|${t.time || ''}|${t.remind}`,
      taskId: t.id,
      memberIds: t.who.length ? [...t.who] : [...accountMemberIds],
      title: t.text,
      body: whenLabel(t, nowWall) + (t.cat ? ' · ' + t.cat : ''),
      fireAt: at,
    };
    (at >= floor ? hits : missed).push(hit);
  }
  return { hits, missed };
}

/**
 * Qui vient d'être affecté par quelqu'un d'autre : les membres présents après
 * et absents avant, sauf l'auteur du geste. Une tâche faite n'affecte personne.
 */
export function assignedBy(before: TaskItem | undefined, after: TaskItem | undefined, by: string | null): string[] {
  if (!after || after.done) return [];
  const avant = new Set(before?.who || []);
  return after.who.filter((m) => !avant.has(m) && m !== by);
}
