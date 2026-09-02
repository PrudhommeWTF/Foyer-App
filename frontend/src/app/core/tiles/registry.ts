/**
 * Le registre des tuiles de l'accueil.
 *
 * Brancher un nouveau module sur l'accueil, c'est écrire un fournisseur et
 * l'ajouter ici. Le composant d'accueil n'est jamais rouvert. L'ordre de cette
 * liste est l'ordre d'affichage par défaut.
 *
 * La marche à suivre complète est dans docs/accueil-contrat-de-tuile.md.
 */
import { agendaTile } from './agenda.tile';
import { coursesTile } from './courses.tile';
import { echeancesTile } from './echeances.tile';
import { economiesTile } from './economies.tile';
import { energieTile } from './energie.tile';
import { financesTile } from './finances.tile';
import { messagesTile } from './messages.tile';
import { planningTile } from './planning.tile';
import { repasTile } from './repas.tile';
import { tachesTile } from './taches.tile';

export const TILE_PROVIDERS = [
  agendaTile,
  planningTile,
  tachesTile,
  repasTile,
  coursesTile,
  financesTile,
  echeancesTile,
  energieTile,
  economiesTile,
  messagesTile,
] as const;

/**
 * Les identifiants réellement déclarés. La table de rendu de l'accueil est
 * indexée dessus : oublier le composant d'une tuile ne compile pas, au lieu de
 * la faire disparaître de la page sans un mot.
 */
export type TileId = (typeof TILE_PROVIDERS)[number]['id'];
