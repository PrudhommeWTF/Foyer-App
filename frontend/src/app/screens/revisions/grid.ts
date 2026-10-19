import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ExerciseDef, Params } from '../../core/revisions/exercises/contract';
import { MasteryItem, STATUS_LABEL, Status } from '../../core/revisions/revisions';

/**
 * La vue « grille » de la maîtrise : une case par item, dans la forme que
 * l'exercice donne (pour Tables, de 0 à la dernière table sur chaque axe),
 * colorée selon ce que Foyer en sait. « Pas encore vu » en gris clair : on ne
 * sait rien, ce n'est pas « non su ». La couleur n'est jamais seule : chaque
 * case dit son état à qui la lit (lecteur d'écran, info-bulle), et la légende
 * l'écrit en toutes lettres. Une case touchée ouvre son historique.
 */
@Component({
  selector: 'rev-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shape(); as g) {
      <div class="wrap" [style.--n]="g.cols.length + 1">
        <div class="grid" role="grid" [attr.aria-label]="'Grille de maîtrise, ' + def().label">
          <div class="h corner" aria-hidden="true">{{ g.corner }}</div>
          @for (c of g.cols; track $index) { <div class="h" aria-hidden="true">{{ c }}</div> }
          @for (r of g.rows; track $index; let ri = $index) {
            <div class="h" aria-hidden="true">{{ r }}</div>
            @for (c of g.cols; track $index; let ci = $index) {
              @let k = g.keyAt(ri, ci);
              @let it = cell(k);
              <button type="button" class="c" [class]="'c s-' + it.status + ' l' + it.level" [class.hl]="highlight().has(k)"
                      [attr.aria-label]="def().itemLabel(k) + ' : ' + label(it.status)" [title]="def().itemLabel(k) + ' : ' + label(it.status)"
                      (click)="pick.emit(k)"></button>
            }
          }
        </div>
      </div>
      <div class="legend">
        <span><i class="c s-jamais"></i> Pas encore vu</span>
        <span><i class="c s-peu"></i> Pas assez de réponses</span>
        <span><i class="c s-en-cours l1"></i> En cours</span>
        <span><i class="c s-acquise"></i> Acquis</span>
        @if (highlight().size) { <span><i class="c s-jamais hl"></i> Vient de changer</span> }
      </div>
    }
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
  readonly def = input.required<ExerciseDef>();
  readonly params = input.required<Params>();
  readonly items = input<readonly MasteryItem[]>([]);
  readonly highlight = input<ReadonlySet<string>>(new Set());
  readonly pick = output<string>();

  readonly shape = computed(() => this.def().grid?.(this.params()) ?? null);
  private readonly byKey = computed(() => new Map(this.items().map((c) => [c.key, c] as const)));
  cell(k: string): { status: Status; level: number } { return this.byKey().get(k) ?? { status: 'jamais', level: 0 }; }
  label(s: Status): string { return STATUS_LABEL[s]; }
}
