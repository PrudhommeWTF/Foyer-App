import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { MOBILE_TABS, NAV_GROUPS } from './nav';

@Component({
  selector: 'app-tabbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <nav class="tabbar">
      @for (t of tabs; track t.id) {
        <button class="tab" [class.active]="store.ui().screen === t.id" (click)="store.go(t.id)">
          <f-icon [name]="t.icon" [size]="22" [color]="store.ui().screen === t.id ? 'var(--primary)' : 'var(--ink3)'" />
          <span>{{ t.label }}</span>
        </button>
      }
      <button class="tab" [class.active]="moreActive()" (click)="store.patch({ moreOpen: true })">
        <f-icon name="taches" [size]="22" [color]="moreActive() ? 'var(--primary)' : 'var(--ink3)'" />
        <span>Plus</span>
      </button>
    </nav>

    @if (store.ui().moreOpen) {
      <div class="sheet-backdrop" (click)="store.patch({ moreOpen: false })"></div>
      <div class="sheet">
        <div class="grab"></div>
        <div class="sheet-grid">
          @for (it of allItems; track it.id) {
            <button class="sheet-item" [class.active]="store.ui().screen === it.id" (click)="pick(it.id)">
              <span class="si-ic"><f-icon [name]="it.icon" [size]="22" [color]="store.ui().screen === it.id ? 'var(--primary)' : 'var(--ink2)'" /></span>
              <span>{{ it.label }}</span>
            </button>
          }
          <button class="sheet-item" (click)="pick('settings')">
            <span class="si-ic"><f-icon name="gear" [size]="22" color="var(--ink2)" /></span>
            <span>Paramètres</span>
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .tabbar { position: fixed; left: 0; right: 0; bottom: 0; height: 70px; display: flex; background: var(--surface); border-top: 1px solid var(--line); box-shadow: var(--sh-tabbar); z-index: 40; }
    .tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: none; background: none; cursor: pointer; font-size: 10.5px; font-weight: 800; color: var(--ink3); }
    .tab.active { color: var(--primary); }
    .sheet-backdrop { position: fixed; inset: 0; z-index: 50; background: rgba(30,24,20,.4); }
    .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 51; background: var(--surface); border-radius: 24px 24px 0 0; padding: 12px 18px 26px; animation: fpop .2s ease; }
    .grab { width: 42px; height: 4px; border-radius: 4px; background: var(--line2); margin: 0 auto 14px; }
    .sheet-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .sheet-item { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 8px; border-radius: 16px; border: none; background: var(--soft); cursor: pointer; font-size: 12px; font-weight: 800; color: var(--ink); text-align: center; }
    .sheet-item.active { background: #FCE9E3; color: var(--primary); }
    .si-ic { display: flex; }
  `],
})
export class TabbarComponent {
  store = inject(FoyerStore);
  tabs = MOBILE_TABS;
  allItems = NAV_GROUPS.flatMap((g) => g.items);
  moreActive(): boolean { return !this.tabs.some((t) => t.id === this.store.ui().screen); }
  pick(id: string): void { this.store.go(id); this.store.patch({ moreOpen: false }); }
}
