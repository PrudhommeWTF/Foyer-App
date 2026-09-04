import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { NAV_GROUPS } from './nav';

/**
 * Largeur du menu : un choix d'écran, pas un réglage du foyer. Il reste donc
 * sur l'appareil (un portable de 13 pouces et l'écran du salon n'ont pas les
 * mêmes besoins) plutôt que dans le document partagé.
 */
const FOLD_KEY = 'foyer.menuReduit';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent],
  template: `
    <aside class="sidebar" [class.reduit]="reduit()">
      <div class="brand">
        <div class="badge"><f-icon name="home" [size]="24" color="#fff" [width]="2.2" /></div>
        @if (!reduit()) {
          <div>
            <div class="name f-display">Foyer</div>
            <div class="tag f-script">la maison, ensemble</div>
          </div>
        }
      </div>

      <nav class="nav fscroll">
        @for (g of groups; track g.title) {
          @if (g.title) {
            <!-- Replié, le titre de groupe n'a plus la place de s'écrire ; un filet
                 garde au moins la coupure, sinon les onze icônes se confondent. -->
            @if (reduit()) { <div class="sep"></div> }
            @else { <div class="overline group-title">{{ g.title }}</div> }
          }
          @for (it of g.items; track it.id) {
            <button class="nav-item" [class.active]="store.ui().screen === it.id" (click)="store.go(it.id)"
                    [attr.title]="reduit() ? it.label : null" [attr.aria-label]="reduit() ? it.label : null">
              <span class="accent"></span>
              <f-icon [name]="it.icon" [size]="21" [color]="store.ui().screen === it.id ? 'var(--primary)' : 'var(--ink2)'" />
              @if (!reduit()) { <span>{{ it.label }}</span> }
            </button>
          }
        }
      </nav>

      <!--
        Sa propre ligne, sous la navigation : dans la signature le bouton
        renvoyait « la maison, ensemble » à la ligne, et dans le pied il ne
        laissait plus la place au prénom. Ici il ne serre rien, et il reste
        visible même quand la navigation défile.
      -->
      <button class="plier" (click)="basculer()" [title]="titrePlier()" [attr.aria-label]="titrePlier()"
              [attr.aria-expanded]="!reduit()">
        <f-icon [name]="reduit() ? 'chevronRight' : 'chevronLeft'" [size]="18" color="var(--ink3)" [width]="2.4" />
        @if (!reduit()) { <span>Replier le menu</span> }
      </button>

      <div class="foot">
        <button class="profile" (click)="store.openProfile()" [attr.title]="reduit() ? store.me()?.name : null">
          <f-avatar [ini]="store.me()?.ini || '?'" [color]="store.me()?.color || '#8A7E74'" [size]="reduit() ? 34 : 38" />
          @if (!reduit()) {
            <div class="pinfo">
              <div class="pname">{{ store.me()?.name }}</div>
              <div class="prole">{{ store.me()?.role }}@if (store.me()?.admin) { · admin }</div>
            </div>
          }
        </button>
        <button class="icon-btn" (click)="store.toggleDark()" title="Changer de thème">
          @if (store.setting('dark')) { <f-icon name="sun" [size]="19" color="#F0B24B" /> }
          @else { <f-icon name="moon" [size]="19" color="#8A7E74" /> }
        </button>
        @if (!store.isChild()) {
        <button class="icon-btn" [class.on]="store.ui().screen === 'settings'" (click)="store.go('settings')" title="Paramètres">
          <f-icon name="gear" [size]="19" [color]="store.ui().screen === 'settings' ? 'var(--primary)' : 'var(--ink2)'" />
        </button>
        }
      </div>
    </aside>
  `,
  styles: [`
    .sidebar { width: 270px; flex: none; background: var(--surface); border-right: 1px solid var(--line); display: flex; flex-direction: column; padding: 26px 18px; height: 100vh; transition: width .18s ease, padding .18s ease; }
    .brand { display: flex; align-items: center; gap: 12px; padding: 0 8px 4px; }
    .badge { width: 42px; height: 42px; border-radius: 14px; background: linear-gradient(135deg, #E56B4E, #D9553A); display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 16px -6px rgba(229,107,78,.6); }
    .name { font-size: 22px; font-weight: 700; color: var(--ink); line-height: 1; }
    .tag { font-size: 16px; color: var(--primary); line-height: 1; }
    .nav { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; margin-top: 16px; }
    .group-title { padding: 16px 14px 8px; }
    .sep { height: 1px; background: var(--line); margin: 13px 6px 10px; }
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
    .plier { display: flex; align-items: center; gap: 13px; width: 100%; padding: 9px 14px; margin-top: 4px; border: none; background: transparent; cursor: pointer; border-radius: 13px; font-size: 12.5px; font-weight: 800; color: var(--ink3); text-align: left; }
    .plier:hover { background: var(--soft2); }

    /* Replié : les icônes seules, centrées, et rien qui déborde. */
    .sidebar.reduit { width: 76px; padding-left: 12px; padding-right: 12px; }
    .sidebar.reduit .brand { flex-direction: column; gap: 10px; padding: 0 0 4px; }
    .sidebar.reduit .nav-item { justify-content: center; gap: 0; padding: 11px 0; }
    .sidebar.reduit .nav-item .accent { display: none; }
    .sidebar.reduit .plier { justify-content: center; gap: 0; padding: 9px 0; }
    .sidebar.reduit .foot { flex-direction: column; gap: 8px; padding: 12px 0 0; }
    .sidebar.reduit .profile { flex: none; justify-content: center; padding: 2px; }

    @media (prefers-reduced-motion: reduce) { .sidebar { transition: none; } }
  `],
})
export class SidebarComponent {
  store = inject(FoyerStore);
  groups = NAV_GROUPS;
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  readonly reduit = signal(read());

  titrePlier(): string { return this.reduit() ? 'Déplier le menu' : 'Replier le menu'; }

  basculer(): void {
    const v = !this.reduit();
    this.reduit.set(v);
    try { localStorage.setItem(FOLD_KEY, v ? '1' : ''); } catch { /* mode privé : le choix vaut pour la session */ }
  }
}

function read(): boolean {
  try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; }
}
