import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { FinMonthPoint } from '../../../core/finances.api';
import { frMonthLabel } from '../../../core/finances.store';
import { ChartTip, FinTip, axisLabel, eur, niceStep, signed } from './tip';

const L = 40, R = 6, T = 14, B = 22;

/** « 2026-08 » vers « août » ; janvier porte l'année, pour qu'on la voie changer. */
export function shortMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' });
  return m === 1 ? `${label} ${String(y).slice(2)}` : label;
}

/**
 * Le solde de chaque mois, de part et d'autre de zéro : bleu au-dessus,
 * terracotta en dessous. Un mois incomplet est hachuré, le mois en cours
 * atténué. Le détail (ressources, dépenses) est dans l'infobulle et dans le
 * tableau dépliable, qui rend aussi les chiffres lisibles sans graphique.
 */
@Component({
  selector: 'fin-net-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FinTip],
  template: `
    @let g = geo();
    <div class="wrap">
      <svg [attr.viewBox]="'0 0 ' + width() + ' ' + height()" role="img" aria-label="Solde de chaque mois, détail au survol ou au clavier">
        <defs>
          <pattern id="finNetHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--chart-pos)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--surface)" stroke-width="2" />
          </pattern>
          <pattern id="finNetHatchNeg" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--chart-neg)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--surface)" stroke-width="2" />
          </pattern>
        </defs>
        @for (t of g.ticks; track t.v) {
          <line [class.zero]="t.v === 0" class="grid" [attr.x1]="L" [attr.x2]="width() - R" [attr.y1]="t.y" [attr.y2]="t.y" />
          <text class="ax" [attr.x]="L - 5" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
        }
        @for (b of g.bars; track b.month) {
          <g class="mk" tabindex="0" [attr.aria-label]="b.value + ', ' + b.label"
             (pointermove)="tip.at($event, host, b.value, b.label)" (pointerleave)="tip.hide()"
             (focus)="tip.on($event.target, host, b.value, b.label)" (blur)="tip.hide()">
            <rect class="hit" [attr.x]="b.slot" [attr.y]="T" [attr.width]="g.bw" [attr.height]="height() - T - B" />
            <path [attr.d]="b.d" [attr.fill]="b.fill" [attr.opacity]="b.current ? .45 : 1" />
          </g>
          @if (b.showLabel) {
            <text class="ax" [attr.x]="b.cx" [attr.y]="height() - 6" text-anchor="middle">{{ b.short }}</text>
          }
        }
        @if (g.lowest; as lo) {
          <text class="lbl" [attr.x]="lo.cx" [attr.y]="lo.y" text-anchor="middle">{{ lo.text }}</text>
        }
      </svg>
      <fin-tip [tip]="tip.state()" />
    </div>
    <details class="tbl-wrap">
      <summary>Voir le tableau</summary>
      <table class="tbl">
        <thead><tr><th>Mois</th><th>Ressources</th><th>Dépenses</th><th>Solde</th></tr></thead>
        <tbody>
          @for (p of points(); track p.month) {
            <tr>
              <td>{{ monthName(p.month) }}@if (p.month === current()) { (en cours) } @else if (p.incomplete) { (incomplet) }</td>
              <td class="num">+{{ eur(p.income) }}</td><td class="num">−{{ eur(p.expense) }}</td><td class="num">{{ signed(p.balance) }}</td>
            </tr>
          }
        </tbody>
      </table>
    </details>
  `,
  styles: [`
    :host { display: block; }
    .wrap { position: relative; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .grid { stroke: var(--line); stroke-width: 1; }
    .grid.zero { stroke: var(--ink3); }
    .ax { font-size: 10.5px; font-weight: 700; fill: var(--ink3); }
    .lbl { font-size: 11px; font-weight: 800; fill: var(--ink); }
    .hit { fill: transparent; }
    .mk { outline: none; cursor: default; }
    .mk:hover .hit, .mk:focus-visible .hit { fill: var(--soft2); }
    .tbl-wrap { margin-top: 8px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .tbl-wrap summary { cursor: pointer; color: var(--ink2); }
    .tbl { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .tbl th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink3); padding: 4px 6px; }
    .tbl td { padding: 5px 6px; border-top: 1px solid var(--line); color: var(--ink); }
    .tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
    .tbl th:not(:first-child) { text-align: right; }
  `],
})
export class FinNetChart {
  readonly points = input.required<FinMonthPoint[]>();
  /** Le mois en cours (AAAA-MM) : sa barre est atténuée. */
  readonly current = input('');
  /** Jour de référence du mois en cours, pour l'infobulle (« au 17 »). */
  readonly day = input(0);
  readonly width = input(560);
  readonly height = input(220);
  /** Sur un écran étroit, une étiquette de mois sur deux. */
  readonly compact = input(false);

  readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  readonly tip = new ChartTip();
  readonly L = L; readonly R = R; readonly T = T; readonly B = B;
  readonly eur = eur; readonly signed = signed; readonly monthName = frMonthLabel;

  readonly geo = computed(() => {
    const pts = this.points(), W = this.width(), H = this.height();
    const hi = Math.max(0, ...pts.map((p) => p.balance)), lo = Math.min(0, ...pts.map((p) => p.balance));
    const step = niceStep(Math.max(hi - lo, 100));
    const max = Math.ceil(hi / step) * step || step, min = Math.floor(lo / step) * step;
    const ph = H - T - B, pw = W - L - R, bw = pw / Math.max(1, pts.length);
    const y = (v: number): number => T + (max - v) / (max - min) * ph;
    const ticks = [];
    for (let v = min; v <= max; v += step) ticks.push({ v, y: y(v), label: axisLabel(v) });
    const bars = pts.map((p, i) => {
      const x0 = L + i * bw + 1, w = Math.max(2, bw - 2), v = p.balance, r = Math.min(4, w / 2);
      const h = Math.abs(y(v) - y(0)), rr = Math.min(r, h);
      // Arrondi du seul côté de la valeur, carré sur la ligne de zéro.
      const d = v >= 0
        ? `M${x0},${y(0)} V${y(v) + rr} q0,-${rr} ${rr},-${rr} H${x0 + w - rr} q${rr},0 ${rr},${rr} V${y(0)} Z`
        : `M${x0},${y(0)} V${y(v) - rr} q0,${rr} ${rr},${rr} H${x0 + w - rr} q${rr},0 ${rr},-${rr} V${y(0)} Z`;
      const current = p.month === this.current();
      const fill = p.incomplete && !current ? (v >= 0 ? 'url(#finNetHatch)' : 'url(#finNetHatchNeg)') : v >= 0 ? 'var(--chart-pos)' : 'var(--chart-neg)';
      const label = `${frMonthLabel(p.month)} · ressources +${eur(p.income)} · dépenses −${eur(p.expense)}`
        + (current ? ` · en cours${this.day() ? ', au ' + this.day() : ''}` : p.incomplete ? ' · mois incomplet' : '');
      return {
        month: p.month, slot: L + i * bw, cx: x0 + w / 2, d, fill, current, label, value: 'solde ' + signed(v),
        short: shortMonth(p.month), showLabel: !this.compact() || i % 2 === pts.length % 2 || current,
      };
    });
    // Le mois le plus bas, s'il est négatif, porte son montant : c'est lui qu'on cherche.
    const worst = pts.reduce((a, p, i) => (p.balance < (a?.v ?? 0) ? { i, v: p.balance } : a), null as { i: number; v: number } | null);
    const lowest = worst ? { cx: bars[worst.i].cx, y: y(worst.v) + 14, text: signed(worst.v) } : null;
    return { ticks, bars, bw, lowest };
  });
}
