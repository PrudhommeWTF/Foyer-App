import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { EntretienApi, GesteCost } from '../../core/entretien.api';
import { fmtEuros, fmtEurosInt } from '../../core/finances.store';
import { freqLabel } from '../../core/entretien';

interface Ligne { c: GesteCost; text: string; room: string; freq: string; contract: string; }

/**
 * Ce que coûte l'entretien de la maison : la prévision sur un an (coût de
 * chaque geste × ses passages, saisons comprises) face à ce qui a été
 * réellement noté sur douze mois, geste par geste et par pièce. Un contrat qui
 * couvre des gestes (la chaudière) compte une fois, à son coût réel.
 */
@Component({
  selector: 'fin-entretien-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <div class="panel-head">
        <div class="panel-title">Entretien de la maison</div>
        <button class="soft-btn" (click)="foyer.go('entretien')">Ouvrir Entretien</button>
      </div>
      <div class="panel-sub">Le coût de chaque geste est noté à chaque fois qu'il est fait, au prix du moment. Il se règle dans la fiche du geste (Modifier).</div>
      @if (api.couts(); as s) {
        @if (lignes().length) {
          <div class="totals">
            <span>Prévu sur un an <b>{{ eur(s.totals.forecast) }} €</b></span>
            <span>Dépensé sur 12 mois <b>{{ eur(s.totals.real12) }} €</b></span>
          </div>
          @for (l of lignes(); track l.c.taskId) {
            <button type="button" class="row" (click)="foyer.openItem('task', l.c.taskId)">
              <span class="r-body">
                <span class="r-title">{{ l.text }}</span>
                <span class="r-meta">{{ l.room ? l.room + ' · ' : '' }}{{ l.freq }}{{ l.contract ? ' · couvert par « ' + l.contract + ' »' : l.c.amount ? ' · ' + eurC(l.c.amount) + ' € à chaque fois' : '' }}</span>
              </span>
              <span class="r-num">
                @if (l.c.forecast !== null) { <b>{{ eur(l.c.forecast) }} €</b><small>par an</small> }
                @if (l.c.real12) { <small>{{ eur(l.c.real12) }} € sur 12 mois</small> }
              </span>
            </button>
          }
          @if (contrats().length) {
            <div class="sub">Contrats rattachés, à leur coût réel</div>
            @for (c of contrats(); track c.id) {
              <div class="row ro"><span class="r-body"><span class="r-title">{{ c.name }}</span><span class="r-meta">{{ c.provider }}</span></span>
                <span class="r-num"><b>{{ eur(c.real12) }} €</b><small>sur 12 mois</small></span></div>
            }
          }
          @if (pieces().length > 1) {
            <div class="sub">Par pièce, prévu sur un an</div>
            @for (p of pieces(); track p.name) {
              <div class="row ro"><span class="r-body"><span class="r-title">{{ p.name }}</span></span><span class="r-num"><b>{{ eur(p.total) }} €</b></span></div>
            }
          }
        } @else {
          <div class="none">Aucun geste chiffré pour l'instant. Donnez un coût à un geste (la cartouche, le ramonage) dans sa fiche : il apparaîtra ici, avec son total sur l'année.</div>
        }
      } @else {
        <div class="none">Chargement…</div>
      }
    </section>
  `,
  styles: [`
    .panel { background: var(--surface); border-radius: var(--r-card-lg); padding: 20px 22px; margin-bottom: 16px; box-shadow: var(--sh-card); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .panel-title { font-size: 16px; font-weight: 800; color: var(--ink); }
    .panel-sub { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin: 4px 0 8px; line-height: 1.45; }
    .soft-btn { border: none; background: var(--soft); color: var(--ink2); font: inherit; font-size: 12.5px; font-weight: 800; border-radius: 10px; padding: 7px 11px; cursor: pointer; white-space: nowrap; }
    .totals { display: flex; gap: 8px 24px; flex-wrap: wrap; font-size: 13.5px; font-weight: 700; color: var(--ink2); margin: 10px 0 6px; }
    .totals b { color: var(--ink); }
    .sub { font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .04em; margin: 16px 0 4px; }
    .row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; border: none; background: none; font: inherit; padding: 10px 0; border-top: 1px solid var(--line); cursor: pointer; }
    .row.ro { cursor: default; }
    .r-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .r-title { font-size: 14px; font-weight: 800; color: var(--ink); }
    .r-meta { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .r-num { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; font-size: 14px; color: var(--ink); white-space: nowrap; }
    .r-num small { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .none { font-size: 13px; font-weight: 700; color: var(--ink3); padding: 10px 0; line-height: 1.5; }
  `],
})
export class FinEntretienPanel implements OnInit {
  readonly foyer = inject(FoyerStore);
  readonly api = inject(EntretienApi);
  readonly eur = fmtEurosInt;
  readonly eurC = fmtEuros;

  ngOnInit(): void { void this.api.chargerCouts(); }

  readonly lignes = computed<Ligne[]>(() => {
    const s = this.api.couts(); if (!s) return [];
    const names = new Map(s.contracts.map((c) => [c.id, c.name]));
    return s.gestes.flatMap((c) => {
      const t = this.foyer.task(c.taskId);
      if (!t) return [];
      return [{ c, text: t.text, room: this.foyer.roomName(t.maintenance?.roomId) || '', freq: t.rec ? freqLabel(t.rec) : '', contract: c.contractId !== null ? names.get(c.contractId) || '' : '' }];
    }).sort((a, b) => (b.c.forecast ?? 0) - (a.c.forecast ?? 0) || b.c.real12 - a.c.real12 || a.text.localeCompare(b.text, 'fr'));
  });
  readonly contrats = computed(() => {
    const s = this.api.couts(); if (!s) return [];
    const ids = new Set(s.gestes.map((g) => g.contractId).filter((x) => x !== null));
    return s.contracts.filter((c) => ids.has(c.id));
  });
  readonly pieces = computed(() => {
    const by = new Map<string, number>();
    for (const l of this.lignes()) if (l.c.forecast) by.set(l.room || 'Sans pièce', (by.get(l.room || 'Sans pièce') ?? 0) + l.c.forecast);
    return [...by.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  });
}
