import { SchedSlot } from '../models';
import { calendarFacts, slotsOn } from '../schedule';
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface PlanningTileData { slots: SchedSlot[]; }

const SHOWN = 4;

/**
 * L'emploi du temps du jour.
 *
 * C'est le module qui répond à « qu'est-ce qui doit partir avec les enfants ce
 * matin », et il n'était nulle part sur l'accueil. Il dit aussi, au passage, si
 * la journée est un jour d'école : c'est de là que viendra la contextualisation.
 */
export const planningTile = {
  id: 'planning',
  title: 'Emploi du temps',
  screen: 'planning',
  link: 'Voir la semaine',
  source: 'document',
  state: (ctx): TileState<PlanningTileData> => fromSource(ctx.doc, (d, asOf) => {
    const sched = d.doc.sched || [];
    if (!sched.length) return empty('Aucun emploi du temps.', 'Ajouter un créneau');
    // Les vacances de l'académie décident si l'école a lieu : sans elles, la
    // tuile annoncerait un jour d'école un mardi de Toussaint.
    const slots = slotsOn(sched, ctx.today, calendarFacts(d.schoolHolidays));
    return slots.length ? ok({ slots: slots.slice(0, SHOWN) }, asOf) : empty('Journée libre.');
  }),
} satisfies TileProvider<PlanningTileData>;
