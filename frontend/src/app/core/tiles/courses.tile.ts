import { ShopItem } from '../models';
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface CoursesTileData {
  /** Ce qui reste à prendre, toutes listes confondues. */
  left: number;
  items: ShopItem[];
}

const SHOWN = 8;

/**
 * Ce qui reste à acheter. La tuile sert à savoir quoi prendre, pas à relire ce
 * qui est déjà dans le panier : les articles pris n'y figurent pas.
 */
export const coursesTile = {
  id: 'courses',
  title: 'Courses',
  screen: 'courses',
  link: 'Ouvrir la liste',
  source: 'document',
  state: (ctx): TileState<CoursesTileData> => fromSource(ctx.doc, (d, asOf) => {
    const shop = d.doc.shop || [];
    const left = shop.filter((x) => x.state === 'a-prendre');
    if (left.length) return ok({ left: left.length, items: left.slice(0, SHOWN) }, asOf);
    return empty(shop.length ? 'Tout est dans le panier.' : 'Aucun article à acheter.');
  }),
} satisfies TileProvider<CoursesTileData>;
