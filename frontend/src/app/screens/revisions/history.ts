import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ItemHistory } from '../../core/revisions/api';
import { ModalComponent } from '../../shared/modal';

/** L'historique d'un item (pour Tables, 6 × 7 et 7 × 6 ensemble), le plus récent d'abord. */
@Component({
  selector: 'rev-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent],
  template: `
    <f-modal [title]="data().label" [maxWidth]="420" (close)="close.emit()">
      @for (x of data().answers; track $index) {
        <div class="hrow">
          <span class="dot" [class]="'dot ' + x.result"></span>
          <span class="h-q">{{ x.text }} : {{ x.given ?? '…' }}@if (x.result === 'faux') { <span class="h-x"> (c’était {{ x.expected }})</span> }</span>
          <span class="h-r">{{ word(x.result) }}@if (x.given !== null && x.mode !== 'apprendre') {, {{ secs(x.ms) }} s}</span>
          <span class="h-d">{{ when(x.askedAt) }}@if (x.mode === 'apprendre') { · en apprenant (ne compte pas)}</span>
        </div>
      } @empty {
        <p class="hint">Pas encore vu : aucune réponse pour l’instant.</p>
      }
    </f-modal>
  `,
  styles: [`
    .hrow { display: grid; grid-template-columns: 14px 1fr auto; gap: 2px 10px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); font-size: 14px; }
    .hrow:first-child { border-top: none; }
    .h-q { font-weight: 800; color: var(--ink); } .h-x { font-weight: 600; color: var(--ink2); }
    .h-r { font-weight: 700; color: var(--ink2); text-align: right; }
    .h-d { grid-column: 2 / 4; font-size: 12px; font-weight: 600; color: var(--ink3); }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .dot.bon { background: #6E9B6A; } .dot.lent { background: #F0B24B; } .dot.faux, .dot.passe { background: #E56B4E; }
    .hint { font-size: 14px; font-weight: 600; color: var(--ink2); }
  `],
})
export class HistoryComponent {
  readonly data = input.required<ItemHistory>();
  readonly close = output<void>();
  word(r: string): string { return r === 'bon' ? 'bonne' : r === 'lent' ? 'un peu lente' : r === 'passe' ? 'passée' : 'fausse'; }
  secs(ms: number): string { return (ms / 1000).toFixed(1).replace('.', ','); }
  when(iso: string): string {
    return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }
}
