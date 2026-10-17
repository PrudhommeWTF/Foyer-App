import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Catalogue } from './entretien';

/**
 * Le catalogue des gestes d'entretien, lu une fois par session. Il ne change
 * qu'avec une mise à jour ou la surcharge de l'administrateur : le relire à
 * chaque ouverture de « Nouveau geste » ne servirait à rien.
 */
@Injectable({ providedIn: 'root' })
export class EntretienApi {
  private api = inject(ApiService);
  readonly catalogue = signal<Catalogue | null>(null);
  readonly erreur = signal('');

  async charger(): Promise<void> {
    if (this.catalogue()) return;
    this.erreur.set('');
    try { this.catalogue.set(await this.api.request<Catalogue>('entretien/catalogue')); }
    catch { this.erreur.set('Le catalogue des gestes n’a pas pu être chargé. Vous pouvez créer un geste libre.'); }
  }
}
