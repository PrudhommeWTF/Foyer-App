import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, output } from '@angular/core';
import { Kid, LOIS, SERMENT, currentQuest, longDay } from '../../core/epopee/epopee';
import { IconComponent } from '../../core/icon';

/**
 * Le parchemin du serment : ce que l'enfant et ses parents se sont promis, à
 * relire et à imprimer pour la porte de la chambre. Tant qu'il est ouvert, une
 * impression ne sort que lui (classe `print-parchment` sur body, styles.scss).
 */
@Component({
  selector: 'epopee-parchment',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let k = kid();
    <div class="veil" role="dialog" aria-modal="true" [attr.aria-label]="'Le serment de ' + k.name">
      <div class="parchment">
        <div class="crest"><f-icon name="bouclier" [size]="34" color="#7D5400" [width]="1.8" /></div>
        <h2>Le serment de {{ k.name }}</h2>
        @if (k.swornAt) { <p class="when">{{ when(k) }}</p> }

        <h3>Les trois lois de notre foyer</h3>
        <ol class="lois">@for (l of lois; track l.title) { <li><b>{{ l.title }}.</b> {{ l.text }}</li> }</ol>

        <div class="sides">
          <div><h3>{{ k.name }} promet</h3><ul>@for (p of serment.child; track p) { <li>{{ p }}</li> }</ul></div>
          <div><h3>Ses parents promettent</h3><ul>@for (p of serment.parent; track p) { <li>{{ p }}</li> }</ul></div>
        </div>

        @if (quest(); as q) { <p class="aim">Premier trésor visé : <b>{{ q.title }}</b> ({{ q.cost }} écus)</p> }

        <div class="signs"><div><span></span>{{ k.name }}</div><div><span></span>{{ k.swornBy || 'Un parent' }}</div></div>
      </div>
      <div class="bar no-print">
        <button class="btn btn-soft" (click)="closed.emit()">Fermer</button>
        <button class="btn btn-primary" (click)="print()">Imprimer le parchemin</button>
      </div>
    </div>
  `,
  styles: [`
    .veil { position: fixed; inset: 0; z-index: 70; background: var(--bg); overflow-y: auto; display: flex; flex-direction: column; align-items: center; gap: 16px;
            padding: max(18px, env(safe-area-inset-top)) 16px max(18px, env(safe-area-inset-bottom)); }
    .parchment { width: 100%; max-width: 640px; padding: 34px 30px; border-radius: 22px; background: #FFFDF8; border: 2px solid #EFE3D2; box-shadow: var(--sh-card); color: #3A302A; }
    .crest { display: flex; justify-content: center; }
    h2 { margin: 8px 0 4px; text-align: center; font-family: var(--font-display); font-size: 30px; font-weight: 800; }
    .when { margin: 0 0 18px; text-align: center; font-size: 14px; font-weight: 700; color: #8A7E74; }
    h3 { margin: 20px 0 8px; font-family: var(--font-display); font-size: 16px; font-weight: 800; color: #7D5400; }
    .lois, ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; font-size: 14.5px; font-weight: 600; line-height: 1.5; }
    .sides { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .aim { margin: 22px 0 0; padding: 12px 14px; border-radius: 14px; background: #FDF0DA; font-size: 15px; font-weight: 600; }
    .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 44px; text-align: center; font-family: var(--font-script); font-size: 22px; }
    .signs span { display: block; border-bottom: 2px solid #3A302A; margin-bottom: 6px; height: 34px; }
    .bar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
    .bar .btn { min-height: 48px; }
    @media (max-width: 520px) { .sides { grid-template-columns: 1fr; gap: 0; } .parchment { padding: 26px 20px; } }
  `],
})
export class Parchment {
  readonly kid = input.required<Kid>();
  readonly closed = output<void>();
  readonly lois = LOIS;
  readonly serment = SERMENT;

  constructor() {
    document.body.classList.add('print-parchment');
    inject(DestroyRef).onDestroy(() => document.body.classList.remove('print-parchment'));
  }

  quest() { return currentQuest(this.kid().quetes || []); }
  when(k: Kid): string { return `Scellé le ${longDay(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(k.swornAt!)))}${k.swornBy ? ', avec ' + k.swornBy : ''}`; }
  print(): void { window.print(); }
}
