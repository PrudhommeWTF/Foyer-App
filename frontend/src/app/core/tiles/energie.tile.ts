import type { FinReadingDue } from '../finances.api';
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface EnergieTileData { due: FinReadingDue[] }

const SHOWN = 2;

/**
 * Les compteurs qu'il est temps de relire.
 *
 * La tuile ne montre rien quand tout est à jour : un relevé fait il y a huit
 * jours n'appelle aucun geste, et l'afficher ferait une ligne de plus à ignorer.
 * La règle du « trop longtemps » appartient au module (voir
 * backend/src/finances/energy.ts, READING_DUE_DAYS).
 */
export const energieTile = {
  id: 'energie',
  title: 'Relevés',
  screen: 'finances',
  link: 'Ouvrir',
  source: 'finances',
  state: (ctx): TileState<EnergieTileData> => fromSource(ctx.fin, (f, asOf) => {
    if (!f.energy.contracts) return empty('Aucun compteur suivi.', 'Ajouter un contrat d’énergie');
    return f.energy.due.length
      ? ok({ due: f.energy.due.slice(0, SHOWN) }, asOf)
      : empty('Compteurs à jour.');
  }),
} satisfies TileProvider<EnergieTileData>;
