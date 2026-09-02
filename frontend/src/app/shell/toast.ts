import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';

/**
 * Le retour d'une action. Quand elle a fait disparaître ce sur quoi on vient
 * d'appuyer, elle propose de revenir en arrière : c'est ce qui rend un geste
 * d'un seul tap sans danger.
 */
@Component({
  selector: 'app-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.ui().toast) {
      <div class="toast">
        <span>{{ store.ui().toast }}</span>
        @if (store.ui().toastUndo) { <button class="undo" (click)="store.undoLast()">Annuler</button> }
      </div>
    }
  `,
  styles: [`
    .toast { display: flex; align-items: center; gap: 16px; }
    .undo {
      border: none; cursor: pointer; background: rgba(255,255,255,.18); color: #fff;
      font-size: 13px; font-weight: 800; padding: 6px 12px; border-radius: 9px; flex: none;
    }
  `],
})
export class ToastComponent {
  store = inject(FoyerStore);
}
