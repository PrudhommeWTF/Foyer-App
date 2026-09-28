import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

/** Décomptes de ce que chaque module contient, pour la confirmation d'un « repartir à zéro ». */
export interface ModuleCounts {
  repas: { recipes: number; meals: number };
  fidelite: { cards: number };
  finances: { transactions: number; comptes: number };
  employe: { employes: number; presences: number };
}

@Injectable({ providedIn: 'root' })
export class ModulesApi {
  private api = inject(ApiService);

  counts(): Promise<{ counts: ModuleCounts }> { return this.api.request('modules'); }
  /** Efface définitivement les données d'un module (confirmation par saisie « SUPPRIMER »). */
  reset(mod: string): Promise<{ ok: true }> { return this.api.post('modules/' + mod + '/reset', { confirm: 'SUPPRIMER' }); }
}
