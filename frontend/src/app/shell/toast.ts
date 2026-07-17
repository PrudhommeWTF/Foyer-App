import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';

@Component({
  selector: 'app-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (store.ui().toast) { <div class="toast">{{ store.ui().toast }}</div> }`,
})
export class ToastComponent {
  store = inject(FoyerStore);
}
