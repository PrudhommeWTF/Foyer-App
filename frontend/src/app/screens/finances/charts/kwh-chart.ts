import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { FinPeriod } from '../../../core/finances.api';
import { ChartTip, FinTip, niceStep } from './tip';

const L = 30, R = 6, T = 10, B = 24;
const kwh = (v: number): string => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/**
 * La consommation par jour de chaque période de relevé, avec le repère de la
 * même période un an plus tôt. Les périodes sans mesure (premier relevé, index
 * qui recule…) n'ont pas de barre : elles sont dites dans le tableau.
 */
@Component({
  selector: 'fin-kwh-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FinTip],
  template: `
    @let g = geo();
    <svg [attr.viewBox]="'0 0 ' + width() + ' ' + height()" role="img" aria-label="Consommation en kWh par jour, par période de relevé">
      @for (t of g.ticks; track t.v) {
        <line class="grid" [attr.x1]="L" [attr.x2]="width() - R" [attr.y1]="t.y" [attr.y2]="t.y" />
        <text class="ax" [attr.x]="L - 5" [attr.y]="t.y + 4" text-anchor="end">{{ t.v }}</text>
      }
      @for (b of g.bars; track b.id) {
        <g class="mk" tabindex="0" [attr.aria-label]="b.value + ', ' + b.label"
           (pointermove)="tip.at($event, host, b.value, b.label)" (pointerleave)="tip.hide()"
           (focus)="tip.on($event.target, host, b.value, b.label)" (blur)="tip.hide()">
          <rect class="hit" [attr.x]="b.slot" [attr.y]="T" [attr.width]="g.bw" [attr.height]="height() - T - B" />
          <path class="bar" [attr.d]="b.d" />
          @if (b.ly !== null) { <rect class="ly" [attr.x]="b.x - 3" [attr.y]="b.ly - 1.5" [attr.width]="b.w + 6" height="3" rx="1.5" /> }
        </g>
        <text class="ax" [attr.x]="b.x + b.w / 2" [attr.y]="height() - 6" text-anchor="middle">{{ b.short }}</text>
      }
    </svg>
    <fin-tip [tip]="tip.state()" />
  `,
  styles: [`
    :host { display: block; position: relative; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .grid { stroke: var(--line); stroke-width: 1; }
    .ax { font-size: 11px; font-weight: 700; fill: var(--ink3); }
    .bar { fill: var(--chart-pos); }
    .ly { fill: var(--ink); }
    .hit { fill: transparent; }
    .mk { outline: none; }
    .mk:hover .hit, .mk:focus-visible .hit { fill: var(--soft); }
  `],
})
export class FinKwhChart {
  readonly periods = input.required<FinPeriod[]>();
  readonly width = input(560);
  readonly height = input(200);

  readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  readonly tip = new ChartTip();
  readonly L = L; readonly R = R; readonly T = T; readonly B = B;

  readonly geo = computed(() => {
    // Les douze dernières périodes mesurées, de la plus ancienne à la plus récente.
    const ps = this.periods().filter((p) => p.kwhPerDay !== null && !p.gap).sort((a, b) => a.to.localeCompare(b.to)).slice(-12);
    const W = this.width(), H = this.height();
    const peak = Math.max(1, ...ps.map((p) => Math.max(p.kwhPerDay ?? 0, p.lastYearKwhPerDay ?? 0)));
    const step = niceStep(peak), max = Math.ceil(peak / step) * step;
    const y = (v: number): number => T + (H - T - B) * (1 - v / max);
    const ticks = [];
    for (let v = 0; v <= max + 1e-9; v += step) ticks.push({ v: kwh(v), y: y(v) });
    const bw = (W - L - R) / Math.max(1, ps.length);
    const bars = ps.map((p, i) => {
      const w = Math.max(4, bw - 6), x = L + i * bw + 3, top = y(p.kwhPerDay!), base = y(0), r = Math.min(4, w / 2, base - top);
      const [yy, mm] = p.to.split('-').map(Number);
      const short = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' });
      return {
        id: p.readingId, slot: L + i * bw, x, w, short,
        d: `M${x},${base} V${top + r} q0,-${r} ${r},-${r} H${x + w - r} q${r},0 ${r},${r} V${base} Z`,
        ly: p.lastYearKwhPerDay !== null ? y(p.lastYearKwhPerDay) : null,
        value: `${kwh(p.kwhPerDay!)} kWh par jour`,
        label: `du ${this.day(p.from)} au ${this.day(p.to)} (${p.days} j)`
          + (p.lastYearKwhPerDay !== null ? ` · un an plus tôt : ${kwh(p.lastYearKwhPerDay)} kWh/j` : ''),
      };
    });
    return { ticks, bars, bw };
  });

  private day(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
}
