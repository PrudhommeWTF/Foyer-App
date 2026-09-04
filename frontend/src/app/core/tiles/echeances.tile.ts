import { DEADLINE_HORIZON_DAYS, deadlineLabel, upcomingDeadlines } from '../deadlines';
import { setting } from '../settings/registry';
import type { FinDeadline } from '../finances.api';
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface EcheanceLine {
  deadline: FinDeadline;
  /** « Dernier jour pour résilier », « Reconduction tacite », « Fin du contrat ». */
  label: string;
  /** Une fenêtre de résiliation manquée coûte une année d'abonnement. */
  costly: boolean;
}

export interface EcheancesTileData { lines: EcheanceLine[]; }

const SHOWN = 3;

/**
 * Ce qui se joue dans les deux mois sur les contrats du foyer.
 *
 * Le module calcule ces échéances depuis longtemps : elles alimentent les
 * notifications et le calendrier. Elles n'étaient nulle part sur l'accueil,
 * alors qu'une fenêtre de résiliation manquée coûte une année d'abonnement, et
 * que c'est exactement le genre de date qu'on ne retient pas.
 */
export const echeancesTile = {
  id: 'echeances',
  title: 'Échéances',
  screen: 'finances',
  link: 'Voir les contrats',
  source: 'finances',
  state: (ctx): TileState<EcheancesTileData> => fromSource(ctx.fin, (f, asOf) => {
    if (!f.contracts) return empty('Aucun contrat déclaré. Les dates de résiliation se surveillent toutes seules ensuite.', 'Déclarer un contrat');
    // L'horizon est un réglage du foyer. Il vit dans le document, que cette
    // tuile ne lit pas : tant qu'il n'est pas chargé, le défaut s'applique,
    // plutôt que de faire attendre une tuile qui a déjà ses échéances.
    const horizon = ctx.doc.status === 'ready'
      ? setting('deadlineHorizonDays', ctx.doc.data.doc, ctx.doc.data.me)
      : DEADLINE_HORIZON_DAYS;
    const lines = upcomingDeadlines(f.deadlines, horizon).slice(0, SHOWN).map((deadline) => ({
      deadline,
      label: deadlineLabel(deadline.kind),
      costly: deadline.kind === 'preavis',
    }));
    return lines.length ? ok({ lines }, asOf) : empty('Rien à surveiller dans les deux mois.');
  }),
} satisfies TileProvider<EcheancesTileData>;
