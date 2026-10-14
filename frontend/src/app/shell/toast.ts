import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';

/**
 * Le retour d'une action. Quand elle a fait disparaître ce sur quoi on vient
 * d'appuyer, elle propose de revenir en arrière : c'est ce qui rend un geste
 * d'un seul tap sans danger. Le même bouton porte parfois une suite plutôt
 * qu'un retour (« Clore » la tâche quand la liste de courses est finie).
 */
@Component({
  selector: 'app-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.ui().toast) {
      <!-- Une fiche ouverte sur téléphone tient ses boutons en bas, à portée du pouce :
           le toast passe alors en haut plutôt que de les masquer. -->
      <div class="toast" [class.over-sheet]="!!store.ui().item">
        <span>{{ store.ui().toast }}</span>
        @if (store.ui().toastUndo) { <button class="undo" (click)="store.undoLast()">{{ store.ui().toastLabel }}</button> }
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
