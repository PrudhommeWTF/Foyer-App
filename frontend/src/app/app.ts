import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FoyerStore } from './core/foyer.store';
import { LoginComponent } from './shell/login';
import { ShellComponent } from './shell/shell';
import { OnboardingComponent } from './shell/onboarding';
import { ToastComponent } from './shell/toast';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoginComponent, ShellComponent, OnboardingComponent, ToastComponent],
  template: `
    @if (store.ready()) {
      @if (store.needsSetup()) {
        <app-onboarding />
      } @else if (store.authed()) {
        <app-shell />
      } @else {
        <app-login />
      }
    } @else {
      <div class="boot"><div class="boot-logo">Foyer</div></div>
    }
    <app-toast />
  `,
  styles: [`
    .boot { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg); }
    .boot-logo { font-family: var(--font-display); font-size: 30px; font-weight: 700; color: var(--primary); animation: ffade 1s ease infinite alternate; }
  `],
})
export class App {
  store = inject(FoyerStore);
}
