import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { ModalComponent } from '../shared/modal';
import { PALETTE } from '../core/constants';
import { contactIni } from '../core/helpers';

@Component({
  selector: 'app-family-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent, ModalComponent],
  template: `
    @if (store.ui().familyOpen) {
      <f-modal title="Gestion de la famille" (close)="store.patch({ familyOpen: false })">
        <label class="field-label">Nom du foyer</label>
        <div class="row" style="margin-bottom:20px">
          <input class="input" [ngModel]="store.ui().famNameField" (ngModelChange)="store.patch({ famNameField: $event })" />
          <button class="btn btn-primary" (click)="store.saveFamily()">Enregistrer</button>
        </div>
        <div class="between"><div class="overline">Membres · {{ d().members.length }}</div>
          <button class="btn btn-soft" (click)="store.newMember()"><f-icon name="userPlus" [size]="17" /> Inviter</button></div>
        <div class="members">
          @for (m of d().members; track m.id) {
            <div class="member">
              <f-avatar [ini]="m.ini" [color]="m.color" [size]="40" />
              <div class="minfo">
                <div class="mname">{{ m.name }} @if (m.admin) { <span class="admin">admin</span> }</div>
                <div class="mrole">{{ m.role }}@if (store.memberHasAccount(m.id)) { <span class="acct" [title]="store.memberAccountEmail(m.id)"><f-icon name="check" [size]="10" color="#5F7E5C" [width]="3" /> accès</span> }</div>
              </div>
              @if (store.isAdmin()) {
                <button class="icon-btn sm" title="Gérer l'accès" (click)="store.openAccount(m.id)"><f-icon name="lock" [size]="15" [color]="store.memberHasAccount(m.id) ? 'var(--sage)' : 'var(--ink3)'" /></button>
              }
              <button class="icon-btn sm" (click)="store.editMember(m.id)"><f-icon name="edit" [size]="16" /></button>
              <button class="icon-btn sm" (click)="store.patch({ memberDelId: m.id })"><f-icon name="trash" [size]="16" color="var(--primary)" /></button>
            </div>
          }
        </div>
      </f-modal>
    }

    @if (store.ui().accountFor) {
      <f-modal [title]="accEmail() ? 'Gérer l’accès' : 'Créer un accès'" (close)="store.closeAccount()">
        <p class="confirm" style="margin-bottom:18px">
          {{ accEmail()
            ? ('Ce membre peut se connecter. Modifiez l’email ou définissez un nouveau mot de passe.')
            : ('Donnez un email et un mot de passe à ' + accMemberName() + ' pour lui permettre de se connecter.') }}
        </p>
        <label class="field-label">Email de connexion</label>
        <input class="input" type="email" [ngModel]="store.ui().acEmail" (ngModelChange)="store.patch({ acEmail: $event })" placeholder="membre@email.fr" style="margin-bottom:14px" />
        <label class="field-label">{{ accEmail() ? 'Nouveau mot de passe' : 'Mot de passe' }}</label>
        <input class="input" type="password" [ngModel]="store.ui().acPassword" (ngModelChange)="store.patch({ acPassword: $event })" [placeholder]="accEmail() ? 'Laisser vide pour ne pas changer' : '6 caractères minimum'" style="margin-bottom:18px" />
        <div class="acc-foot">
          @if (accEmail()) {
            <button class="btn btn-ghost" (click)="store.removeAccount()" [disabled]="store.ui().acBusy">Retirer l'accès</button>
          } @else { <div class="spacer"></div> }
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.closeAccount()">Annuler</button>
          <button class="btn btn-primary" (click)="store.saveAccount()" [disabled]="store.ui().acBusy">{{ accEmail() ? 'Enregistrer' : 'Créer l’accès' }}</button>
        </div>
      </f-modal>
    }

    @if (store.ui().memberForm) {
      <f-modal [title]="store.ui().mfEditId ? 'Modifier le membre' : 'Inviter un membre'" (close)="store.patch({ memberForm: false })">
        <div class="mform-head">
          <f-avatar [ini]="ini()" [color]="store.ui().mfColor" [size]="56" />
        </div>
        <label class="field-label">Prénom</label>
        <input class="input" [ngModel]="store.ui().mfName" (ngModelChange)="store.patch({ mfName: $event })" placeholder="Prénom" style="margin-bottom:14px" />
        <label class="field-label">Rôle</label>
        <input class="input" [ngModel]="store.ui().mfRole" (ngModelChange)="store.patch({ mfRole: $event })" placeholder="Maman, Papa, 12 ans…" style="margin-bottom:14px" />
        <label class="field-label">Date de naissance</label>
        <input class="input" type="date" [ngModel]="store.ui().mfBirthday" (ngModelChange)="store.patch({ mfBirthday: $event })" style="margin-bottom:14px" />
        <label class="field-label">Email</label>
        <input class="input" [ngModel]="store.ui().mfEmail" (ngModelChange)="store.patch({ mfEmail: $event })" placeholder="email@exemple.fr" style="margin-bottom:14px" />
        <label class="field-label">Couleur</label>
        <div class="swatch-row" style="margin-bottom:16px">
          @for (c of palette; track c) {
            <button class="swatch" [style.background]="c" [style.box-shadow]="store.ui().mfColor === c ? ('0 0 0 3px var(--surface),0 0 0 6px ' + c) : 'none'" (click)="store.patch({ mfColor: c })"></button>
          }
        </div>
        <label class="toggle" (click)="store.patch({ mfAdmin: !store.ui().mfAdmin })">
          <span>Administrateur du foyer</span>
          <span class="switch" [class.on]="store.ui().mfAdmin"><span class="knob"></span></span>
        </label>
        <button class="btn btn-primary btn-block" style="margin-top:18px" (click)="store.saveMember()">{{ store.ui().mfEditId ? 'Enregistrer' : 'Envoyer l’invitation' }}</button>
      </f-modal>
    }

    @if (store.ui().memberDelId) {
      <f-modal title="Retirer ce membre ?" (close)="store.patch({ memberDelId: null })">
        <p class="confirm">Le membre sera retiré du foyer. Cette action est définitive.</p>
        <div class="row" style="justify-content:flex-end;gap:10px">
          <button class="btn btn-soft" (click)="store.patch({ memberDelId: null })">Annuler</button>
          <button class="btn btn-danger" (click)="store.confirmMemberDel()">Retirer</button>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .row { display: flex; align-items: center; gap: 10px; }
    .between { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 12px; }
    .members { display: flex; flex-direction: column; gap: 8px; }
    .member { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 14px; background: var(--soft); }
    .minfo { flex: 1; min-width: 0; }
    .mname { font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .admin { font-size: 10px; font-weight: 800; color: var(--sage); background: #EDF2EB; padding: 2px 7px; border-radius: 20px; margin-left: 6px; }
    .mrole { font-size: 12px; font-weight: 700; color: var(--ink2); }
    .mform-head { display: flex; justify-content: center; margin-bottom: 18px; }
    .toggle { display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 14px; font-weight: 800; color: var(--ink); }
    .switch { width: 46px; height: 26px; border-radius: 20px; background: var(--line2); position: relative; transition: background .2s ease; }
    .switch.on { background: var(--sage); }
    .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left .2s ease; }
    .switch.on .knob { left: 23px; }
    .confirm { font-size: 14px; font-weight: 600; color: var(--ink2); margin-bottom: 20px; line-height: 1.5; }
    .acct { display: inline-flex; align-items: center; gap: 3px; margin-left: 8px; padding: 1px 7px; border-radius: 20px; background: #EDF2EB; color: #5F7E5C; font-size: 10.5px; font-weight: 800; }
    :host-context(:root.dark) .acct { background: rgba(122,155,118,.22); }
    .acc-foot { display: flex; align-items: center; gap: 10px; }
  `],
})
export class FamilyModalComponent {
  store = inject(FoyerStore);
  palette = PALETTE;
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;
  ini(): string { return contactIni(this.store.ui().mfName || '?'); }
  accEmail(): string { const id = this.store.ui().accountFor; return id ? this.store.memberAccountEmail(id) : ''; }
  accMemberName(): string { const id = this.store.ui().accountFor; return this.d().members.find((m) => m.id === id)?.name || 'ce membre'; }
}
