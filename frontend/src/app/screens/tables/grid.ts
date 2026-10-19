import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MasteryCell, Operation, STATUS_LABEL, Status, pairKey, signOf } from '../../core/tables';

/**
 * La grille de maîtrise : une case par opération, de 0 à la dernière table,
 * colorée selon ce que Foyer en sait. « Pas encore vue » en gris clair : on ne
 * sait rien, ce n'est pas « non sue ». La couleur n'est jamais seule : chaque
 * case dit son état à qui la lit (lecteur d'écran, info-bulle), et la légende
 * l'écrit en toutes lettres. Une case touchée ouvre son historique.
 */
@Component({
  selector: 'tables-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" [style.--n]="max() + 2">
      <div class="grid" role="grid" [attr.aria-label]="'Grille de maîtrise, ' + (op() === 'multiplication' ? 'multiplication' : 'addition')">
        <div class="h corner" aria-hidden="true">{{ sign() }}</div>
        @for (b of axis(); track b) { <div class="h" aria-hidden="true">{{ b }}</div> }
        @for (a of axis(); track a) {
          <div class="h" aria-hidden="true">{{ a }}</div>
          @for (b of axis(); track b) {
            @let c = cell(a, b);
            <button type="button" class="c" [class]="'c s-' + c.status + ' l' + c.level" [class.hl]="highlight().has(key(a, b))"
                    [attr.aria-label]="a + ' ' + sign() + ' ' + b + ' : ' + label(c.status)" [title]="a + ' ' + sign() + ' ' + b + ' : ' + label(c.status)"
                    (click)="pick.emit({ a, b })"></button>
          }
        }
      </div>
    </div>
    <div class="legend">
      <span><i class="c s-jamais"></i> Pas encore vue</span>
      <span><i class="c s-peu"></i> Pas assez de réponses</span>
      <span><i class="c s-en-cours l1"></i> En cours</span>
      <span><i class="c s-acquise"></i> Acquise</span>
      @if (highlight().size) { <span><i class="c s-jamais hl"></i> Vient de changer</span> }
    </div>
  `,
  styles: [`
    .wrap { overflow-x: auto; }
    .grid { display: grid; grid-template-columns: repeat(var(--n), minmax(22px, 1fr)); gap: 3px; min-width: calc(var(--n) * 25px); max-width: 560px; }
    .h { font-size: 11px; font-weight: 800; color: var(--ink3); display: flex; align-items: center; justify-content: center; }
    .corner { color: var(--primary); font-size: 14px; }
    .c { aspect-ratio: 1; border: none; border-radius: 5px; padding: 0; cursor: pointer; display: inline-block; }
    .s-jamais { background: var(--soft2); }
    .s-peu { background: #F6DCC9; }
    .s-en-cours { background: #F0B24B; }
    .s-en-cours.l0 { background: #E8896F; }
    .s-en-cours.l1 { background: #F0B24B; }
    .s-en-cours.l2, .s-en-cours.l3, .s-en-cours.l4, .s-en-cours.l5 { background: #C9D9A4; }
    .s-acquise { background: #6E9B6A; }
    .hl { box-shadow: inset 0 0 0 2px var(--primary); }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 12px; font-size: 12px; font-weight: 700; color: var(--ink2); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .legend i { width: 14px; height: 14px; cursor: default; }
  `],
})
export class GridComponent {
  readonly op = input<Operation>('multiplication');
  readonly max = input(10);
  readonly cells = input<readonly MasteryCell[]>([]);
  readonly highlight = input<ReadonlySet<string>>(new Set());
  readonly pick = output<{ a: number; b: number }>();

  readonly sign = computed(() => signOf(this.op()));
  readonly axis = computed(() => Array.from({ length: this.max() + 1 }, (_, i) => i));
  private readonly byKey = computed(() => new Map(this.cells().map((c) => [pairKey(c.a, c.b), c] as const)));
  cell(a: number, b: number): { status: Status; level: number } { return this.byKey().get(pairKey(a, b)) ?? { status: 'jamais', level: 0 }; }
  key(a: number, b: number): string { return pairKey(a, b); }
  label(s: Status): string { return STATUS_LABEL[s]; }
}
