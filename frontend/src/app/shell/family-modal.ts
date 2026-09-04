import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { ModalComponent } from '../shared/modal';
import { PALETTE } from '../core/constants';
import { ALLERGENES } from '../core/articles';
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
        @if (store.isAdmin()) {
          <div class="row" style="margin-bottom:20px">
            <input class="input" [ngModel]="store.ui().famNameField" (ngModelChange)="store.patch({ famNameField: $event })" />
            <button class="btn btn-primary" (click)="store.saveFamily()">Enregistrer</button>
          </div>
        } @else {
          <div class="input readonly" style="margin-bottom:20px">{{ d().familyName }}</div>
        }
        <div class="between"><div class="overline">Membres · {{ d().members.length }}</div>
          @if (store.isAdmin()) {
            <button class="btn btn-soft" (click)="store.newMember()"><f-icon name="userPlus" [size]="17" /> Ajouter</button>
          }</div>
        <div class="members">
          @for (m of d().members; track m.id) {
            <div class="member">
              <f-avatar [ini]="m.ini" [color]="m.color" [size]="40" />
              <div class="minfo">
                <div class="mname">{{ m.name }} @if (m.admin) { <span class="admin">admin</span> }</div>
                <div class="mrole">{{ m.role }}@if (store.isAdmin() && store.memberHasAccount(m.id)) { <span class="acct" [title]="store.memberAccountEmail(m.id)"><f-icon name="check" [size]="10" color="#5F7E5C" [width]="3" /> accès</span> }@if (store.isAdmin() && store.memberHasTotp(m.id)) { <span class="acct totp" title="Second facteur actif"><f-icon name="lock" [size]="10" color="#4E93B8" [width]="3" /> 2FA</span> }</div>
              </div>
              @if (store.isAdmin()) {
                <button class="icon-btn sm" title="Gérer l'accès" (click)="store.openAccount(m.id)"><f-icon name="lock" [size]="15" [color]="store.memberHasAccount(m.id) ? 'var(--sage)' : 'var(--ink3)'" /></button>
                @if (store.memberHasTotp(m.id)) {
                  <!-- Téléphone perdu, cassé ou réinitialisé, et codes de secours
                       avec : c'est la sortie de dernier recours. -->
                  <button class="icon-btn sm" title="Retirer son second facteur (téléphone perdu)" (click)="retirerTotp(m.id, m.name)">
                    <f-icon name="refresh" [size]="15" color="var(--ink3)" />
                  </button>
                }
                <button class="icon-btn sm" (click)="store.editMember(m.id)"><f-icon name="edit" [size]="16" /></button>
                <button class="icon-btn sm" (click)="store.patch({ memberDelId: m.id })"><f-icon name="trash" [size]="16" color="var(--primary)" /></button>
              }
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
      <f-modal [title]="store.ui().mfEditId ? 'Modifier le membre' : 'Ajouter un membre'" (close)="store.patch({ memberForm: false })">
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
        <label class="field-label">Allergènes</label>
        <div class="chips" style="margin-bottom:14px">
          @for (a of allergenes; track a.key) {
            <button class="chip" [class.on]="store.ui().mfAllerg.includes(a.key)" (click)="store.toggleMemberAllerg(a.key)">{{ a.name }}</button>
          }
        </div>

        <label class="field-label">Aliments refusés</label>
        <div class="hint">Ce qu'on ne veut pas voir arriver, sans que ce soit une allergie.</div>
        @if (store.ui().mfRefuse.length) {
          <div class="chips" style="margin-bottom:8px">
            @for (k of store.ui().mfRefuse; track k) {
              <button class="chip on sage" (click)="store.removeMemberRefuse(k)">
                {{ store.articleName(k) }} <f-icon name="x" [size]="12" color="#fff" [width]="3" />
              </button>
            }
          </div>
        }
        <input class="input" [ngModel]="store.ui().mfRefuseQ" (ngModelChange)="store.patch({ mfRefuseQ: $event })" placeholder="Chercher un aliment…" />
        @if (store.ui().mfRefuseQ.trim()) {
          <div class="choix">
            @for (a of store.refuseMatches(); track a.key) {
              <button class="art" (click)="store.addMemberRefuse(a.key)">{{ a.name }}</button>
            } @empty {
              <div class="hint">Aucun aliment ne correspond.</div>
            }
          </div>
        }
        <div class="hint" style="margin-top:10px">
          Ces contraintes signalent les plats à risque dans les recettes et le planning. Un ingrédient que
          l'application n'a pas su reconnaître n'est <b>pas</b> vérifié : l'absence d'alerte ne vaut pas garantie.
        </div>

        <label class="toggle" style="margin-top:14px" (click)="store.patch({ mfAdmin: !store.ui().mfAdmin, mfEnfant: store.ui().mfAdmin ? store.ui().mfEnfant : false })">
          <span>Administrateur du foyer</span>
          <span class="switch" [class.on]="store.ui().mfAdmin"><span class="knob"></span></span>
        </label>
        <label class="toggle" style="margin-top:12px" (click)="store.patch({ mfEnfant: !store.ui().mfEnfant, mfAdmin: store.ui().mfEnfant ? store.ui().mfAdmin : false })">
          <span>Enfant</span>
          <span class="switch" [class.on]="store.ui().mfEnfant"><span class="knob"></span></span>
        </label>
        <div class="hint">Un enfant utilise le foyer normalement, mais n’a pas accès aux Paramètres, ni depuis le menu ni par une adresse directe.</div>
        <button class="btn btn-primary btn-block" style="margin-top:18px" (click)="store.saveMember()">{{ store.ui().mfEditId ? 'Enregistrer' : 'Ajouter au foyer' }}</button>
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
    .chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .chip { border: 2px solid var(--line2); background: transparent; color: var(--ink2); border-radius: 11px; padding: 6px 10px; font-family: var(--font-body); font-size: 12.5px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
    .chip.on { background: var(--honey); border-color: var(--honey); color: #fff; }
    .chip.on.sage { background: var(--sage); border-color: var(--sage); }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; margin: 4px 0 8px; }
    .hint b { color: var(--ink); }
    .choix { display: flex; flex-direction: column; max-height: 180px; overflow-y: auto; margin-top: 4px; }
    .art { border: none; background: none; border-top: 1px solid var(--line); padding: 10px 2px; cursor: pointer; text-align: left; font-family: var(--font-body); font-size: 14px; font-weight: 700; color: var(--ink); }
    .art:hover { background: var(--soft); }
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
    .acct.totp { background: #E5F0F4; color: #3C6E88; }
    :host-context(:root.dark) .acct.totp { background: rgba(78,147,184,.22); }
    .acc-foot { display: flex; align-items: center; gap: 10px; }
    .input.readonly { display: flex; align-items: center; color: var(--ink2); font-weight: 700; background: var(--soft); }
  `],
})
export class FamilyModalComponent {
  readonly allergenes = Object.entries(ALLERGENES).map(([key, name]) => ({ key, name }));
  store = inject(FoyerStore);
  palette = PALETTE;
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;
  ini(): string { return contactIni(this.store.ui().mfName || '?'); }
  /**
   * Le téléphone d'un membre est perdu : on retire son second facteur pour qu'il
   * puisse se reconnecter, puis en reposer un. Le mot de passe de
   * l'administrateur est redemandé par le serveur, pas seulement ici.
   */
  async retirerTotp(memberId: string, nom: string): Promise<void> {
    const mdp = prompt(
      `Retirer le second facteur de ${nom} ?\n\n`
      + 'Son mot de passe seul suffira de nouveau à ouvrir son compte, jusqu’à ce qu’il en repose un.\n'
      + 'Confirmez avec VOTRE mot de passe.',
    );
    if (mdp) await this.store.resetMemberTotp(memberId, mdp);
  }

  accEmail(): string { const id = this.store.ui().accountFor; return id ? this.store.memberAccountEmail(id) : ''; }
  accMemberName(): string { const id = this.store.ui().accountFor; return this.d().members.find((m) => m.id === id)?.name || 'ce membre'; }
}
