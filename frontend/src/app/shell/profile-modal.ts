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
        <div class="tabs">
          <button [class.active]="store.ui().pfTab === 'infos'" (click)="store.patch({ pfTab: 'infos' })">Mon profil</button>
          <button [class.active]="store.ui().pfTab === 'prefs'" (click)="store.patch({ pfTab: 'prefs' })">Préférences</button>
        </div>

        @if (store.ui().pfTab === 'infos') {
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
        } @else {
          <div class="prefs">
            <label class="toggle" (click)="store.setSetting('prefNotifs', !d().settings.prefNotifs)"><span>Notifications push</span><span class="switch" [class.on]="d().settings.prefNotifs"><span class="knob"></span></span></label>
            <label class="toggle" (click)="store.setSetting('prefWeekly', !d().settings.prefWeekly)"><span>Résumé hebdomadaire</span><span class="switch" [class.on]="d().settings.prefWeekly"><span class="knob"></span></span></label>
            <label class="toggle" (click)="store.setSetting('prefShared', !d().settings.prefShared)"><span>Partage étendu</span><span class="switch" [class.on]="d().settings.prefShared"><span class="knob"></span></span></label>
          </div>
        }

        <div class="foot">
          <button class="btn btn-ghost" (click)="logout()">Se déconnecter</button>
          <button class="btn btn-primary" (click)="store.saveProfile()">Enregistrer</button>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .head { display: flex; justify-content: center; margin-bottom: 16px; }
    .tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--line); margin-bottom: 18px; }
    .tabs button { border: none; background: none; cursor: pointer; padding: 0 0 12px; font-size: 14px; font-weight: 800; color: var(--ink3); border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tabs button.active { color: var(--ink); border-color: var(--primary); }
    .readonly { border: 2px solid var(--line); background: var(--soft); border-radius: var(--r-input); padding: 13px 16px; font-size: 15px; font-weight: 700; color: var(--ink2); margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .hint { font-size: 11px; font-weight: 700; color: var(--ink3); }
    .prefs { display: flex; flex-direction: column; gap: 16px; }
    .toggle { display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 14px; font-weight: 800; color: var(--ink); }
    .switch { width: 46px; height: 26px; border-radius: 20px; background: var(--line2); position: relative; transition: background .2s ease; flex: none; }
    .switch.on { background: var(--sage); }
    .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left .2s ease; }
    .switch.on .knob { left: 23px; }
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
