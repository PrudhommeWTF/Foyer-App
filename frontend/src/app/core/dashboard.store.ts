import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { FinancesStore, frMonthLabel } from './finances.store';
import { FoyerStore } from './foyer.store';
import { HomeContext, RulesOutcome, contextOf, rankTiles } from './home-context';
import { slotsOn } from './schedule';
import { DocSnapshot, FinSnapshot, Source, TileProvider, TileState, safeState } from './tiles/contract';
import { TILE_PROVIDERS, TileId } from './tiles/registry';

export interface HomeTileView {
  provider: TileProvider & { id: TileId };
  state: TileState<unknown>;
  /** Pourquoi cette tuile est remontée. Vide quand rien ne l'a bougée. */
  raison: string;
  /** Repliée : son titre reste, son contenu se déplie d'un tap. Jamais retirée. */
  folded: boolean;
}

/**
 * L'adaptateur entre les modules et l'accueil.
 *
 * Il compose l'instantané que voient les fournisseurs, appelle chacun derrière
 * une barrière qui avale ses exceptions, et sait quoi recharger quand on tape
 * « Réessayer ». C'est le seul endroit qui connaisse à la fois les stores et le
 * contrat : les fournisseurs restent purs, l'écran reste bête.
 *
 * Il ne calcule aucune règle métier. Si tu en vois une ici, c'est un défaut.
 */
@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private foyer = inject(FoyerStore);
  private fin = inject(FinancesStore);
  private api = inject(ApiService);

  /** Dernière panne journalisée par plan, pour ne pas répéter la même ligne. */
  private logged: Record<string, string> = {};
  /** Mois déjà demandé aux finances, pour ne pas rappeler à chaque battement d'horloge. */
  private askedMonth = '';

  constructor() {
    // Une tuile rouge doit se retrouver dans `docker logs` ou `journalctl -u foyer`
    // sans avoir à ouvrir la console du navigateur : c'est le seul moyen de
    // diagnostic quand on n'est pas devant l'écran.
    effect(() => {
      for (const [plan, src] of [['document', this.docSource()], ['finances', this.finSource()]] as const) {
        const line = src.status === 'error' ? src.detail : '';
        if (this.logged[plan] === line) continue;
        this.logged[plan] = line;
        // eslint-disable-next-line no-console
        if (line) console.error(`[foyer] accueil : source ${plan} indisponible : ${line}`);
      }
    });

    // Le contexte n'est refait qu'au changement de jour ou de moment. Entre les
    // deux, l'écran ne bouge pas : c'est toute la différence entre un écran
    // qu'on lit d'un coup d'œil et un écran qu'on cesse de regarder.
    effect(() => {
      const f = this.frontier();
      const r = untracked(() => this.rules());
      if (!f || !r || f === this.lastFrontier) return;
      this.lastFrontier = f;
      this.context.set(untracked(() => contextOf(r.rules, this.dayFacts(), this.foyer.nowHm())));
    });

    // Ce que l'accueil demande aux finances suit l'horloge du foyer : au premier
    // du mois, à minuit, la tuile change de mois toute seule, sans rechargement.
    // C'est aussi ce qui déclenche le tout premier chargement.
    effect(() => {
      if (!this.foyer.authed()) { this.askedMonth = ''; return; }
      const month = this.foyer.todayStr().slice(0, 7);
      if (!month || month === this.askedMonth) return;
      this.askedMonth = month;
      void this.fin.loadHome(month);
      void this.loadRules();
    });
  }

  /**
   * Charge les règles de contexte. Un échec n'empêche rien : sans règles,
   * l'accueil garde l'ordre du registre, qui est un ordre honnête.
   */
  async loadRules(): Promise<void> {
    if (this.rules()) return;
    try {
      const outcome = await this.api.homeRules();
      this.rules.set(outcome);
      if (outcome.errors.length) {
        // eslint-disable-next-line no-console
        console.warn('[foyer] accueil : règles de contexte ignorées : ' + outcome.errors.join(' | '));
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[foyer] accueil : règles de contexte indisponibles, ordre par défaut : ' + (e as Error).message);
    }
  }

  private docSource(): Source<DocSnapshot> {
    const doc = this.foyer.data();
    const err = this.foyer.docError();
    if (!doc) {
      return err
        ? { status: 'error', message: 'Les données du foyer ne peuvent pas être chargées.', detail: 'Document du foyer : ' + err }
        : { status: 'loading' };
    }
    // Le document est en mémoire : il est montré, mais dit ce qui cloche. Deux
    // ennuis bien différents : ne plus pouvoir relire (vue datée), et ne plus
    // pouvoir écrire (modifications en attente). Les confondre ferait croire à
    // une perte là où il n'y en a pas.
    const unsaved = this.foyer.saveState() === 'error';
    const stale = err ? 'Le serveur ne répond pas : dernière vue connue.'
      : unsaved ? 'Modifications non enregistrées : elles repartiront dès que le serveur répondra.'
      : '';
    return {
      status: 'ready',
      data: { doc, schoolHolidays: this.foyer.schoolHolidays(), articles: this.foyer.articleIndex() },
      asOf: this.foyer.docLoadedAt(),
      ...(stale ? { stale } : {}),
    };
  }

  private finSource(): Source<FinSnapshot> {
    const err = this.fin.homeError();
    const home = this.fin.home();
    // Rien à montrer et une panne : c'est une erreur. Quelque chose à montrer et
    // une panne : c'est une vue datée, et elle le dit. Même règle que le document.
    if (!home) {
      return err
        ? { status: 'error', message: 'Le module Finances ne répond pas.', detail: 'Finances : ' + err }
        : { status: 'loading' };
    }
    return {
      status: 'ready',
      asOf: this.fin.homeLoadedAt(),
      ...(err ? { stale: 'Les finances ne se rafraîchissent plus : dernier relevé connu.' } : {}),
      data: {
        month: home.month,
        monthLabel: frMonthLabel(home.month),
        summary: home.summary,
        accounts: home.accounts,
        currentBalance: home.currentBalance,
        currentAccounts: home.currentAccounts,
        deadlines: home.deadlines,
        dayExtras: this.fin.deadlineExtras(),
        contracts: home.contracts,
        savings: home.savings,
        energy: home.energy,
      },
    };
  }

  // ---- contexte ------------------------------------------------------------
  //
  // Les règles sont des données, servies par le module qui les lit sur le
  // disque. Le contexte, lui, est **figé** : il n'est recalculé qu'au
  // franchissement d'une frontière, changement de jour ou changement de moment
  // de la journée. C'est ce qui garantit qu'une tuile ne bouge jamais parce
  // qu'une donnée vient d'arriver, ce qui rendrait l'écran imprévisible.

  readonly rules = signal<RulesOutcome | null>(null);
  private readonly frontier = computed(() => {
    const r = this.rules();
    if (!r) return '';
    const moment = contextOf(r.rules, this.dayFacts(), this.foyer.nowHm()).moment;
    return this.foyer.todayStr() + '|' + (moment?.id ?? '');
  });
  private lastFrontier = '';
  readonly context = signal<HomeContext | null>(null);

  /** Ce qu'on sait du jour, lu au moment où le contexte est figé. */
  private dayFacts() {
    const today = this.foyer.todayStr();
    return {
      today,
      holiday: this.foyer.isHoliday(today),
      schoolHoliday: this.foyer.isSchoolHoliday(today),
      schedToday: slotsOn(this.foyer.data()?.sched || [], today, this.foyer.calendar()),
    };
  }

  private readonly classement = computed(() => {
    const r = this.rules();
    const ctx = this.context();
    const ids = TILE_PROVIDERS.map((p) => p.id);
    if (!r || !ctx) return new Map(ids.map((id) => [id, { id, score: 0, raison: '', folded: false }]));
    // Une tuile en panne est épinglée : ce qui est cassé doit se voir, quelle
    // que soit l'heure. Le calcul lit l'état des tuiles sans s'y abonner, sinon
    // l'ordre bougerait à chaque arrivée de donnée.
    const pinned = untracked(() => this.states().filter((t) => t.state.kind === 'error').map((t) => t.provider.id));
    return new Map(rankTiles(r.rules, ids, ctx, pinned).map((t) => [t.id, t]));
  });

  private readonly states = computed(() => {
    const ctx = { today: this.foyer.todayStr(), doc: this.docSource(), fin: this.finSource() };
    return TILE_PROVIDERS.map((provider) => ({
      provider,
      // eslint-disable-next-line no-console
      state: safeState(provider, ctx, (line, e) => console.error(line, e)),
    }));
  });

  readonly tiles = computed<HomeTileView[]>(() => {
    const rang = this.classement();
    const vues = this.states().map((t) => {
      const r = rang.get(t.provider.id);
      // Une tuile en panne ne se replie pas : on ne cache pas ce qui est cassé.
      const enPanne = t.state.kind === 'error';
      return { ...t, raison: r?.raison ?? '', folded: !enPanne && !!r?.folded, ordre: [...rang.keys()].indexOf(t.provider.id) };
    });
    return vues.sort((a, b) => a.ordre - b.ordre).map(({ ordre, ...v }) => { void ordre; return v; });
  });

  open(p: TileProvider): void { this.foyer.go(p.screen); }

  /** Recharge le plan de données dont dépend la tuile, et lui seul. */
  retry(p: TileProvider): void {
    if (p.source === 'finances') void this.fin.loadHome(this.foyer.todayStr().slice(0, 7));
    else void this.foyer.reloadDocument();
  }
}
