import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { ChartTip, FinTip, axisLabel, eur, niceStep } from './tip';

const L = 40, R = 12, T = 10, B = 24;

/**
 * Le rythme : la dépense cumulée jour après jour face à la droite du budget
 * (ce qu'on aurait dépensé à rythme régulier). Un seul axe, en euros. Le
 * réticule s'accroche au jour le plus proche, au pointeur comme aux flèches.
 */
@Component({
  selector: 'fin-pace-chart',
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
      @for (t of g.xTicks; track t.d) {
        <text class="ax" [attr.x]="t.x" [attr.y]="height() - 6" text-anchor="middle">{{ t.label }}</text>
      }
      @if (budget() > 0) {
        <line class="pace" [attr.x1]="g.x0" [attr.y1]="g.yZero" [attr.x2]="g.xEnd" [attr.y2]="g.yBudget" />
      }
      <polygon class="area" [attr.points]="g.area" />
      <polyline class="spent" [attr.points]="g.line" />
      <circle class="dot" [attr.cx]="g.lastX" [attr.cy]="g.lastY" r="5" />
      @if (!compact()) {
        <text class="val" [attr.x]="g.lastX + 9" [attr.y]="g.lastY - 6">{{ eur(g.last) }}</text>
        @if (budget() > 0) { <text class="ax" [attr.x]="g.lastX + 9" [attr.y]="g.lastY + 9">prévu {{ eur(g.planned) }}</text> }
      }
      @if (cross() !== null) {
        <line class="cross" [attr.x1]="g.x(cross()!)" [attr.x2]="g.x(cross()!)" [attr.y1]="T" [attr.y2]="height() - B" />
      }
      <rect class="hit" [attr.x]="L" [attr.y]="T" [attr.width]="width() - L - R" [attr.height]="height() - T - B"
            tabindex="0" [attr.aria-label]="'Parcourir les jours aux flèches'"
            (pointermove)="move($event)" (pointerleave)="leave()" (focus)="focus($event)" (blur)="leave()" (keydown)="key($event)" />
    </svg>
    <fin-tip [tip]="tip.state()" />
  `,
  styles: [`
    :host { display: block; position: relative; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .grid { stroke: var(--line); stroke-width: 1; }
    .ax { font-size: 11.5px; font-weight: 700; fill: var(--ink3); }
    .val { font-size: 12.5px; font-weight: 800; fill: var(--ink); }
    .pace { stroke: var(--chart-pace); stroke-width: 2; }
    .area { fill: var(--chart-seq); opacity: .12; }
    .spent { fill: none; stroke: var(--chart-seq); stroke-width: 2.5; stroke-linejoin: round; }
    .dot { fill: var(--chart-seq); stroke: var(--surface); stroke-width: 2; }
    .cross { stroke: var(--ink3); stroke-width: 1; }
    .hit { fill: transparent; outline: none; cursor: crosshair; }
    .hit:focus-visible { stroke: var(--ink3); stroke-dasharray: 3 3; }
  `],
})
export class FinPaceChart {
  /** Dépense cumulée, en centimes, du jour 0 au jour de référence. */
  readonly series = input.required<number[]>();
  readonly days = input.required<number>();
  /** Budget du mois des enveloppes, en centimes. */
  readonly budget = input(0);
  /** « oct. » : pour l'infobulle. */
  readonly monthShort = input('');
  /** Le mois est en cours : le dernier jour tracé s'appelle « auj. ». */
  readonly current = input(false);
  readonly compact = input(false);
  readonly width = input(520);
  readonly height = input(190);

  private host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  readonly tip = new ChartTip();
  readonly cross = signal<number | null>(null);
  readonly L = L; readonly R = R; readonly T = T; readonly B = B;
  readonly eur = eur;

  readonly geo = computed(() => {
    const s = this.series(), days = this.days(), W = this.width(), H = this.height();
    const last = s[s.length - 1] ?? 0, day = s.length - 1;
    const step = niceStep(Math.max(this.budget(), last, 100));
    const max = Math.ceil(Math.max(this.budget(), last, 1) / step) * step;
    const pw = W - L - R, ph = H - T - B;
    const x = (d: number): number => L + (d / days) * pw;
    const y = (v: number): number => T + ph - (v / max) * ph;
    const yTicks = [];
    for (let v = 0; v <= max + 1; v += step) yTicks.push({ v, y: y(v), label: axisLabel(v) });
    const marks = [1, 10, 20, days].filter((d) => Math.abs(d - day) > 2 || !this.current());
    const xTicks = marks.map((d) => ({ d, x: x(d), label: String(d) }));
    if (this.current()) xTicks.push({ d: day, x: x(day), label: 'auj.' });
    const pts = s.map((v, d) => `${x(d)},${y(v)}`).join(' ');
    return {
      x, y, yTicks, xTicks, x0: x(0), xEnd: x(days), yZero: y(0), yBudget: y(this.budget()),
      line: pts, area: `${x(0)},${y(0)} ${pts} ${x(day)},${y(0)}`,
      last, lastX: x(day), lastY: y(last), planned: Math.round(this.budget() * day / days),
    };
  });

  readonly aria = computed(() => {
    const g = this.geo();
    return `Dépensé cumulé : ${eur(g.last)}` + (this.budget() > 0 ? `, rythme prévu à ce jour ${eur(g.planned)} sur ${eur(this.budget())}` : '');
  });

  private show(d: number, place: (value: string, label: string) => void): void {
    const s = this.series();
    this.cross.set(d);
    const pace = `rythme du budget ${eur(Math.round(this.budget() * d / this.days()))}`;
    place(d < s.length ? `${eur(s[d])} dépensés` : 'pas encore', `le ${Math.max(1, d)} ${this.monthShort()}${this.budget() > 0 ? ' · ' + pace : ''}`);
  }

  move(ev: PointerEvent): void {
    const svg = (ev.target as SVGElement).ownerSVGElement!;
    const r = svg.getBoundingClientRect();
    const pw = this.width() - L - R;
    const d = Math.max(0, Math.min(this.days(), Math.round(((ev.clientX - r.left) * this.width() / r.width - L) / pw * this.days())));
    this.show(d, (v, l) => this.tip.at(ev, this.host, v, l));
  }

  focus(ev: FocusEvent): void {
    const d = this.series().length - 1;
    this.show(d, (v, l) => this.placeAt(d, ev.target, v, l));
  }

  key(ev: KeyboardEvent): void {
    const cur = this.cross() ?? this.series().length - 1;
    const d = ev.key === 'ArrowLeft' ? cur - 1 : ev.key === 'ArrowRight' ? cur + 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? this.days() : null;
    if (d === null) return;
    ev.preventDefault();
    const next = Math.max(0, Math.min(this.days(), d));
    this.show(next, (v, l) => this.placeAt(next, ev.target, v, l));
  }

  /** Infobulle au-dessus du jour `d`, pour le clavier. */
  private placeAt(d: number, target: EventTarget | null, value: string, label: string): void {
    const svg = (target as SVGElement).ownerSVGElement!;
    const r = svg.getBoundingClientRect(), h = this.host.getBoundingClientRect();
    const k = r.width / this.width();
    const s = this.series();
    const v = s[Math.min(d, s.length - 1)] ?? 0;
    const g = this.geo();
    this.tip.state.set({ x: r.left - h.left + g.x(d) * k, y: r.top - h.top + (d < s.length ? g.y(v) : T) * k, value, label });
  }

  leave(): void { this.cross.set(null); this.tip.hide(); }
}
