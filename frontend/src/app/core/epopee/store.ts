import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiError, ApiService, isOffline } from '../api.service';
import { FoyerStore } from '../foyer.store';
import { KeyStore, readQueue, writeQueue } from '../op-queues';
import { Besace, Exploit, Pending, Routine, Step, StepStatus } from './epopee';

const QUEUE_KEY = 'foyer.epopeeQueue';
const keyStore = (): KeyStore | null => { try { return localStorage; } catch { return null; } };

/**
 * Épopée : les besaces lues du serveur, et la file des étapes notées sur cet
 * appareil. Une étape se note d'abord ici (l'enfant est félicité tout de suite),
 * puis part au serveur ; sans réseau elle attend, rangée sous le membre de la
 * session (`foyer.epopeeQueue.<membre>`), et repart au retour du réseau. Le
 * serveur ne compte une étape qu'une fois par jour, un renvoi ne coûte rien.
 */
@Injectable({ providedIn: 'root' })
export class EpopeeStore {
  private readonly api = inject(ApiService);
  private readonly foyer = inject(FoyerStore);

  readonly besaces = signal<Besace[] | null>(null);
  /** Les exploits convenus du foyer. */
  readonly exploits = signal<Exploit[]>([]);
  readonly erreur = signal('');
  readonly pending = signal<Pending[]>([]);
  private owner: string | null = null;
  private flushing = false;
  private readonly me = computed(() => this.foyer.me()?.id ?? null);

  constructor() {
    effect(() => {
      const on = this.foyer.authed() && this.foyer.modEpopee() && !!this.foyer.data();
      const me = this.me();
      untracked(() => {
        if (!on || !me) { this.owner = null; this.pending.set([]); this.besaces.set(null); return; }
        if (me !== this.owner) { this.owner = me; this.pending.set(readQueue<Pending>(keyStore(), QUEUE_KEY, me)); void this.flush(); }
      });
    });
    window.addEventListener('online', () => void this.flush());
  }

  async charger(): Promise<void> {
    this.erreur.set('');
    try {
      const [{ enfants }, { exploits }] = await Promise.all([this.api.request<{ enfants: Besace[] }>('epopee/membres'), this.api.request<{ exploits: Exploit[] }>('epopee/exploits')]);
      this.exploits.set(exploits);
      this.besaces.set(await Promise.all(enfants.map((e) => (e.enrolled ? this.api.request<Besace>(`epopee/membres/${e.memberId}`) : e))));
    } catch (e) { if (!this.besaces()) this.erreur.set((e as Error).message); }
  }

  private save(q: Pending[]): void { this.pending.set(q); writeQueue(keyStore(), QUEUE_KEY, this.owner, q); }

  /** Note une étape du jour : gardée ici d'abord, envoyée ensuite. */
  noter(step: Step, status: StepStatus, day: string): void {
    if (this.pending().some((p) => p.stepId === step.id && p.day === day)) return;
    this.save([...this.pending(), { stepId: step.id, status, day }]);
    void this.flush();
  }

  /**
   * Rejoue la file, dans l'ordre. Hors ligne, accès refusé (module éteint,
   * session d'un autre membre) ou panne du serveur : tout reste. Refus définitif
   * (étape retirée, jour trop ancien) : l'étape quitte la file, et on le dit.
   */
  async flush(): Promise<void> {
    if (this.flushing || !this.pending().length) return;
    this.flushing = true;
    let sent = false;
    try {
      for (const p of [...this.pending()]) {
        try {
          await this.api.post(`epopee/etapes/${encodeURIComponent(p.stepId)}`, { status: p.status, day: p.day });
          sent = true;
        } catch (e) {
          if (isOffline(e) || (e instanceof ApiError && (e.status === 403 || e.status >= 500))) break;
          this.foyer.toast('Une étape n’a pas pu être enregistrée : ' + (e as Error).message);
        }
        // Reload before dropping the mark: the screen never shows the step undone in between.
        if (sent && this.pending().length === 1) await this.charger();
        this.save(this.pending().filter((x) => x !== p && !(x.stepId === p.stepId && x.day === p.day)));
      }
    } finally { this.flushing = false; }
  }

  /** Une pause « grain de sable » : comptée si le réseau est là, jamais rejouée. */
  pause(r: Routine, day: string): void { void this.api.post(`epopee/routines/${r.id}/pauses`, { day }).catch(() => { /* the pause itself needs no server */ }); }
}
