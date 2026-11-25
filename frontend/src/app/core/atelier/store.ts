import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from '../api.service';
import { FoyerStore } from '../foyer.store';
import { Projet, Resume } from './atelier';

/**
 * Atelier code : ce que l'accueil a besoin de savoir, lu une fois par session et
 * relu quand on revient de l'éditeur (qui est une autre page : l'application
 * redémarre alors). Sans réseau, tout reste vide et la tuile se tait.
 */
@Injectable({ providedIn: 'root' })
export class AtelierStore {
  private readonly api = inject(ApiService);
  private readonly foyer = inject(FoyerStore);

  /** The project last changed by the member of the session. */
  readonly last = signal<Projet | null>(null);
  /** For an adult: what the other members did. */
  readonly members = signal<Resume[]>([]);
  readonly quotaMo = signal(0);
  private owner: string | null = null;

  constructor() {
    effect(() => {
      const on = this.foyer.authed() && this.foyer.modAtelier() && !!this.foyer.data();
      const me = this.foyer.me()?.id ?? null, child = this.foyer.isChild();
      untracked(() => {
        if (!on || !me) { this.owner = null; this.last.set(null); this.members.set([]); return; }
        if (me === this.owner) return;
        this.owner = me;
        void this.load(child);
      });
    });
  }

  async load(child = this.foyer.isChild()): Promise<void> {
    try { this.last.set((await this.api.request<{ projets: Projet[] }>('atelier/projets')).projets[0] ?? null); } catch { /* offline: nothing to offer */ }
    if (child) return;
    try {
      const r = await this.api.request<{ membres: Resume[]; quotaMo: number }>('atelier/membres');
      this.members.set(r.membres); this.quotaMo.set(r.quotaMo);
    } catch { /* offline: the tile stays quiet */ }
  }
}
