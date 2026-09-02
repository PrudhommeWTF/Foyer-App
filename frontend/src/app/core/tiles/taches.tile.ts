import { TaskItem } from '../models';
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface TachesTileData {
  /** Tâches ouvertes, toutes listes confondues. */
  open: number;
  /** Celles qui tiennent sur la tuile. */
  items: TaskItem[];
}

const SHOWN = 5;

export const tachesTile = {
  id: 'taches',
  title: 'Tâches',
  screen: 'taches',
  link: 'Tout voir',
  source: 'document',
  state: (ctx): TileState<TachesTileData> => fromSource(ctx.doc, (d, asOf) => {
    const tasks = d.tasks || [];
    const open = tasks.filter((t) => !t.done);
    if (open.length) return ok({ open: open.length, items: open.slice(0, SHOWN) }, asOf);
    // Deux vides bien distincts : « tout est fait » félicite, « aucune tâche »
    // dit qu'il n'y a jamais rien eu et invite à commencer.
    return empty(tasks.length ? 'Tout est fait 🎉' : 'Aucune tâche pour le moment.');
  }),
} satisfies TileProvider<TachesTileData>;
