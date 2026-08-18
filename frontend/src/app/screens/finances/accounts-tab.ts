import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';
import { AvatarComponent } from '../../shared/avatar';
import { AccountKind } from '../../core/finances.api';

const KINDS: { k: AccountKind; label: string; color: string }[] = [
  { k: 'courant', label: 'Courant', color: '#4E93B8' },
  { k: 'pro', label: 'Professionnel', color: '#9B6FA8' },
  { k: 'epargne', label: 'Épargne', color: '#7A9B76' },
];

@Component({
  selector: 'fin-accounts-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent, AvatarComponent],
  template: `
    <div class="bar">
      <div class="hint">Un compte archivé garde tout son historique mais sort des alertes de mois incomplet.</div>
      <div class="spacer"></div>
      <button class="btn btn-primary" (click)="store.newAccount()"><f-icon name="plus" [size]="16" color="#fff" [width]="2.6" /> Nouveau compte</button>
    </div>

    <div class="grid">
      @for (a of store.accounts(); track a.id) {
        <div class="card" [class.arch]="a.archived" (click)="store.editAccount(a.id)">
          <div class="top">
            <div class="idz">
              <div class="badge" [style.background]="foyer.tint(kindColor(a.kind))" [style.color]="kindColor(a.kind)">{{ kindLabel(a.kind) }}</div>
              @if (a.archived) { <div class="badge muted">Archivé</div> }
            </div>
            @if (a.memberId) {
              <f-avatar [ini]="foyer.memberIni(a.memberId)" [color]="foyer.memberColor(a.memberId)" [size]="26" />
            }
          </div>
          <div class="name">{{ a.name }}</div>
          <div class="bal f-display" [style.color]="store.balanceOf(a.id) < 0 ? 'var(--primary)' : 'var(--ink)'">{{ fmt(store.balanceOf(a.id)) }} €</div>
          <div class="meta">
            @if (cov(a.id); as c) {
              @if (c.count) {
                <span>{{ c.count }} opération{{ c.count > 1 ? 's' : '' }}, jusqu'au {{ foyer.fmtNumDate(c.lastDate || '') }}</span>
              } @else { <span class="muted">Aucune opération</span> }
            }
          </div>
          @if (store.aliasesOf(a.id).length; as n) {
            <div class="aliases">{{ n }} libellé{{ n > 1 ? 's' : '' }} d'export rattaché{{ n > 1 ? 's' : '' }}</div>
          }
        </div>
      } @empty {
        <div class="empty">
          <div class="empty-title">Aucun compte</div>
          <div class="empty-txt">Créez d'abord vos comptes bancaires : ils portent les opérations et les soldes.</div>
        </div>
      }
    </div>

    <!-- FORMULAIRE DE COMPTE -->
    @if (store.ui().acForm) {
      <f-modal [title]="store.ui().acId ? 'Modifier le compte' : 'Nouveau compte'" [maxWidth]="520" (close)="store.patch({ acForm: false })">
        <div class="field-label first">Nom du compte</div>
        <input class="input" [ngModel]="store.ui().acName" (ngModelChange)="store.patch({ acName: $event })" placeholder="Ex : Compte joint" />

        <div class="field-label">Type</div>
        <div class="seg">
          @for (k of kinds; track k.k) {
            <button [class.active]="store.ui().acKind === k.k" (click)="store.patch({ acKind: k.k })">{{ k.label }}</button>
          }
        </div>

        <div class="field-label">Titulaire</div>
        <select class="input" [ngModel]="store.ui().acMember" (ngModelChange)="store.patch({ acMember: $event })">
          <option value="">Aucun titulaire précis</option>
          @for (m of members(); track m.id) { <option [value]="m.id">{{ m.name }}</option> }
        </select>

        <div class="frow">
          <div class="fgrow">
            <div class="field-label">Solde d'ouverture €</div>
            <input class="input" [ngModel]="store.ui().acOpening" (ngModelChange)="store.patch({ acOpening: $event })" placeholder="0,00" inputmode="decimal" />
          </div>
          <div class="fgrow">
            <div class="field-label">À la date du</div>
            <input class="input" type="date" [ngModel]="store.ui().acOpeningDate" (ngModelChange)="store.patch({ acOpeningDate: $event })" />
          </div>
        </div>
        <div class="note">Le solde affiché vaut le solde d'ouverture plus toutes les opérations enregistrées.</div>

        <label class="check">
          <input type="checkbox" [ngModel]="store.ui().acArchived" (ngModelChange)="store.patch({ acArchived: $event })" />
          <span>Compte archivé (historique conservé, plus d'alerte de mois incomplet)</span>
        </label>

        @if (store.ui().acId) {
          <div class="field-label">Libellés d'export rattachés</div>
          <div class="note">
            Un même compte peut apparaître sous plusieurs libellés dans les exports de votre banque
            (changement de nom, compte synchronisé par deux connexions). Déclarez-les ici pour que
            l'import les reconnaisse comme un seul compte.
          </div>
          <div class="alias-list">
            @for (al of store.aliasesOf(store.ui().acId!); track al.id) {
              <div class="alias">
                <span class="alias-txt">{{ al.labelRaw }}</span>
                <button class="icon-btn sm" (click)="store.removeAlias(al.id)"><f-icon name="x" [size]="14" color="var(--ink2)" /></button>
              </div>
            } @empty { <div class="alias-empty">Aucun libellé rattaché pour l'instant.</div> }
          </div>
          <div class="alias-add">
            <input class="input" [ngModel]="store.ui().acAliasInput" (ngModelChange)="store.patch({ acAliasInput: $event })"
                   (keydown.enter)="store.addAlias()" placeholder="Coller le libellé exact vu dans l'export" />
            <button class="btn btn-soft" (click)="store.addAlias()">Ajouter</button>
          </div>
        }

        <div class="modal-acts">
          @if (store.ui().acId) {
            <button class="btn btn-danger" (click)="store.patch({ acDelId: store.ui().acId })"><f-icon name="trash" [size]="16" color="var(--primary)" /> Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ acForm: false })">Annuler</button>
          <button class="btn btn-primary" [disabled]="store.ui().busy" (click)="store.saveAccount()">Enregistrer</button>
        </div>
      </f-modal>
    }

    @if (store.ui().acDelId) {
      <f-modal [maxWidth]="420" (close)="store.patch({ acDelId: null })">
        <div class="confirm">
          <div class="confirm-ic"><f-icon name="trash" [size]="26" color="var(--primary)" [width]="2" /></div>
          <div class="confirm-title f-display">Supprimer ce compte ?</div>
          <div class="confirm-txt">
            « {{ delName() }} » et ses libellés d'export seront retirés. Un compte qui porte des
            opérations ne peut pas être supprimé : archivez-le plutôt.
          </div>
          <div class="modal-acts">
            <button class="btn btn-soft grow" (click)="store.patch({ acDelId: null })">Annuler</button>
            <button class="btn btn-primary grow" (click)="store.confirmAccountDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
    .spacer { flex: 1; }
    .hint { font-size: 12.5px; font-weight: 700; color: var(--ink3); max-width: 460px; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
    :host-context(.shell.narrow) .grid { grid-template-columns: 1fr; }
    .card { background: var(--surface); border-radius: 18px; padding: 18px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); cursor: pointer; }
    .card:hover { background: var(--soft); }
    .card.arch { opacity: .62; }
    .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
    .idz { display: flex; gap: 6px; flex-wrap: wrap; }
    .badge { font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 20px; text-transform: uppercase; letter-spacing: .03em; }
    .badge.muted { background: var(--soft2); color: var(--ink3); }
    .name { font-size: 15px; font-weight: 800; color: var(--ink); }
    .bal { font-size: 25px; font-weight: 700; margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
    .meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 12px; font-weight: 700; color: var(--ink3); }
    .meta .muted, .alias-empty { font-style: italic; }
    .aliases { margin-top: 8px; font-size: 11.5px; font-weight: 800; color: var(--ink3); }
    .empty { grid-column: 1 / -1; background: var(--surface); border-radius: 16px; padding: 34px 24px; text-align: center; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .empty-title { font-size: 15px; font-weight: 800; color: var(--ink); }
    .empty-txt { font-size: 13px; font-weight: 700; color: var(--ink3); margin-top: 6px; }

    .frow { display: flex; gap: 12px; }
    .fgrow { flex: 1; min-width: 0; }
    @media (max-width: 520px) { .frow { flex-direction: column; } }
    .field-label { margin-top: 16px; }
    .field-label.first { margin-top: 0; }
    .frow .field-label { margin-top: 16px; }
    .note { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 8px; line-height: 1.45; }
    .check { display: flex; align-items: flex-start; gap: 10px; margin-top: 16px; font-size: 13px; font-weight: 700; color: var(--ink2); cursor: pointer; }
    .alias-list { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
    .alias { display: flex; align-items: center; gap: 8px; background: var(--soft2); border-radius: 11px; padding: 7px 8px 7px 12px; }
    .alias-txt { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 700; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .alias-empty { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 10px; }
    .alias-add { display: flex; gap: 9px; margin-top: 10px; }
    .alias-add .input { flex: 1; min-width: 0; }
    .modal-acts { display: flex; gap: 12px; margin-top: 22px; align-items: center; }
    .modal-acts .spacer { flex: 1; }
    .modal-acts .grow { flex: 1; }
    .confirm { text-align: center; }
    .confirm-ic { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #FCE9E3; display: flex; align-items: center; justify-content: center; }
    .confirm-title { font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-txt { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 0; line-height: 1.5; }
  `],
})
export class FinancesAccountsTab {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  kinds = KINDS;
  fmt = fmtEuros;

  members = computed(() => this.foyer.data()?.members || []);
  kindLabel(k: AccountKind): string { return KINDS.find((x) => x.k === k)?.label || k; }
  kindColor(k: AccountKind): string { return KINDS.find((x) => x.k === k)?.color || '#8A7E74'; }
  cov(id: number) { return this.store.coverageOf(id); }
  delName = computed(() => this.store.accounts().find((a) => a.id === this.store.ui().acDelId)?.name || '');
}
