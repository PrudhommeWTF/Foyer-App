import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface EconomiesTileData {
  /** Pistes encore ouvertes (idée ou en cours). */
  open: number;
  /** Ce qu'elles représenteraient par an, en centimes. */
  pending: number;
  /** Ce qui a déjà été gagné, en centimes. Zéro tant qu'aucune n'est menée à bien. */
  done: number;
}

/**
 * Les pistes d'économies encore ouvertes.
 *
 * Ce n'est pas une affaire du jour : la tuile ne réclame rien, elle rappelle
 * qu'un travail commencé attend. Les pistes abandonnées ne comptent nulle part,
 * c'est le module qui l'a décidé.
 */
export const economiesTile = {
  id: 'economies',
  title: 'Économies',
  screen: 'finances',
  link: 'Voir les pistes',
  source: 'finances',
  state: (ctx): TileState<EconomiesTileData> => fromSource(ctx.fin, (f, asOf) => {
    const s = f.savings;
    if (!s.count) return empty('Aucune piste notée.', 'Noter une piste');
    if (!s.openCount) return empty(s.done ? 'Toutes les pistes ont été menées à bien 🎉' : 'Aucune piste ouverte.');
    return ok({ open: s.openCount, pending: s.pending, done: s.done }, asOf);
  }),
} satisfies TileProvider<EconomiesTileData>;
