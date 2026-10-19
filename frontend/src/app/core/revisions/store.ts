import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiError, isOffline } from '../api.service';
import { FoyerStore } from '../foyer.store';
import { KeyStore, readQueue, writeQueue } from '../op-queues';
import { ExerciseOverview, Matiere, RevisionsApi, RevisionsSession, SessionPayload, SessionReceipt } from './api';
import { EXERCISES } from './exercises';
import { parisDay } from './revisions';

/** La file des sessions pas encore reçues par le serveur, rangée par membre comme les autres (op-queues.ts). */
const QUEUE_KEY = 'foyer.revisionsQueue';
/** La dernière vue connue d'un membre : de quoi s'entraîner dans la voiture, sans réseau. */
const CACHE_PREFIX = 'foyer.revisions.';
const keyStore = (): KeyStore | null => { try { return localStorage; } catch { return null; } };

interface Kept { matieres: Matiere[]; overviews: Record<string, ExerciseOverview>; }

/**
 * État du module Révisions pour le membre de la session. L'exercice tourne
 * entièrement dans le navigateur ; la session part en un seul envoi à la fin,
 * ou attend le réseau dans une file persistée, rejouée à la reconnexion. Son
 * identifiant vient de l'appareil : deux envois de la même session n'en font
 * qu'une, côté serveur. Rien ici ne connaît un exercice : le registre
 * (exercises/) dit lesquels existent.
 */
@Injectable({ providedIn: 'root' })
export class RevisionsStore {
  private api = inject(RevisionsApi);
  readonly foyer = inject(FoyerStore);

  readonly matieres = signal<Matiere[]>([]);
  /** Par exercice : programme, paramètres en vigueur, temps accordé, maîtrise. */
  readonly overviews = signal<Record<string, ExerciseOverview>>({});
  /** Les sessions reçues depuis hier : de quoi compter celles du jour. */
  readonly recent = signal<RevisionsSession[]>([]);
  /** Les sessions en attente du réseau, pour le membre de la session. */
  readonly queue = signal<SessionPayload[]>([]);
  /** Vrai quand ce qu'on montre vient de la copie locale, faute de réseau. */
  readonly offline = signal(false);
  readonly loaded = signal(false);
  private owner: string | null = null;
  private flushing = false;

  readonly me = computed(() => this.foyer.me()?.id ?? null);

  constructor() {
    effect(() => {
      const on = this.foyer.authed() && this.foyer.modRevisions() && !!this.foyer.data();
      const me = this.me();
      untracked(() => {
        if (!on || !me) { this.reset(); return; }
        if (me !== this.owner) { this.owner = me; this.loaded.set(false); this.queue.set(readQueue<SessionPayload>(keyStore(), QUEUE_KEY, me)); }
        void this.load();
        void this.flush();
      });
    });
    window.addEventListener('online', () => void this.flush());
  }

  private reset(): void { this.owner = null; this.queue.set([]); this.overviews.set({}); this.recent.set([]); this.loaded.set(false); }

  /** Tous les exercices du registre, et la liste des matières ; la copie locale prend le relais sans réseau. */
  async load(): Promise<void> {
    const me = this.owner; if (!me) return;
    try {
      const [mat, list, recent] = await Promise.all([
        this.api.matieres(),
        Promise.all(EXERCISES.map((e) => this.api.exercise(me, e.id))),
        this.api.sessions(me, new Date(Date.now() - 36 * 3600_000).toISOString()),
      ]);
      if (me !== this.owner) return;
      const overviews = Object.fromEntries(list.map((o) => [o.exerciseId, o]));
      this.matieres.set(mat.matieres); this.overviews.set(overviews); this.recent.set(recent.sessions);
      this.offline.set(false);
      try { keyStore()?.setItem(CACHE_PREFIX + me, JSON.stringify({ matieres: mat.matieres, overviews } satisfies Kept)); } catch { /* quota : la copie attendra */ }
    } catch (e) {
      if (!isOffline(e)) { this.loaded.set(true); return; } // refus du serveur : l'écran restera sur ce qu'il a
      this.offline.set(true);
      try {
        const kept = JSON.parse(keyStore()?.getItem(CACHE_PREFIX + me) || 'null') as Kept | null;
        if (kept) { this.matieres.set(kept.matieres); this.overviews.set(kept.overviews); }
      } catch { /* copie abîmée : rien à montrer */ }
    }
    this.loaded.set(true);
  }

  history(ex: string, key: string) { return this.api.history(this.owner ?? '', ex, key); }

  /** Les sessions comptées du jour pour un exercice (heure de Paris), reçues ou encore en file. */
  doneToday(ex: string): number {
    const today = parisDay(new Date().toISOString());
    const counts = (s: { exerciseId: string; mode: string; startedAt: string }) => s.exerciseId === ex && s.mode !== 'apprendre' && parisDay(s.startedAt) === today;
    const sent = this.recent().filter(counts);
    return sent.length + this.queue().filter((s) => counts(s) && !sent.some((x) => x.id === s.id)).length;
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
   * Refus d'accès (403 : module éteint, ou session d'un autre membre) et panne
   * du serveur : elle reste, et repartira quand la porte se rouvrira.
   */
  async flush(): Promise<Map<string, SessionReceipt>> {
    const out = new Map<string, SessionReceipt>();
    if (this.flushing || !this.queue().length) return out;
    this.flushing = true;
    try {
      for (const s of [...this.queue()]) {
        try {
          const r = await this.api.send(s);
          out.set(s.id, r);
          this.recent.update((xs) => [...xs.filter((x) => x.id !== r.session.id), r.session]);
          this.save(this.queue().filter((x) => x.id !== s.id));
        } catch (e) {
          if (isOffline(e) || (e instanceof ApiError && (e.status === 403 || e.status >= 500))) break;
          this.save(this.queue().filter((x) => x.id !== s.id));
          this.foyer.toast('Une session n’a pas pu être enregistrée : ' + (e as Error).message);
        }
      }
    } finally { this.flushing = false; }
    if (out.size) void this.load();
    return out;
  }
}
