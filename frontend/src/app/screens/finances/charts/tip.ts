import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/**
 * L'infobulle commune aux graphiques Finances : la valeur en gras, puis son
 * libellé. Elle s'ouvre au survol **et** au focus clavier, et ne passe que du
 * texte (interpolation Angular, donc `textContent`), jamais du HTML.
 */
export interface TipValue { x: number; y: number; value: string; label: string; }

/** L'état d'une infobulle, posé par le graphique qui la porte (positions relatives à son hôte). */
export class ChartTip {
  readonly state = signal<TipValue | null>(null);

  /** Au survol : la position du pointeur dans l'hôte. */
  at(ev: PointerEvent, host: HTMLElement, value: string, label: string): void {
    const r = host.getBoundingClientRect();
    this.state.set({ x: ev.clientX - r.left, y: ev.clientY - r.top, value, label });
  }

  /** Au focus clavier : le coin haut droit de la marque. */
  on(target: EventTarget | null, host: HTMLElement, value: string, label: string): void {
    const el = target as Element | null;
    if (!el?.getBoundingClientRect) return;
    const r = host.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    this.state.set({ x: m.left + m.width / 2 - r.left, y: m.top - r.top, value, label });
  }

  hide(): void { this.state.set(null); }
}

@Component({
  selector: 'fin-tip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tip(); as t) {
      <div class="tip" role="tooltip" [style.left.px]="t.x" [style.top.px]="t.y"><b>{{ t.value }}</b>{{ t.label }}</div>
    }
  `,
  styles: [`
    :host { position: absolute; inset: 0; pointer-events: none; z-index: 5; }
    .tip { position: absolute; transform: translate(-50%, calc(-100% - 10px)); max-width: 240px; width: max-content;
      background: var(--ink); color: var(--surface); border-radius: 10px; padding: 7px 10px;
      font-size: 12px; font-weight: 700; line-height: 1.35; box-shadow: var(--sh-float); }
    .tip b { display: block; font-size: 13.5px; font-weight: 800; }
  `],
})
export class FinTip {
  readonly tip = input<TipValue | null>(null);
}

/** Euros entiers, signe « − » typographique : « 1 240 € », « −380 € ». */
export function eur(cents: number): string {
  return (cents < 0 ? '−' : '') + Math.round(Math.abs(cents) / 100).toLocaleString('fr-FR') + ' €';
}
/** Un montant signé : « +1 120 € », « −380 € ». */
export const signed = (cents: number): string => (cents > 0 ? '+' : '') + eur(cents);

/** Libellé d'axe compact : « 0 », « 500 », « 1,5 k ». */
export function axisLabel(cents: number): string {
  const v = cents / 100;
  if (v === 0) return '0';
  return Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k' : v.toLocaleString('fr-FR');
}

/** Un pas d'axe rond (1, 2, 2,5 ou 5 × 10ⁿ) qui découpe `max` en quatre graduations environ. */
export function niceStep(max: number): number {
  const raw = Math.max(1, max) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw)!;
}
