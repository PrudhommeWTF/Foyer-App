// Ce que le module Tâches met en avant pour aujourd'hui.
//
// L'accueil affichait jusqu'ici « Tâches · 14 » : toutes les tâches ouvertes
// depuis toujours, dans l'ordre où elles avaient été saisies. Un compteur
// d'arriéré n'aide à rien, il pèse ; et les cinq premières lignes n'avaient
// aucun rapport avec la journée.
//
// La règle retenue, et son pourquoi :
//
//   - Le **compteur** ne compte que ce qui est daté d'aujourd'hui ou dépassé.
//     Une tâche sans date n'est due aucun jour en particulier : la compter
//     reviendrait à réafficher l'arriéré.
//   - La **liste** est ordonnée en quatre groupes : le retard récent, puis le
//     jour même, puis le retard ancien, puis les tâches sans date. C'est le
//     mécanisme de relégation : une tâche en retard de trois mois n'est pas
//     l'affaire du jour, elle passe derrière ce qui l'est, et finit par sortir de
//     la tuile quand celle-ci est pleine. Elle n'est jamais supprimée ni
//     décomptée : elle est dans son module, et elle compte toujours.
//   - Une tâche planifiée pour plus tard n'a rien à faire ici.
//
// `planned` est la vraie date (celle que le calendrier lit). `due` est un texte
// libre saisi à la main (« Aujourd'hui », « avant vendredi ») : il s'affiche,
// il ne se compare pas.
import { parseDay } from './helpers';
import { TaskItem } from './models';

/**
 * Au-delà de ce retard, une tâche cesse d'être l'affaire du jour et passe
 * derrière ce qui l'est. Un mois : en deçà, « je ne l'ai pas encore fait » reste
 * une information utile ; au-delà, c'est un sujet en soi, qui se traite dans son
 * module et non entre deux portes.
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
function daysLate(planned: string, today: string): number {
  const ms = parseDay(today).getTime() - parseDay(planned).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

export function todayTasks(tasks: TaskItem[], today: string, max: number): TodayTasks {
  const open = (tasks || []).filter((t) => !t.done);
  const late = open.filter((t) => !!t.planned && t.planned < today)
    .map((task) => ({ task, late: daysLate(task.planned!, today) }))
    .sort((a, b) => a.late - b.late);
  const now = open.filter((t) => t.planned === today).map((task) => ({ task, late: 0 }));
  const undated = open.filter((t) => !t.planned).map((task) => ({ task, late: 0 }));
  const later = open.filter((t) => !!t.planned && t.planned > today);

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
