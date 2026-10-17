import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { ChartTip, FinTip, eur } from './tip';

export interface CompareRow { id: number; name: string; spent: number; average: number; }

const ROW = 26, L = 140, R = 66;

/**
 * Chaque catégorie, ce mois jusqu'au jour de référence, face à sa moyenne des
 * mois précédents au même jour (le trait). L'écart s'écrit en bout de ligne, en
 * gras quand il pèse (40 € ou plus).
 */
@Component({
  selector: 'fin-cat-compare',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FinTip],
  template: `
    @let g = geo();
    <svg [attr.viewBox]="'0 0 ' + width() + ' ' + g.h" role="img" aria-label="Dépenses par catégorie face à la moyenne au même jour">
      @for (r of g.rows; track r.id) {
        <g class="mk" tabindex="0" [attr.aria-label]="r.tipValue + ', ' + r.tipLabel"
           (pointermove)="tip.at($event, host, r.tipValue, r.tipLabel)" (pointerleave)="tip.hide()"
           (focus)="tip.on($event.target, host, r.tipValue, r.tipLabel)" (blur)="tip.hide()">
          <rect class="hit" x="0" [attr.y]="r.y" [attr.width]="width()" [attr.height]="ROW" />
          <rect class="track" [attr.x]="L" [attr.y]="r.y + 7" [attr.width]="g.pw" height="12" rx="4" />
          <rect class="bar" [attr.x]="L" [attr.y]="r.y + 7" [attr.width]="r.w" height="12" rx="4" />
          @if (r.average > 0) { <rect class="avg" [attr.x]="r.ax" [attr.y]="r.y + 3" width="2.5" height="20" rx="1" /> }
        </g>
        <text class="lbl" [attr.x]="L - 8" [attr.y]="r.y + 17" text-anchor="end">{{ r.name }}</text>
        <text class="diff" [class.strong]="r.strong" [attr.x]="width() - 4" [attr.y]="r.y + 17" text-anchor="end">{{ r.diff }}</text>
      }
    </svg>
    <fin-tip [tip]="tip.state()" />
  `,
  styles: [`
    :host { display: block; position: relative; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .hit { fill: transparent; }
    .mk { outline: none; }
    .mk:hover .hit, .mk:focus-visible .hit { fill: var(--soft); }
    .track { fill: var(--chart-seq-track); }
    .bar { fill: var(--chart-seq); }
    .avg { fill: var(--ink); }
    .lbl { font-size: 11.5px; font-weight: 700; fill: var(--ink2); }
    .diff { font-size: 11.5px; font-weight: 700; fill: var(--ink2); }
    .diff.strong { font-weight: 800; fill: var(--ink); }
  `],
})
export class FinCatCompare {
  readonly rows = input.required<CompareRow[]>();
  /** « au 17 » / « octobre » : pour l'infobulle. */
  readonly when = input('');
  readonly monthName = input('');
  readonly width = input(560);

  readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  readonly tip = new ChartTip();
  readonly ROW = ROW; readonly L = L;

  readonly geo = computed(() => {
    const rows = this.rows(), pw = this.width() - L - R;
    const max = Math.max(1, ...rows.map((r) => Math.max(r.spent, r.average)));
    return {
      pw, h: rows.length * ROW + 4,
      rows: rows.map((r, i) => {
        const diff = r.spent - r.average;
        return {
          ...r, y: 2 + i * ROW, w: Math.max(r.spent > 0 ? 4 : 0, (r.spent / max) * pw), ax: L + (r.average / max) * pw - 1,
          diff: Math.round(diff / 100) === 0 ? '=' : (diff > 0 ? '+' : '−') + eur(Math.abs(diff)),
          strong: Math.abs(diff) >= 4000,
          tipValue: `${eur(r.spent)} en ${this.monthName()}`, tipLabel: `${r.name} · moyenne ${this.when()} : ${eur(r.average)}`,
        };
      }),
    };
  });
}
