import { Injectable, computed, effect, inject } from '@angular/core';
import { FinancesStore, frMonthLabel } from './finances.store';
import { FoyerStore } from './foyer.store';
import { DocSnapshot, FinSnapshot, Source, TileProvider, TileState, safeState } from './tiles/contract';
import { TILE_PROVIDERS, TileId } from './tiles/registry';

export interface HomeTileView {
  provider: TileProvider & { id: TileId };
  state: TileState<unknown>;
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

    // Ce que l'accueil demande aux finances suit l'horloge du foyer : au premier
    // du mois, à minuit, la tuile change de mois toute seule, sans rechargement.
    // C'est aussi ce qui déclenche le tout premier chargement.
    effect(() => {
      if (!this.foyer.authed()) { this.askedMonth = ''; return; }
      const month = this.foyer.todayStr().slice(0, 7);
      if (!month || month === this.askedMonth) return;
      this.askedMonth = month;
      void this.fin.loadHome(month);
    });
  }

  private docSource(): Source<DocSnapshot> {
    const doc = this.foyer.data();
    const err = this.foyer.docError();
    if (!doc) {
      return err
        ? { status: 'error', message: 'Les données du foyer ne peuvent pas être chargées.', detail: 'Document du foyer : ' + err }
        : { status: 'loading' };
    }
    // Le document est en mémoire : il est montré, mais dit qu'il ne se
    // rafraîchit plus. Une vue datée vaut mieux qu'un écran vide, à condition
    // qu'elle ne se fasse pas passer pour fraîche.
    return {
      status: 'ready',
      data: { doc, schoolHolidays: this.foyer.schoolHolidays(), articles: this.foyer.articleIndex() },
      asOf: this.foyer.docLoadedAt(),
      ...(err ? { stale: 'Le serveur ne répond pas : dernière vue connue.' } : {}),
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
        deadlines: home.deadlines,
        dayExtras: this.fin.deadlineExtras(),
        contracts: home.contracts,
        savings: home.savings,
        energy: home.energy,
      },
    };
  }

  readonly tiles = computed<HomeTileView[]>(() => {
    const ctx = { today: this.foyer.todayStr(), doc: this.docSource(), fin: this.finSource() };
    return TILE_PROVIDERS.map((provider) => ({
      provider,
      // eslint-disable-next-line no-console
      state: safeState(provider, ctx, (line, e) => console.error(line, e)),
    }));
  });

  open(p: TileProvider): void { this.foyer.go(p.screen); }

  /** Recharge le plan de données dont dépend la tuile, et lui seul. */
  retry(p: TileProvider): void {
    if (p.source === 'finances') void this.fin.loadHome(this.foyer.todayStr().slice(0, 7));
    else void this.foyer.reloadDocument();
  }
}
