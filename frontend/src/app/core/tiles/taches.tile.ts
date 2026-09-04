import { TaskLine, dailyTasks, todayTasks } from '../tasks';
import { setting } from '../settings/registry';
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface TachesTileData {
  /** Tâches dues aujourd'hui ou en retard. Zéro n'affiche aucun compteur. */
  due: number;
  lines: TaskLine[];
}

const SHOWN = 5;

/**
 * Ce qu'il y a à faire aujourd'hui, et non l'arriéré complet.
 *
 * La règle de tri et de relégation appartient au module (voir `core/tasks.ts`) :
 * la tuile ne fait que la demander.
 */
export const tachesTile = {
  id: 'taches',
  title: 'Tâches',
  screen: 'taches',
  link: 'Tout voir',
  source: 'document',
  state: (ctx): TileState<TachesTileData> => fromSource(ctx.doc, (d, asOf) => {
    // Seules les listes « tâches » visibles par ce membre sont l'affaire du jour.
    const tasks = dailyTasks(d.doc.tasks, d.doc.taskLists, d.me);
    const t = todayTasks(tasks, ctx.today, SHOWN, setting('taskLateDays', d.doc, d.me));
    if (t.lines.length) return ok({ due: t.due, lines: t.lines }, asOf);
    // Trois vides bien distincts : il n'y a jamais rien eu, tout est fait, ou
    // il reste des choses mais aucune pour aujourd'hui.
    if (t.onlyLater) return empty('Rien à faire aujourd’hui. Le reste est planifié plus tard.');
    return empty(tasks.length ? 'Tout est fait 🎉' : 'Aucune tâche pour le moment.');
  }),
} satisfies TileProvider<TachesTileData>;
