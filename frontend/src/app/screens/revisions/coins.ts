import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Les pièces et billets d'un énoncé « monnaie », dessinés sans image : un
 * billet est un rectangle de sa couleur (5 € gris, 10 € rouge, 20 € bleu,
 * 50 € orange), une pièce un disque à sa taille (les centimes dorés, 1 € et
 * 2 € bicolores). Leur valeur est écrite dessus : on apprend à compter, pas à
 * reconnaître une gravure.
 */
@Component({
  selector: 'rev-coins',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="money" aria-hidden="true">
      @for (c of items(); track $index) {
        @if (c.bill) { <span class="bill" [class]="'bill b' + c.v">{{ c.label }}</span> }
        @else { <span class="coin" [class]="'coin c' + c.v"><b>{{ c.label }}</b></span> }
      }
    </div>
  `,
  styles: [`
    :host { display: block; max-width: 520px; }
    .money { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 12px; }
    .bill { display: inline-flex; align-items: center; justify-content: center; width: 112px; height: 60px; border-radius: 8px; font-size: 24px; font-weight: 800; color: #2B2420; border: 3px solid rgba(0,0,0,.18); box-shadow: var(--sh-float); }
    .b500 { background: #B9C1B5; } .b1000 { background: #E7948A; } .b2000 { background: #8FAEDB; } .b5000 { background: #F1B36E; }
    .coin { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; font-weight: 800; color: #2B2420; box-shadow: var(--sh-float); }
    .coin b { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; width: 100%; height: 100%; }
    .c10 { width: 46px; height: 46px; font-size: 13px; background: #E2B95A; border: 3px solid #B88F2F; }
    .c20 { width: 52px; height: 52px; font-size: 14px; background: #E2B95A; border: 3px solid #B88F2F; }
    .c50 { width: 58px; height: 58px; font-size: 15px; background: #E2B95A; border: 3px solid #B88F2F; }
    .c100 { width: 62px; height: 62px; font-size: 16px; background: #E2B95A; padding: 9px; }
    .c100 b { background: #D5D8DC; }
    .c200 { width: 68px; height: 68px; font-size: 17px; background: #D5D8DC; padding: 10px; }
    .c200 b { background: #E2B95A; }
  `],
})
export class CoinsComponent {
  /** En centimes, dans l'ordre de l'écran. */
  readonly coins = input.required<number[]>();
  readonly items = computed(() => this.coins().map((v) => ({ v, bill: v >= 500, label: v >= 100 ? `${v / 100} €` : `${v} c` })));
}
