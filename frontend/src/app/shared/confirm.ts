import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ModalComponent } from './modal';
import { IconComponent } from '../core/icon';

/**
 * Confirmation modal for destructive actions. Centered card with a round
 * icon, a title, the projected body text, and Annuler / confirm buttons.
 * Wraps f-modal: click outside or Annuler emits (cancel); the action button
 * emits (confirm).
 */
@Component({
  selector: 'f-confirm',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, IconComponent],
  template: `
    <f-modal [maxWidth]="maxWidth()" (close)="cancel.emit()">
      <div class="confirm">
        <div class="confirm-ic"><f-icon [name]="icon()" [size]="26" color="var(--primary)" [width]="2" /></div>
        <div class="confirm-title f-display">{{ title() }}</div>
        <div class="confirm-txt"><ng-content /></div>
        <div class="confirm-acts">
          <button class="btn btn-soft grow" (click)="cancel.emit()">{{ cancelLabel() }}</button>
          <button class="btn btn-danger grow" [disabled]="disabled()" (click)="confirm.emit()">{{ confirmLabel() }}</button>
        </div>
      </div>
    </f-modal>
  `,
  styles: [`
    .confirm { text-align: center; }
    .confirm-ic { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .confirm-title { font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-txt { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 22px; line-height: 1.5; }
    .confirm-acts { display: flex; gap: 12px; }
    .confirm-acts .grow { flex: 1; }
  `],
})
export class ConfirmComponent {
  readonly title = input('');
  readonly icon = input('trash');
  readonly maxWidth = input(400);
  readonly confirmLabel = input('Supprimer');
  readonly cancelLabel = input('Annuler');
  readonly disabled = input(false);
  readonly confirm = output<void>();
  readonly cancel = output<void>();
}
