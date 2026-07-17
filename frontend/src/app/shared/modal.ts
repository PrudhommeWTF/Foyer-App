import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { IconComponent } from '../core/icon';

/** Overlay modal. Click outside closes; card click is stopped. Emits (close). */
@Component({
  selector: 'f-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="modal-card fscroll" [style.max-width.px]="maxWidth" (click)="$event.stopPropagation()">
        @if (title) {
          <div class="head">
            <div class="modal-title">{{ title }}</div>
            <button class="icon-btn sm" (click)="close.emit()"><f-icon name="x" [size]="18" /></button>
          </div>
        }
        <ng-content />
      </div>
    </div>
  `,
  styles: [`
    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; gap: 12px; }
  `],
})
export class ModalComponent {
  @Input() title = '';
  @Input() maxWidth = 480;
  @Output() close = new EventEmitter<void>();
}
