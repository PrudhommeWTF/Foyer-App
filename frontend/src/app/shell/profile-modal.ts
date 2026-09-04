import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { AvatarComponent } from '../shared/avatar';
import { ModalComponent } from '../shared/modal';
import { PALETTE } from '../core/constants';
import { contactIni } from '../core/helpers';

@Component({
  selector: 'app-profile-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AvatarComponent, ModalComponent],
  template: `
    @if (store.ui().profileOpen) {
      <f-modal title="Mon profil" (close)="store.patch({ profileOpen: false })">
        <div class="head">
          <f-avatar [ini]="ini()" [color]="store.ui().pfColor" [size]="64" />
        </div>
        <label class="field-label">Prénom</label>
          <input class="input" [ngModel]="store.ui().pfName" (ngModelChange)="store.patch({ pfName: $event })" style="margin-bottom:14px" />
          <label class="field-label">Rôle</label>
          <input class="input" [ngModel]="store.ui().pfRole" (ngModelChange)="store.patch({ pfRole: $event })" style="margin-bottom:14px" />
          @if (store.ui().pfEmail) {
            <label class="field-label">Email de connexion</label>
            <div class="readonly">{{ store.ui().pfEmail }}<span class="hint">géré par l’administrateur</span></div>
          }
          <label class="field-label">Couleur d’identité</label>
          <div class="swatch-row" style="margin-bottom:8px">
            @for (c of palette; track c) {
              <button class="swatch" [style.background]="c" [style.box-shadow]="store.ui().pfColor === c ? ('0 0 0 3px var(--surface),0 0 0 6px ' + c) : 'none'" (click)="store.patch({ pfColor: c })"></button>
            }
          </div>

        <div class="foot">
          <button class="btn btn-ghost" (click)="logout()">Se déconnecter</button>
          <button class="btn btn-primary" (click)="store.saveProfile()">Enregistrer</button>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .head { display: flex; justify-content: center; margin-bottom: 16px; }
    .readonly { border: 2px solid var(--line); background: var(--soft); border-radius: var(--r-input); padding: 13px 16px; font-size: 15px; font-weight: 700; color: var(--ink2); margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .hint { font-size: 11px; font-weight: 700; color: var(--ink3); }
    .foot { display: flex; align-items: center; justify-content: space-between; margin-top: 22px; }
  `],
})
export class ProfileModalComponent {
  store = inject(FoyerStore);
  palette = PALETTE;
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;
  ini(): string { return contactIni(this.store.ui().pfName || '?'); }
  logout(): void { this.store.patch({ profileOpen: false }); this.store.logout(); }
}
