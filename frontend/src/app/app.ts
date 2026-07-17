import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FoyerStore } from './core/foyer.store';
import { LoginComponent } from './shell/login';
import { ShellComponent } from './shell/shell';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoginComponent, ShellComponent],
  template: `
    @if (store.ready()) {
      @if (store.authed()) {
        <app-shell />
      } @else {
        <app-login />
      }
    } @else {
      <div class="boot"><div class="boot-logo">Foyer</div></div>
    }
  `,
  styles: [`
    .boot { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg); }
    .boot-logo { font-family: var(--font-display); font-size: 30px; font-weight: 700; color: var(--primary); animation: ffade 1s ease infinite alternate; }
  `],
})
export class App {
  store = inject(FoyerStore);
}
