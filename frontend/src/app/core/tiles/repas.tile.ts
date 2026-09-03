import { conflictLabel, hasDiet, mealConflicts } from '../diet';
import { mealNames, recipeTime } from '../meals';
import { paxLabel, presenceAt } from '../presence';
import { calendarFacts } from '../schedule';
import { DocSnapshot, TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface RepasTileData {
  /** Le plat de tête, celui qui répond à « qu'est-ce qu'on mange ». */
  name: string;
  /** Les autres plats, ou le temps de la recette : la précision, pas le titre. */
  meta: string;
  /** « 4 couverts », ou « 3 couverts (sans Léa) » quand le compte a baissé. */
  pax: string;
  /** Conflits alimentaires pour les convives attendus. Vide le plus souvent. */
  alerts: string[];
}

/** Créneau du soir : c'est celui que l'accueil met en avant. */
const SLOT = 'soir';

/**
 * Le dîner du jour, avec ce que le module Cuisine sait en dire.
 *
 * L'accueil n'affichait que le nom du plat. Le module sait depuis les derniers
 * lots pour combien de couverts on cuisine, qui n'est pas là, et si un convive
 * attendu est allergique à ce qui est prévu. Une alerte allergène invisible sur
 * l'écran le plus ouvert de la maison est le pire cas possible : elle est ici.
 */
export const repasTile = {
  id: 'repas',
  title: 'Dîner ce soir',
  screen: 'repas',
  link: 'Voir le planning',
  source: 'document',
  state: (ctx): TileState<RepasTileData> => fromSource(ctx.doc, (d, asOf) => {
    const value = (d.doc.meals || {})[ctx.today + '-' + SLOT];
    const names = mealNames(value, d.doc.recipes || []);
    if (!names.length) return empty('Rien de prévu au dîner.');

    const presence = presenceAt({ members: d.doc.members || [], sched: d.doc.sched || [], cal: calendarFacts(d.schoolHolidays) }, ctx.today, SLOT, value);
    const alerts = anyDiet(d) ? mealConflicts(value?.items || [], d.doc.recipes || [], presence.present, d.articles) : [];

    return ok({
      name: names[0],
      meta: metaOf(names, value?.items[0]?.rid, d),
      pax: paxLabel(presence),
      alerts: alerts.map(conflictLabel),
    }, asOf);
  }),
} satisfies TileProvider<RepasTileData>;

/** Sans contrainte déclarée par personne, tout ce qui suit se tait. */
const anyDiet = (d: DocSnapshot): boolean => (d.doc.members || []).some(hasDiet);

/**
 * Les autres plats s'il y en a, sinon le temps et le niveau de la recette. Sur
 * la tuile du jour, la question est « qu'est-ce qu'on mange », pas « combien de
 * plats ».
 */
function metaOf(names: string[], rid: string | undefined, d: DocSnapshot): string {
  const reste = names.slice(1);
  if (reste.length) return reste.join(' · ');
  const r = rid ? (d.doc.recipes || []).find((x) => x.id === rid) : undefined;
  return r ? `${recipeTime(r)} · niveau ${r.level.toLowerCase()}` : 'Repas libre';
}
