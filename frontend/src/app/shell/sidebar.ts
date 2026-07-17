import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { NAV_GROUPS } from './nav';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent],
  template: `
    <aside class="sidebar">
      <div class="brand">
        <div class="badge"><f-icon name="home" [size]="24" color="#fff" [width]="2.2" /></div>
        <div>
          <div class="name f-display">Foyer</div>
          <div class="tag f-script">la maison, ensemble</div>
        </div>
      </div>

      <nav class="nav fscroll">
        @for (g of groups; track g.title) {
          @if (g.title) { <div class="overline group-title">{{ g.title }}</div> }
          @for (it of g.items; track it.id) {
            <button class="nav-item" [class.active]="store.ui().screen === it.id" (click)="store.go(it.id)">
              <span class="accent"></span>
              <f-icon [name]="it.icon" [size]="21" [color]="store.ui().screen === it.id ? 'var(--primary)' : 'var(--ink2)'" />
              <span>{{ it.label }}</span>
            </button>
          }
        }
      </nav>

      <div class="foot">
        <button class="profile" (click)="store.openProfile()">
          <f-avatar [ini]="d().profile.name.charAt(0)" [color]="d().profile.color" [size]="38" />
          <div class="pinfo">
            <div class="pname">{{ d().profile.name }}</div>
            <div class="prole">{{ d().profile.role }} · admin</div>
          </div>
        </button>
        <button class="icon-btn" (click)="store.toggleDark()" title="Changer de thème">
          @if (d().settings.dark) { <f-icon name="sun" [size]="19" color="#F0B24B" /> }
          @else { <f-icon name="moon" [size]="19" color="#8A7E74" /> }
        </button>
        <button class="icon-btn" [class.on]="store.ui().screen === 'settings'" (click)="store.go('settings')" title="Paramètres">
          <f-icon name="gear" [size]="19" [color]="store.ui().screen === 'settings' ? 'var(--primary)' : 'var(--ink2)'" />
        </button>
      </div>
    </aside>
  `,
  styles: [`
    .sidebar { width: 270px; flex: none; background: var(--surface); border-right: 1px solid var(--line); display: flex; flex-direction: column; padding: 26px 18px; height: 100vh; }
    .brand { display: flex; align-items: center; gap: 12px; padding: 0 8px 4px; }
    .badge { width: 42px; height: 42px; border-radius: 14px; background: linear-gradient(135deg, #E56B4E, #D9553A); display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 16px -6px rgba(229,107,78,.6); }
    .name { font-size: 22px; font-weight: 700; color: var(--ink); line-height: 1; }
    .tag { font-size: 16px; color: var(--primary); line-height: 1; }
    .nav { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; margin-top: 16px; }
    .group-title { padding: 16px 14px 8px; }
    .nav-item { position: relative; display: flex; align-items: center; gap: 13px; padding: 11px 14px; border-radius: 13px; cursor: pointer; border: none; background: transparent; font-size: 14.5px; font-weight: 800; color: var(--ink2); text-align: left; width: 100%; }
    .nav-item .accent { position: absolute; left: -18px; top: 8px; bottom: 8px; width: 4px; border-radius: 4px; background: transparent; }
    .nav-item.active { background: #FCE9E3; color: var(--primary); }
    :host-context(:root.dark) .nav-item.active { background: rgba(229,107,78,.18); }
    .nav-item.active .accent { background: var(--primary); }
    .foot { display: flex; align-items: center; gap: 11px; padding: 12px 6px 0; border-top: 1px solid var(--line); margin-top: 8px; }
    .profile { display: flex; align-items: center; gap: 11px; flex: 1; cursor: pointer; border: none; background: transparent; border-radius: 12px; padding: 4px; min-width: 0; }
    .profile:hover { background: var(--soft2); }
    .pinfo { min-width: 0; text-align: left; }
    .pname { font-size: 13.5px; font-weight: 800; color: var(--ink); line-height: 1.1; }
    .prole { font-size: 11px; font-weight: 700; color: var(--ink2); }
    .icon-btn.on { background: #FCE9E3; }
  `],
})
export class SidebarComponent {
  store = inject(FoyerStore);
  groups = NAV_GROUPS;
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;
}
