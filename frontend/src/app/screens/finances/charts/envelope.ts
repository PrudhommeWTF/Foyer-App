import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { Envelope } from '../../../core/finances-plan';
import { CAT_ICONS, tint } from '../../../core/constants';
import { IconComponent } from '../../../core/icon';
import { ChartTip, FinTip, eur } from './tip';

/**
 * Une enveloppe : ce qui reste (ou ce qui est de trop), la jauge de la dépense
 * et le trait du rythme (où l'on devrait en être aujourd'hui), puis ce que le
 * reste représente par jour. Le dépassement se dit en mots et d'une icône, pas
 * seulement en couleur.
 */
@Component({
  selector: 'fin-envelope',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FinTip],
  template: `
    @let e = env();
    <div class="ev" [class.over]="e.left < 0" tabindex="0" role="button" [attr.aria-label]="aria() + ', ouvrir la fiche'"
         (pointermove)="tip.at($event, host, tipValue(), tipLabel())" (pointerleave)="tip.hide()"
         (focus)="tip.on($event.target, host, tipValue(), tipLabel())" (blur)="tip.hide()">
      <div class="top">
        <span class="ic" [style.background]="tint(e.color)"><f-icon [path]="CAT_ICONS[e.icon] || CAT_ICONS['facture']" [size]="15" [color]="e.color" [width]="2.2" /></span>
        <span class="n">{{ e.name }}</span>
      </div>
      <div class="left">
        @if (e.left < 0) {
          <span class="crit"><span aria-hidden="true">⚠</span> {{ eur(-e.left) }}</span> <small>de trop</small>
        } @else {
          {{ eur(e.left) }} <small>restants</small>
        }
      </div>
      <div class="meter"><span [style.width.%]="fill()"></span><i [style.left]="'calc(' + pace() * 100 + '% - 1px)'"></i></div>
      <div class="per">
        @if (e.left < 0) { Budget de {{ eur(e.budget) }} dépassé · transférer depuis une autre ? }
        @else if (current()) { {{ eur(e.perDay) }} / jour · sur {{ eur(e.budget) }} }
        @else { {{ eur(e.spent) }} sur {{ eur(e.budget) }} }
      </div>
    </div>
    <fin-tip [tip]="tip.state()" />
  `,
  styles: [`
    :host { display: block; position: relative; }
    .ev { border: 1.5px solid var(--line); border-radius: 16px; padding: 13px 14px; background: var(--surface); outline: none; height: 100%; box-sizing: border-box; cursor: pointer; }
    .ev:hover { border-color: var(--line2); }
    .ev:focus-visible { border-color: var(--ink3); }
    .top { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .ic { width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; flex: none; }
    .n { font-size: 14px; font-weight: 800; color: var(--ink); line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .left { font-family: var(--font-display); font-size: 21px; font-weight: 700; color: var(--ink); margin: 10px 0 8px; }
    .left small { font-family: var(--font-body); font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .crit { color: var(--status-crit); }
    .meter { position: relative; height: 7px; border-radius: 99px; background: var(--soft2); }
    .meter span { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 99px; background: var(--chart-pace); }
    .over .meter span { background: var(--status-crit); }
    .meter i { position: absolute; top: -3px; bottom: -3px; width: 2px; border-radius: 1px; background: var(--ink); }
    .per { margin-top: 8px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
  `],
})
export class FinEnvelope {
  readonly env = input.required<Envelope>();
  /** Part du mois écoulée (0 à 1) : le trait du rythme. */
  readonly pace = input(0);
  /** Mois en cours : le reste se dit par jour. */
  readonly current = input(true);

  readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  readonly tip = new ChartTip();
  readonly CAT_ICONS = CAT_ICONS; readonly tint = tint; readonly eur = eur;

  readonly fill = computed(() => Math.min(100, (this.env().spent / this.env().budget) * 100));
  readonly tipValue = computed(() => `${eur(this.env().spent)} dépensés`);
  readonly tipLabel = computed(() => `${this.env().name} · budget ${eur(this.env().budget)} · le trait marque le rythme du jour`);
  readonly aria = computed(() => {
    const e = this.env();
    return `${e.name} : ${e.left < 0 ? eur(-e.left) + ' de trop' : eur(e.left) + ' restants'}, ${eur(e.spent)} dépensés sur ${eur(e.budget)}`;
  });
}
