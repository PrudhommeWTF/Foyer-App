import { mealNames, recipeTime } from '../meals';
import { HouseholdState } from '../models';
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface RepasTileData {
  /** Le plat de tête, celui qui répond à « qu'est-ce qu'on mange ». */
  name: string;
  /** Les autres plats, ou le temps de la recette : la précision, pas le titre. */
  meta: string;
}

/** Créneau du soir : c'est celui que l'accueil met en avant. */
const SLOT = 'soir';

function dinner(d: HouseholdState, today: string): RepasTileData | null {
  const value = (d.meals || {})[today + '-' + SLOT];
  const names = mealNames(value, d.recipes || []);
  if (!names.length) return null;
  const reste = names.slice(1);
  if (reste.length) return { name: names[0], meta: reste.join(' · ') };
  const first = value?.items[0];
  const r = first?.rid ? (d.recipes || []).find((x) => x.id === first.rid) : undefined;
  return { name: names[0], meta: r ? `${recipeTime(r)} · niveau ${r.level.toLowerCase()}` : 'Repas libre' };
}

export const repasTile = {
  id: 'repas',
  title: 'Au dîner ce soir',
  screen: 'repas',
  link: 'Voir le planning',
  source: 'document',
  state: (ctx): TileState<RepasTileData> => fromSource(ctx.doc, (d, asOf) => {
    const v = dinner(d, ctx.today);
    return v ? ok(v, asOf) : empty('Rien de prévu au dîner.');
  }),
} satisfies TileProvider<RepasTileData>;
