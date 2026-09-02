import { Directive, computed, inject, input } from '@angular/core';
import { DashboardStore } from '../../core/dashboard.store';
import { FoyerStore } from '../../core/foyer.store';
import { TileProvider, TileState } from '../../core/tiles/contract';

/**
 * Le socle commun aux tuiles de l'accueil.
 *
 * Une tuile ne fait que **rendre** un `TileState` déjà calculé par son
 * fournisseur : elle ne filtre pas, ne trie pas, ne compte pas. Son seul droit
 * est de mettre en forme, et de brancher les gestes sur le store de son module.
 *
 * `data()` vaut null hors de l'état `ok`, ce qui rend structurellement
 * impossible qu'un gabarit lise une donnée absente.
 */
@Directive()
export abstract class HomeTile<T> {
  readonly store = inject(FoyerStore);
  readonly dash = inject(DashboardStore);

  readonly tile = input.required<TileProvider>();
  readonly state = input.required<TileState<T>>();

  readonly data = computed<T | null>(() => { const s = this.state(); return s.kind === 'ok' ? s.data : null; });
}
