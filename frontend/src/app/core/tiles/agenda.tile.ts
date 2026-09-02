import { DayExtra, dayExtrasOn, eventsOn } from '../agenda';
import { addDaysIso } from '../helpers';
import { EventItem } from '../models';
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface AgendaTileData {
  events: EventItem[];
  /** Fériés, vacances scolaires, anniversaires, tâches du jour, échéances. */
  extras: DayExtra[];
  /**
   * Ce qui attend demain. Le soir, c'est ce qui compte, et c'est aussi ce qu'on
   * doit préparer la veille : un cartable ne se prépare pas le matin même.
   */
  tomorrow: EventItem[];
}

/**
 * La journée du foyer, pas seulement ses rendez-vous.
 *
 * Le calendrier superpose depuis longtemps les jours fériés, les vacances
 * scolaires, les anniversaires et les échéances de contrat. L'accueil lisait
 * `events` brut et n'en montrait aucun : on pouvait y lire « rien de prévu » le
 * jour de l'anniversaire d'un enfant. Tout vient désormais du module.
 */
const TOMORROW_SHOWN = 2;

export const agendaTile = {
  id: 'agenda',
  title: 'Aujourd’hui',
  screen: 'calendar',
  link: 'Voir l’agenda',
  source: 'document',
  state: (ctx): TileState<AgendaTileData> => fromSource(ctx.doc, (d, asOf) => {
    const events = eventsOn(d.doc.events || [], ctx.today);
    const extras = dayExtrasOn(ctx.today, {
      doc: d.doc,
      schoolHolidays: d.schoolHolidays,
      // Les échéances de contrat viennent du plan Finances. S'il est tombé, on
      // le dit plutôt que de présenter une journée amputée comme complète.
      external: ctx.fin.status === 'ready' ? ctx.fin.data.dayExtras : {},
    })
      // Le calendrier montre les tâches planifiées parce qu'il est seul à parler
      // de la journée. Sur l'accueil, la tuile Tâches est juste à côté : les
      // répéter ici ferait lire deux fois la même ligne sur le même écran.
      .filter((x) => x.kind !== 'task');
    const tomorrow = eventsOn(d.doc.events || [], addDaysIso(ctx.today, 1)).slice(0, TOMORROW_SHOWN);
    if (!events.length && !extras.length && !tomorrow.length) return empty('Rien de prévu aujourd’hui 🎉');
    return ok({ events, extras, tomorrow }, asOf,
      ctx.fin.status === 'error' ? 'Les échéances de contrat ne sont pas affichées : le module Finances ne répond pas.' : undefined);
  }),
} satisfies TileProvider<AgendaTileData>;
