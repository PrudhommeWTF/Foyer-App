import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { TileComponent } from '../../shared/tile';
import { fmtEurosInt } from '../../core/finances.store';
import { FinancesTileData } from '../../core/tiles/finances.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-finances',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent],
  template: `
    <f-tile [title]="tile().title" [badge]="badge()" [link]="tile().link" [state]="state()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="amt f-display">{{ eur(d.expense) }} €@if (d.budgetTotal > 0) { <span class="total"> / {{ eur(d.budgetTotal) }} €</span> }</div>
        @if (d.budgetTotal > 0) {
          <div class="bar"><div class="bar-fill" [style.width.%]="barW(d.expense, d.budgetTotal)"></div></div>
          <div class="note">
            {{ d.expense <= d.budgetTotal
              ? 'Il reste ' + eur(d.budgetTotal - d.expense) + ' € sur le budget de référence'
              : 'Budget de référence dépassé de ' + eur(d.expense - d.budgetTotal) + ' €' }}
          </div>
        } @else {
          <div class="note">{{ eur(d.income) }} € de ressources, solde {{ d.balance > 0 ? '+' : '' }}{{ eur(d.balance) }} €</div>
        }
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .amt { font-size: 28px; font-weight: 700; color: var(--ink); }
    .total { font-size: 15px; color: var(--ink3); font-weight: 700; }
    .bar { height: 9px; background: var(--line2); border-radius: 8px; margin-top: 12px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, #F0B24B, #E56B4E); border-radius: 8px; }
    .note { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 8px; }
  `],
})
export class FinancesTile extends HomeTile<FinancesTileData> {
  readonly badge = computed(() => this.data()?.monthLabel ?? '');
  eur = fmtEurosInt;
  barW(expense: number, budget: number): number { return budget > 0 ? Math.min(expense / budget * 100, 100) : 0; }
}
