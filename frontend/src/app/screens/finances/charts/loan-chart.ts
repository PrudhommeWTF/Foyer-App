import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { FinInstalment } from '../../../core/finances.api';
import { ChartTip, FinTip, axisLabel, eur, niceStep } from './tip';

const L = 48, R = 14, T = 12, B = 26;

/**
 * Le capital restant dû sur toute la durée du prêt : le passé en plein, le
 * futur atténué, un repère « aujourd'hui ». Le réticule s'accroche à
 * l'échéance la plus proche, au pointeur comme aux flèches du clavier.
 */
@Component({
  selector: 'fin-loan-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FinTip],
  template: `
    @let g = geo();
    <svg [attr.viewBox]="'0 0 ' + width() + ' ' + height()" role="img" [attr.aria-label]="aria()">
      @for (t of g.yTicks; track t.v) {
        <line class="grid" [attr.x1]="L" [attr.x2]="width() - R" [attr.y1]="t.y" [attr.y2]="t.y" />
        <text class="ax" [attr.x]="L - 6" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
      }
      @for (t of g.xTicks; track t.label) {
        <text class="ax" [attr.x]="t.x" [attr.y]="height() - 6" text-anchor="middle">{{ t.label }}</text>
      }
      @if (g.pastPts) {
        <polygon class="area" [attr.points]="g.pastArea" />
        <polyline class="past" [attr.points]="g.pastPts" />
      }
      <polyline class="future" [attr.points]="g.futurePts" />
      @if (g.today; as td) {
        <line class="today" [attr.x1]="td.x" [attr.x2]="td.x" [attr.y1]="T" [attr.y2]="height() - B" />
        <circle class="dot" [attr.cx]="td.x" [attr.cy]="td.y" r="5" />
        <text class="val" [attr.x]="td.x + (td.right ? 9 : -9)" [attr.y]="td.y - 9" [attr.text-anchor]="td.right ? 'start' : 'end'">{{ eur(td.owed) }} aujourd'hui</text>
      }
      @if (cross() !== null) {
        <line class="cross" [attr.x1]="g.x(cross()!)" [attr.x2]="g.x(cross()!)" [attr.y1]="T" [attr.y2]="height() - B" />
      }
      <rect class="hit" [attr.x]="L" [attr.y]="T" [attr.width]="width() - L - R" [attr.height]="height() - T - B" tabindex="0"
            aria-label="Parcourir les échéances aux flèches"
            (pointermove)="move($event)" (pointerleave)="leave()" (focus)="key($event)" (blur)="leave()" (keydown)="key($event)" />
    </svg>
    <fin-tip [tip]="tip.state()" />
  `,
  styles: [`
    :host { display: block; position: relative; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .grid { stroke: var(--line); stroke-width: 1; }
    .ax { font-size: 11.5px; font-weight: 700; fill: var(--ink3); }
    .val { font-size: 12.5px; font-weight: 800; fill: var(--ink); }
    .area { fill: var(--chart-pos); opacity: .12; }
    .past { fill: none; stroke: var(--chart-pos); stroke-width: 2.5; stroke-linejoin: round; }
    .future { fill: none; stroke: var(--chart-pos); stroke-width: 2; opacity: .45; }
    .today { stroke: var(--ink); stroke-width: 1.5; }
    .dot { fill: var(--chart-pos); stroke: var(--surface); stroke-width: 2; }
    .cross { stroke: var(--ink3); stroke-width: 1; }
    .hit { fill: transparent; outline: none; cursor: crosshair; }
    .hit:focus-visible { stroke: var(--ink3); stroke-dasharray: 3 3; }
  `],
})
export class FinLoanChart {
  readonly schedule = input.required<FinInstalment[]>();
  /** Aujourd'hui, AAAA-MM-JJ. */
  readonly today = input.required<string>();
  readonly width = input(900);
  readonly height = input(260);

  private host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  readonly tip = new ChartTip();
  readonly cross = signal<number | null>(null);
  readonly L = L; readonly R = R; readonly T = T; readonly B = B;
  readonly eur = eur;

  /** Points : le capital avant la première échéance, puis après chacune. Index 0 = départ. */
  private readonly points = computed(() => {
    const s = this.schedule();
    if (!s.length) return [];
    return [{ date: '', owed: s[0].owed + s[0].principal }, ...s.map((i) => ({ date: i.date, owed: i.owed }))];
  });

  /** Dernier point déjà passé (les échéances sont dans l'ordre), -1 sans échéancier. */
  private readonly pastIdx = computed(() => this.points().filter((p, i) => i === 0 || p.date <= this.today()).length - 1);

  readonly geo = computed(() => {
    const pts = this.points(), W = this.width(), H = this.height(), n = Math.max(1, pts.length - 1);
    const max0 = Math.max(1, ...pts.map((p) => p.owed));
    const step = niceStep(max0), max = Math.ceil(max0 / step) * step;
    const x = (i: number): number => L + (i / n) * (W - L - R);
    const y = (v: number): number => T + (H - T - B) - (v / max) * (H - T - B);
    const yTicks = [];
    for (let v = 0; v <= max; v += step) yTicks.push({ v, y: y(v), label: axisLabel(v) });
    // Une graduation par année ronde, cinq au plus.
    const years = [...new Set(pts.slice(1).map((p) => p.date.slice(0, 4)))];
    const every = Math.max(1, Math.ceil(years.length / 5));
    const xTicks = years.filter((_, k) => k % every === 0).map((yr) => ({ label: yr, x: x(pts.findIndex((p) => p.date.startsWith(yr))) }));
    const past = this.pastIdx();
    const line = (from: number, to: number): string => pts.slice(from, to + 1).map((p, k) => `${x(from + k)},${y(p.owed)}`).join(' ');
    const pastPts = past > 0 ? line(0, past) : '';
    const today = past >= 0 && past < pts.length - 1 ? { x: x(past), y: y(pts[past].owed), owed: pts[past].owed, right: past < n * 0.7 } : null;
    return {
      x, yTicks, xTicks, pastPts, pastArea: pastPts ? `${x(0)},${y(0)} ${pastPts} ${x(past)},${y(0)}` : '',
      futurePts: line(Math.max(0, past), pts.length - 1), today,
    };
  });

  readonly aria = computed(() => {
    const g = this.geo(), s = this.schedule();
    return `Capital restant dû${g.today ? ' : ' + eur(g.today.owed) + " aujourd'hui" : ''}, dernière échéance ${s.length ? s[s.length - 1].date : ''}`;
  });

  private show(i: number, place: (v: string, l: string) => void): void {
    const s = this.schedule();
    this.cross.set(i);
    if (i === 0) { place(`${eur(this.points()[0].owed)} empruntés`, 'avant la première échéance'); return; }
    const e = s[i - 1];
    const [yy, mm, dd] = e.date.split('-');
    place(`${eur(e.owed)} restant dû`, `échéance ${e.n} du ${dd}/${mm}/${yy} · capital ${eur(e.principal)} · intérêts ${eur(e.interest)}`);
  }

  move(ev: PointerEvent): void {
    const r = (ev.target as SVGElement).ownerSVGElement!.getBoundingClientRect();
    const n = Math.max(1, this.points().length - 1);
    const i = Math.max(0, Math.min(n, Math.round(((ev.clientX - r.left) * this.width() / r.width - L) / (this.width() - L - R) * n)));
    this.show(i, (v, l) => this.tip.at(ev, this.host, v, l));
  }

  key(ev: Event): void {
    const n = this.points().length - 1;
    const k = ev instanceof KeyboardEvent ? ev.key : '';
    const cur = this.cross() ?? Math.max(0, this.pastIdx());
    const i = k === 'ArrowLeft' ? cur - 1 : k === 'ArrowRight' ? cur + 1 : k === 'Home' ? 0 : k === 'End' ? n : k ? null : cur;
    if (i === null) return;
    ev.preventDefault();
    const at = Math.max(0, Math.min(n, i));
    const svg = (ev.target as SVGElement).ownerSVGElement!;
    const r = svg.getBoundingClientRect(), h = this.host.getBoundingClientRect(), s = r.width / this.width();
    this.show(at, (v, l) => this.tip.state.set({ x: r.left - h.left + this.geo().x(at) * s, y: r.top - h.top + T * s, value: v, label: l }));
  }

  leave(): void { this.cross.set(null); this.tip.hide(); }
}
