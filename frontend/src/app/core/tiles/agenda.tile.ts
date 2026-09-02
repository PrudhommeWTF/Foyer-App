import { eventsOn } from '../agenda';
import { EventItem } from '../models';
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface AgendaTileData { events: EventItem[]; }

/**
 * L'agenda du jour. Le tri et la récurrence viennent du module (`eventsOn`) :
 * ajouter une règle de récurrence doit se voir ici sans qu'on y touche.
 */
export const agendaTile = {
  id: 'agenda',
  title: 'Aujourd’hui',
  screen: 'calendar',
  link: 'Voir l’agenda',
  source: 'document',
  state: (ctx): TileState<AgendaTileData> => fromSource(ctx.doc, (d, asOf) => {
    const events = eventsOn(d.events || [], ctx.today);
    return events.length ? ok({ events }, asOf) : empty('Rien de prévu aujourd’hui 🎉');
  }),
} satisfies TileProvider<AgendaTileData>;
