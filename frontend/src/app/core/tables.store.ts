import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiError, isOffline } from './api.service';
import { FoyerStore } from './foyer.store';
import { KeyStore, readQueue, writeQueue } from './op-queues';
import { SessionPayload, SessionReceipt, TablesApi, TablesConfig, TablesOverview, TablesStats } from './tables.api';
import { Operation, parisDay } from './tables';

/** La file des sessions pas encore reçues par le serveur, rangée par membre comme les autres (op-queues.ts). */
const QUEUE_KEY = 'foyer.tablesQueue';
/** La dernière grille connue d'un membre : de quoi s'entraîner dans la voiture, sans réseau. */
const CACHE_PREFIX = 'foyer.tables.';
const keyStore = (): KeyStore | null => { try { return localStorage; } catch { return null; } };

/**
 * État du module Tables. L'exercice tourne entièrement dans le navigateur ; la
 * session part en un seul envoi à la fin, ou attend le réseau dans une file
 * persistée, rejouée à la reconnexion. Son identifiant vient de l'appareil :
 * deux envois de la même session n'en font qu'une, côté serveur.
 */
@Injectable({ providedIn: 'root' })
export class TablesStore {
  private api = inject(TablesApi);
  readonly foyer = inject(FoyerStore);

  readonly config = signal<TablesConfig | null>(null);
  /** Les vues par membre (soi-même, et les enfants suivis par un adulte). */
  readonly overviews = signal<Record<string, TablesOverview>>({});
  readonly stats = signal<Record<string, TablesStats>>({});
  /** Les sessions en attente du réseau, pour le membre de la session. */
  readonly queue = signal<SessionPayload[]>([]);
  /** Vrai quand ce qu'on montre vient de la copie locale, faute de réseau. */
  readonly offline = signal(false);
  private owner: string | null = null;
  private flushing = false;

  readonly me = computed(() => this.foyer.me()?.id ?? null);
  readonly mine = computed(() => { const id = this.me(); return id ? this.overviews()[id] ?? null : null; });

  constructor() {
    effect(() => {
      const on = this.foyer.authed() && this.foyer.modTables() && !!this.foyer.data();
      const me = this.me();
      untracked(() => {
        if (!on || !me) { this.reset(); return; }
        if (me !== this.owner) { this.owner = me; this.queue.set(readQueue<SessionPayload>(keyStore(), QUEUE_KEY, me)); }
        void this.load(me);
        void this.flush();
      });
    });
    window.addEventListener('online', () => void this.flush());
  }

  private reset(): void { this.owner = null; this.queue.set([]); this.overviews.set({}); this.stats.set({}); this.config.set(null); }

  /** La vue d'un membre, et la configuration ; la copie locale prend le relais sans réseau. */
  async load(member: string, op?: Operation): Promise<void> {
    try {
      const [cfg, ov] = await Promise.all([this.config() ? Promise.resolve(this.config()!) : this.api.config(), this.api.overview(member, op)]);
      this.config.set(cfg);
      this.overviews.update((m) => ({ ...m, [member]: ov }));
      this.offline.set(false);
      try { keyStore()?.setItem(CACHE_PREFIX + member, JSON.stringify({ cfg, ov })); } catch { /* quota : la copie attendra */ }
    } catch (e) {
      if (!isOffline(e)) return; // refus du serveur : l'écran restera sur ce qu'il a
      this.offline.set(true);
      try {
        const kept = JSON.parse(keyStore()?.getItem(CACHE_PREFIX + member) || 'null') as { cfg: TablesConfig; ov: TablesOverview } | null;
        if (kept) { this.config.set(kept.cfg); this.overviews.update((m) => ({ ...m, [member]: kept.ov })); }
      } catch { /* copie abîmée : rien à montrer */ }
    }
  }

  async loadStats(member: string, op?: Operation): Promise<void> {
    try { const s = await this.api.stats(member, op); this.stats.update((m) => ({ ...m, [member]: s })); } catch { /* le suivi le dira */ }
  }

  /** Les sessions du jour d'un membre (heure de Paris), connues du serveur ou encore en file. */
  sessionsToday(member: string): number {
    const today = parisDay(new Date().toISOString());
    const known = this.stats()[member]?.days.find((d) => d.day === today)?.sessions ?? 0;
    return known + this.queue().filter((s) => s.memberId === member && s.mode !== 'apprendre' && parisDay(s.startedAt) === today).length;
  }

  /**
   * Envoie une session terminée. Elle entre d'abord dans la file (persistée) :
   * si le réseau manque, elle y reste et partira seule. Rend le reçu du serveur,
   * ou null quand elle attend.
   */
  async submit(s: SessionPayload): Promise<SessionReceipt | null> {
    this.save([...this.queue(), s]);
    const receipts = await this.flush();
    return receipts.get(s.id) ?? null;
  }

  private save(q: SessionPayload[]): void {
    this.queue.set(q);
    writeQueue(keyStore(), QUEUE_KEY, this.owner, q);
  }

  /**
   * Rejoue la file, dans l'ordre. Hors ligne : tout reste. Refus définitif
   * (400, session illisible) : la session quitte la file, et on le dit.
   * Refus d'accès (403 : module éteint, ou session d'un autre membre) : elle
   * reste, et repartira quand le module ou sa session reviendra.
   */
  async flush(): Promise<Map<string, SessionReceipt>> {
    const out = new Map<string, SessionReceipt>();
    if (this.flushing || !this.queue().length) return out;
    this.flushing = true;
    try {
      for (const s of [...this.queue()]) {
        try {
          out.set(s.id, await this.api.send(s));
          this.save(this.queue().filter((x) => x.id !== s.id));
        } catch (e) {
          if (isOffline(e) || (e instanceof ApiError && (e.status === 403 || e.status >= 500))) break;
          this.save(this.queue().filter((x) => x.id !== s.id));
          this.foyer.toast('Une session n’a pas pu être enregistrée : ' + (e as Error).message);
        }
      }
    } finally { this.flushing = false; }
    if (out.size && this.owner) { void this.load(this.owner); void this.loadStats(this.owner); }
    return out;
  }
}
