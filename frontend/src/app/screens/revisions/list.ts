import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ExerciseContext, ExerciseDef, Params } from '../../core/revisions/exercises/contract';
import { MasteryItem, STATUS_LABEL, Status } from '../../core/revisions/revisions';

/**
 * La vue « liste » de la maîtrise : un item par ligne (pour la dictée, un
 * mot), dans l'ordre de l'univers des paramètres, avec son état écrit en
 * toutes lettres et sa pastille. « Pas encore vu » se dit, il ne disparaît
 * pas. Une ligne touchée ouvre son historique.
 */
@Component({
  selector: 'rev-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="list" [attr.aria-label]="'Maîtrise, ' + def().label">
      @for (r of rows(); track r.key) {
        <li>
          <button type="button" class="row" [class.hl]="highlight().has(r.key)" (click)="pick.emit(r.key)">
            <span class="dot" [class]="'dot s-' + r.status + ' l' + r.level" aria-hidden="true"></span>
            <span class="w">{{ r.label }}</span>
            <span class="st">{{ label(r.status) }}</span>
          </button>
        </li>
      } @empty { <li class="empty">Rien à montrer : la liste est vide.</li> }
    </ul>
  `,
  styles: [`
    .list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px 14px; }
    .row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 6px; border: none; border-radius: 10px; background: transparent; font-family: inherit; text-align: left; cursor: pointer; min-height: 40px; }
    .row.hl { box-shadow: inset 0 0 0 2px var(--primary); }
    .w { flex: 1; font-size: 15px; font-weight: 800; color: var(--ink); }
    .st { font-size: 12px; font-weight: 700; color: var(--ink2); }
    .dot { width: 14px; height: 14px; flex: none; border-radius: 4px; }
    .s-jamais { background: var(--soft2); }
    .s-peu { background: #F6DCC9; }
    .s-en-cours { background: #F0B24B; }
    .s-en-cours.l0 { background: #E8896F; }
    .s-en-cours.l2, .s-en-cours.l3, .s-en-cours.l4, .s-en-cours.l5 { background: #C9D9A4; }
    .s-acquise { background: #6E9B6A; }
    .empty { font-size: 13px; font-weight: 600; color: var(--ink2); }
  `],
})
export class ListComponent {
  readonly def = input.required<ExerciseDef>();
  readonly params = input.required<Params>();
  readonly ctx = input.required<ExerciseContext>();
  readonly items = input<readonly MasteryItem[]>([]);
  readonly highlight = input<ReadonlySet<string>>(new Set());
  readonly pick = output<string>();

  readonly rows = computed(() => {
    const by = new Map(this.items().map((c) => [c.key, c] as const));
    return this.def().universe(this.params(), this.ctx()).map((key) => {
      const m = by.get(key);
      return { key, label: this.def().itemLabel(key), status: (m?.status ?? 'jamais') as Status, level: m?.level ?? 0 };
    });
  });
  label(s: Status): string { return STATUS_LABEL[s]; }
}
