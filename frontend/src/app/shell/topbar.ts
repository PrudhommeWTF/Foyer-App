import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { ADD_MENU } from './nav';
import { SCREEN_TITLES } from '../core/constants';

@Component({
  selector: 'app-topbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent],
  template: `
    <div class="topbar">
      @if (store.narrow()) {
        <div class="mbrand"><f-icon name="home" [size]="21" color="#fff" [width]="2.2" /></div>
      }
      <div class="title f-display">{{ title() }}</div>
      <div class="spacer"></div>

      @if (!store.narrow()) {
        <div class="search"><f-icon name="search" [size]="18" color="#B7ABA0" [width]="2.2" /><span>Rechercher…</span></div>
        <div class="avatars" (click)="store.openFamily()" title="Gérer la famille">
          @for (m of d().members; track m.id) {
            <f-avatar [ini]="m.ini" [color]="m.color" [size]="38" border="3px solid var(--soft)" />
          }
        </div>
      } @else {
        <button class="icon-btn lg" (click)="store.openFamily()" title="Gérer la famille"><f-icon name="users" [size]="21" /></button>
      }

      <button class="icon-btn lg bell" (click)="store.toggleNotif()" title="Notifications">
        <f-icon name="bell" [size]="21" />
        @if (unread() > 0) { <span class="badge">{{ unread() }}</span> }
      </button>

      <div class="add-wrap">
        <button class="add" [class.open]="store.ui().addMenuOpen" (click)="store.patch({ addMenuOpen: !store.ui().addMenuOpen })" title="Ajouter">
          <f-icon name="plus" [size]="22" color="#fff" [width]="2.4" />
        </button>
        @if (store.ui().addMenuOpen) {
          <div class="menu fscroll">
            @for (a of menu; track a.id) {
              @if (a.id === 'recipe') { <div class="sep"></div> }
              <button class="menu-item" (click)="pick(a.id)">
                <span class="mi-ic" [style.background]="a.tint"><f-icon [name]="a.icon" [size]="20" [color]="a.color" /></span>
                <span><span class="mi-label">{{ a.label }}</span><span class="mi-sub">{{ a.sub }}</span></span>
              </button>
            }
          </div>
        }
      </div>
    </div>
    @if (store.ui().addMenuOpen) { <div class="backdrop" (click)="store.patch({ addMenuOpen: false })"></div> }
  `,
  styles: [`
    .topbar { height: 74px; flex: none; display: flex; align-items: center; gap: 12px; padding: 0 40px; border-bottom: 1px solid var(--line); background: var(--bg); }
    .mbrand { display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; flex: none; border-radius: 11px; background: linear-gradient(135deg, #E56B4E, #D9553A); box-shadow: 0 8px 16px -6px rgba(229,107,78,.6); }
    .title { font-size: 26px; font-weight: 700; color: var(--ink); }
    .search { display: flex; align-items: center; gap: 10px; background: var(--surface); border-radius: 14px; padding: 10px 16px; width: 280px; box-shadow: var(--sh-float); font-size: 14px; font-weight: 600; color: var(--ink3); cursor: text; }
    .avatars { display: flex; cursor: pointer; }
    .avatars > * { margin-left: -10px; }
    .icon-btn.lg { width: 44px; height: 44px; border-radius: 14px; }
    .bell { position: relative; }
    .badge { position: absolute; top: 4px; right: 4px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--primary); color: #fff; font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; border: 2px solid var(--bg); }
    .add-wrap { position: relative; }
    .add { width: 44px; height: 44px; border: none; border-radius: 14px; background: var(--primary); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 8px 16px -8px rgba(229,107,78,.7); transition: transform .2s ease; }
    .add.open { transform: rotate(45deg); }
    .menu { position: absolute; top: 54px; right: 0; width: min(272px, calc(100vw - 24px)); max-height: 70vh; overflow-y: auto; background: var(--surface); border-radius: 18px; padding: 8px; z-index: 45; box-shadow: 0 24px 50px -16px rgba(30,24,20,.4); border: 1px solid var(--line); animation: fpop .16s ease; }
    .menu-item { display: flex; align-items: center; gap: 13px; padding: 12px; border-radius: 13px; cursor: pointer; border: none; background: transparent; width: 100%; text-align: left; }
    .menu-item:hover { background: var(--soft); }
    .mi-ic { width: 38px; height: 38px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
    .mi-label { display: block; font-size: 14.5px; font-weight: 800; color: var(--ink); line-height: 1.15; }
    .mi-sub { display: block; font-size: 12px; font-weight: 700; color: var(--ink2); }
    .sep { height: 1px; background: var(--line); margin: 6px 10px; }
    .backdrop { position: fixed; inset: 0; z-index: 44; }
    @media (max-width: 860px) { .topbar { padding: 0 18px; height: 66px; gap: 10px; } .title { font-size: 21px; } }
  `],
})
export class TopbarComponent {
  store = inject(FoyerStore);
  menu = ADD_MENU;
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;
  title = computed(() => SCREEN_TITLES[this.store.ui().screen] || 'Foyer');
  unread = computed(() => this.d().notifs.filter((n) => !n.read).length);

  pick(id: string): void {
    const s = this.store;
    s.patch({ addMenuOpen: false });
    switch (id) {
      case 'event': s.patch({ screen: 'calendar' }); s.openEvent(); break;
      case 'task': s.patch({ screen: 'taches' }); s.openTask(); break;
      case 'shop': s.pickShopFromMenu(); break;
      case 'recipe': s.patch({ screen: 'recettes' }); s.newRecipe(); break;
      case 'tx': s.patch({ screen: 'budget' }); s.newTx(); break;
      case 'slot': s.newSlot(''); break;
      case 'contact': s.patch({ screen: 'contacts' }); s.newContact(); break;
      case 'file': s.patch({ screen: 'documents' }); s.newFile(); break;
      case 'member': s.newMember(); break;
    }
  }
}
