import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { AdminStore } from '../core/admin.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { ModalComponent } from '../shared/modal';

/**
 * Le menu du compte, ouvert par l'avatar (barre du haut, ou pied de la barre
 * latérale). Pour un adulte : son compte, les membres, et « Ouvrir la session
 * de … » pour chaque enfant du foyer, un tap sans confirmation (le retour, lui,
 * demande le mot de passe). Dans la session d'un enfant : revenir au parent, ou
 * se déconnecter. Voir docs/portail-enfant.md.
 */
@Component({
  selector: 'app-account-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent, ModalComponent],
  template: `
    <f-modal [maxWidth]="420" (close)="store.accountOpen.set(false)">
      @let me = store.me();
      <div class="who">
        <f-avatar [ini]="me?.ini || '?'" [color]="me?.color || '#8A7E74'" [size]="48" />
        <div class="who-b">
          <div class="who-n">{{ me?.name }}</div>
          <div class="who-r">@if (store.switched(); as sw) { Session ouverte par {{ sw.viaName }} } @else { {{ me?.role }} }</div>
        </div>
        <button class="icon-btn sm" (click)="store.accountOpen.set(false)" aria-label="Fermer"><f-icon name="x" [size]="18" /></button>
      </div>

      @if (store.switched(); as sw) {
        <button class="row-btn" (click)="revenir()">
          <span class="rb-ic"><f-icon name="key" [size]="19" color="var(--primary)" [width]="2.2" /></span>
          <span>Revenir à {{ sw.viaName }}</span>
        </button>
      } @else if (!store.isChild()) {
        <button class="row-btn" (click)="go('compte')">
          <span class="rb-ic"><f-icon name="gear" [size]="19" color="var(--ink2)" [width]="2.2" /></span>
          <span>Mon compte</span>
        </button>
        <button class="row-btn" (click)="go('membres')">
          <span class="rb-ic"><f-icon name="users" [size]="19" color="var(--ink2)" [width]="2.2" /></span>
          <span>Membres et accès</span>
        </button>
        @if (store.children().length) {
          <div class="sec">Ouvrir la session de…</div>
          <div class="kids">
            @for (c of store.children(); track c.id) {
              <button class="kid" (click)="store.openChildSession(c.id)" [disabled]="store.switchBusy()">
                <f-avatar [ini]="c.ini" [color]="c.color" [size]="52" />
                <span class="kid-n">{{ c.name }}</span>
              </button>
            }
          </div>
          <p class="hint">
            L’appareil devient celui de l’enfant : ses écrans, ses droits, rien d’autre.
            Pour revenir à votre session, il faudra votre mot de passe.
            @if (admin.pushSupport() === 'on') { Vos rappels continuent d’arriver sur cet appareil pendant ce temps. }
          </p>
        }
      }

      <button class="row-btn quiet" (click)="store.logout()">
        <span class="rb-ic"><f-icon name="logout" [size]="19" color="var(--ink3)" [width]="2.2" /></span>
        <span>Se déconnecter</span>
      </button>
    </f-modal>
  `,
  styles: [`
    .who { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
    .who-b { flex: 1; min-width: 0; }
    .who-n { font-size: 18px; font-weight: 800; color: var(--ink); }
    .who-r { font-size: 13px; font-weight: 700; color: var(--ink2); }
    .row-btn { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 52px; padding: 8px 10px; border: none; background: transparent; border-radius: 14px; cursor: pointer; font-family: inherit; font-size: 15px; font-weight: 800; color: var(--ink); text-align: left; }
    .row-btn:hover { background: var(--soft); }
    .row-btn.quiet { color: var(--ink2); margin-top: 8px; border-top: 1px solid var(--line); border-radius: 0 0 14px 14px; }
    .rb-ic { width: 36px; height: 36px; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; flex: none; }
    .sec { margin: 14px 4px 10px; font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; }
    .kids { display: flex; flex-wrap: wrap; gap: 10px; }
    .kid { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 96px; padding: 14px 12px; border: 2px solid var(--line); background: var(--surface); border-radius: 18px; cursor: pointer; font-family: inherit; }
    .kid:hover { border-color: var(--primary); }
    .kid:disabled { opacity: .5; cursor: wait; }
    .kid-n { font-size: 15px; font-weight: 800; color: var(--ink); }
    .hint { margin: 12px 4px 4px; font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; }
  `],
})
export class AccountSheetComponent {
  readonly store = inject(FoyerStore);
  readonly admin = inject(AdminStore);

  go(section: 'compte' | 'membres'): void {
    this.store.accountOpen.set(false);
    if (section === 'compte') this.store.openProfile(); else this.store.openMembers();
  }
  revenir(): void { this.store.accountOpen.set(false); this.store.switchBackOpen.set(true); }
}
