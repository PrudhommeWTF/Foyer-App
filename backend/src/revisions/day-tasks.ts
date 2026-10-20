// Les décisions de l'entraînement du jour dans « Devoirs de … », pures et
// testées à part : quel jour est un jour d'école, quelles tâches ajouter ou
// retirer. Aucune base ici (voir devoirs.ts, qui lit les tables et écrit).
import type { CalendarFacts } from '../schedule';

export const dayTaskId = (member: string, exercise: string, day: string): string => `rev-${member}-${exercise}-${day}`;
export const dayTaskText = (label: string): string => `${label} : entraînement du jour`;
const dayTaskNote = (goal: number): string =>
  `Objectif : ${goal} session${goal > 1 ? 's' : ''} dans Révisions. La tâche se coche toute seule une fois l’objectif atteint.`;

/**
 * Un jour d'école pour cet enfant ? D'après son emploi du temps ÉcoleDirecte
 * quand la semaine en a un (`lessons` : les cours connus de la semaine, ou null
 * si l'établissement n'en publie pas) : un jour avec au moins un cours qui
 * n'est pas annulé. Sinon le calendrier : du lundi au vendredi, hors jours
 * fériés et vacances scolaires (inconnues : on compte le jour).
 */
export function isSchoolDay(day: string, lessons: readonly { day: string; cancelled: boolean }[] | null, cal: CalendarFacts): boolean {
  if (lessons && lessons.length) return lessons.some((l) => l.day === day && !l.cancelled);
  const dow = new Date(day + 'T12:00:00Z').getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const f = cal(day);
  return !f.holiday && f.schoolHoliday !== true;
}

/** Ce que la projection sait d'un enfant ce jour-là. */
export interface DayTaskInput {
  memberId: string;
  /** La liste « Devoirs de … » de l'enfant, ou null (pas de module École, pas d'association). */
  listId: string | null;
  schoolDay: boolean;
  /** Les exercices qui demandent la tâche, leur libellé, leur objectif et les sessions du jour. */
  programs: { exerciseId: string; label: string; goal: number; done: number }[];
}
export interface ExistingTask { id: string; revEx?: string | null; due: string | null; done: boolean; }
export type DayTaskOp =
  | { op: 'add'; id: string; member: string; exercise: string; listId: string; text: string; note: string; done: boolean }
  | { op: 'remove'; id: string };

/**
 * Les opérations du jour : retirer les tâches d'entraînement des jours passés
 * et celles qui n'ont plus lieu d'être aujourd'hui, ajouter celles qui
 * manquent. `already` : les « membre|exercice » déjà projetés aujourd'hui (une
 * tâche absente de ceux-là a été supprimée à la main, et le reste).
 */
export function planDayTasks(today: string, kids: readonly DayTaskInput[], tasks: readonly ExistingTask[], already: ReadonlySet<string>): DayTaskOp[] {
  const want = new Map<string, DayTaskOp & { op: 'add' }>();
  for (const k of kids) {
    if (!k.listId || !k.schoolDay) continue;
    for (const p of k.programs) {
      const id = dayTaskId(k.memberId, p.exerciseId, today);
      want.set(id, { op: 'add', id, member: k.memberId, exercise: p.exerciseId, listId: k.listId, text: dayTaskText(p.label), note: dayTaskNote(p.goal), done: p.done >= p.goal });
    }
  }
  const ops: DayTaskOp[] = [];
  const present = new Set<string>();
  for (const t of tasks) {
    if (!t.revEx) continue;
    if (want.has(t.id)) present.add(t.id); else ops.push({ op: 'remove', id: t.id });
  }
  for (const w of want.values()) if (!present.has(w.id) && !already.has(`${w.member}|${w.exercise}`)) ops.push(w);
  return ops;
}
