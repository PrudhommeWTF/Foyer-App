import { Type } from '@angular/core';
import { TileId } from '../../core/tiles/registry';
import { AgendaTile } from './agenda';
import { CoursesTile } from './courses';
import { EcheancesTile } from './echeances';
import { EconomiesTile } from './economies';
import { EnergieTile } from './energie';
import { FinancesTile } from './finances';
import { MessagesTile } from './messages';
import { PlanningTile } from './planning';
import { RepasTile } from './repas';
import { TachesTile } from './taches';

export interface TileRender {
  /** Composant qui met en forme le `TileState` du fournisseur. */
  component: Type<unknown>;
  /** Emprise sur la grille. Deux colonnes pour ce qui se lit comme une liste. */
  span?: 'wide';
}

/**
 * Le rendu de chaque tuile, par identifiant de fournisseur.
 *
 * L'indexation sur `TileId` est ce qui compte : déclarer un fournisseur sans
 * écrire son composant ne compile pas. Sans cela, la tuile disparaîtrait de la
 * page sans un mot, exactement le genre de panne muette qu'on cherche à rendre
 * impossible.
 */
export const TILE_RENDERERS: Record<TileId, TileRender> = {
  agenda: { component: AgendaTile },
  planning: { component: PlanningTile },
  taches: { component: TachesTile },
  repas: { component: RepasTile },
  courses: { component: CoursesTile, span: 'wide' },
  finances: { component: FinancesTile },
  echeances: { component: EcheancesTile },
  energie: { component: EnergieTile },
  economies: { component: EconomiesTile },
  messages: { component: MessagesTile },
};
