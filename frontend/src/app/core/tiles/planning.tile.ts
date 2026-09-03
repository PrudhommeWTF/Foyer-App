import { SchedSlot } from '../models';
import { calendarFacts, slotsOn } from '../schedule';
import { addDaysIso } from '../helpers';
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

/**
 * Le jour et le lendemain. Le soir, ce qui compte n'est plus la journée en
 * cours : c'est le cartable à préparer pour demain matin.
 */
export interface PlanningTileData { slots: SchedSlot[]; tomorrow: SchedSlot[]; }

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
    const cal = calendarFacts(d.schoolHolidays);
    const slots = slotsOn(sched, ctx.today, cal);
    const tomorrow = slotsOn(sched, addDaysIso(ctx.today, 1), cal);
    if (!slots.length && !tomorrow.length) return empty('Journée libre.');
    // Le lendemain complète, il ne remplace pas : la place restante lui revient.
    const reste = Math.max(0, SHOWN - Math.min(slots.length, SHOWN));
    return ok({ slots: slots.slice(0, SHOWN), tomorrow: tomorrow.slice(0, reste) }, asOf);
  }),
} satisfies TileProvider<PlanningTileData>;
