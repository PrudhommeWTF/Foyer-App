import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { ChartTip, FinTip } from './tip';
import { fmtEuros } from '../../../core/finances.store';

/**
 * La fourchette annoncée d'un contrat (bande) et son dernier prélèvement
 * (trait). Hors de la fourchette, le trait passe en rouge ; le montant écrit à
 * côté porte ⚠, la couleur n'est jamais seule à le dire.
 */
@Component({
  selector: 'fin-range',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FinTip],
  template: `
    @let g = geo();
    <div class="track" tabindex="0" role="img" [attr.aria-label]="tipValue() + ', ' + tipLabel()"
         (pointermove)="tip.at($event, host, tipValue(), tipLabel())" (pointerleave)="tip.hide()"
         (focus)="tip.on($event.target, host, tipValue(), tipLabel())" (blur)="tip.hide()">
      @if (g.band; as b) { <span class="band" [style.left.%]="b.left" [style.width.%]="b.width"></span> }
      @if (g.mark !== null) { <i class="mark" [class.off]="off()" [style.left]="'calc(' + g.mark + '% - 1.5px)'"></i> }
    </div>
    <fin-tip [tip]="tip.state()" />
  `,
  styles: [`
    :host { display: block; position: relative; }
    .track { position: relative; height: 10px; border-radius: 99px; background: var(--soft2); outline: none; margin: 6px 0; }
    .track:focus-visible { box-shadow: 0 0 0 2px var(--ink3); }
    .band { position: absolute; top: 0; bottom: 0; border-radius: 99px; background: var(--chart-pos); opacity: .35; min-width: 6px; }
    .mark { position: absolute; top: -4px; bottom: -4px; width: 3px; border-radius: 2px; background: var(--ink); }
    .mark.off { background: var(--status-crit); }
  `],
})
export class FinRange {
  /** Fourchette annoncée, en centimes ; l'une ou l'autre peut manquer. */
  readonly min = input<number | null>(null);
  readonly max = input<number | null>(null);
  /** Dernier prélèvement, en centimes, ou null s'il n'y en a pas encore. */
  readonly last = input<number | null>(null);
  readonly off = input(false);

  readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  readonly tip = new ChartTip();

  readonly geo = computed(() => {
    const lo = this.min() ?? this.max(), hi = this.max() ?? this.min(), last = this.last();
    const scale = Math.max(1, hi ?? 0, last ?? 0) * 1.25;
    const pct = (v: number): number => (v / scale) * 100;
    return {
      band: lo !== null && hi !== null ? { left: pct(lo), width: Math.max(pct(hi) - pct(lo), 1.5) } : null,
      mark: last !== null ? pct(last) : null,
    };
  });

  readonly tipValue = computed(() => (this.last() !== null ? `${fmtEuros(this.last()!)} € prélevés` : 'Aucun prélèvement rattaché'));
  readonly tipLabel = computed(() => {
    const lo = this.min(), hi = this.max();
    const range = lo !== null && hi !== null && lo !== hi ? `annoncé de ${fmtEuros(lo)} à ${fmtEuros(hi)} €`
      : lo ?? hi ? `annoncé ${fmtEuros((lo ?? hi)!)} €` : 'aucun montant annoncé';
    return range + (this.off() ? ' · hors de la fourchette' : '');
  });
}
