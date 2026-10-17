import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { FinYearCategory } from '../../../core/finances.api';
import { ChartTip, FinTip, eur } from './tip';

const ROW = 26, L = 140, R = 76;

/**
 * Les dépenses de l'année par catégorie, face au budget de référence multiplié
 * par les mois écoulés (le trait). Un dépassement passe en rouge, avec ⚠ et
 * l'écart écrit : la couleur n'est jamais seule à le dire.
 */
@Component({
  selector: 'fin-budget-year',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FinTip],
  template: `
    @let g = geo();
    <svg [attr.viewBox]="'0 0 ' + width() + ' ' + g.h" role="img" aria-label="Dépenses de l'année par catégorie face au budget cumulé">
      @for (r of g.rows; track r.key) {
        <g class="mk" tabindex="0" [attr.aria-label]="r.tipValue + ', ' + r.tipLabel"
           (pointermove)="tip.at($event, host, r.tipValue, r.tipLabel)" (pointerleave)="tip.hide()"
           (focus)="tip.on($event.target, host, r.tipValue, r.tipLabel)" (blur)="tip.hide()">
          <rect class="hit" x="0" [attr.y]="r.y" [attr.width]="width()" [attr.height]="ROW" />
          <rect class="track" [attr.x]="L" [attr.y]="r.y + 8" [attr.width]="g.pw" height="10" rx="4" />
          <rect class="bar" [class.over]="r.over" [attr.x]="L" [attr.y]="r.y + 8" [attr.width]="r.w" height="10" rx="4" />
          @if (r.budget > 0) { <rect class="ref" [attr.x]="r.bx" [attr.y]="r.y + 4" width="2.5" height="18" rx="1" /> }
        </g>
        <text class="lbl" [attr.x]="L - 8" [attr.y]="r.y + 17" text-anchor="end">{{ r.name }}</text>
        <text class="val" [class.over]="r.over" [attr.x]="width() - 4" [attr.y]="r.y + 17" text-anchor="end">{{ r.text }}</text>
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
    .track { fill: var(--soft2); }
    .bar { fill: var(--chart-pace); }
    .bar.over { fill: var(--status-crit); }
    .ref { fill: var(--ink); }
    .lbl { font-size: 11.5px; font-weight: 700; fill: var(--ink2); }
    .val { font-size: 11.5px; font-weight: 700; fill: var(--ink2); }
    .val.over { font-weight: 800; fill: var(--status-crit); }
  `],
})
export class FinBudgetYear {
  readonly rows = input.required<FinYearCategory[]>();
  /** « janvier à octobre » : pour l'infobulle. */
  readonly span = input('');
  readonly width = input(560);

  readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  readonly tip = new ChartTip();
  readonly ROW = ROW; readonly L = L;

  readonly geo = computed(() => {
    const rows = this.rows(), pw = this.width() - L - R;
    const max = Math.max(1, ...rows.map((r) => Math.max(r.spent, r.budget)));
    return {
      pw, h: rows.length * ROW + 4,
      rows: rows.map((r, i) => {
        const over = r.budget > 0 && r.spent > r.budget;
        return {
          ...r, key: r.categoryId ?? 0, over, y: 2 + i * ROW,
          w: Math.max(r.spent > 0 ? 4 : 0, (r.spent / max) * pw), bx: L + (r.budget / max) * pw - 1,
          text: over ? `⚠ +${eur(r.spent - r.budget)}` : eur(r.spent),
          tipValue: `${eur(r.spent)} ${this.span()}`,
          tipLabel: r.budget > 0 ? `${r.name} · budget cumulé ${eur(r.budget)}${over ? ' · dépassé' : ''}` : `${r.name} · sans budget`,
        };
      }),
    };
  });
}
