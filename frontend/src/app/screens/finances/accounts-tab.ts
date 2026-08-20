import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';
import { AvatarComponent } from '../../shared/avatar';
import { AccountKind, FinAccount } from '../../core/finances.api';

const KINDS: { k: AccountKind; label: string; color: string }[] = [
  { k: 'courant', label: 'Courant', color: '#4E93B8' },
  { k: 'pro', label: 'Professionnel', color: '#9B6FA8' },
  { k: 'epargne', label: 'Épargne', color: '#7A9B76' },
  { k: 'credit', label: 'Crédit', color: '#B8735A' },
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
            @if (a.memberIds.length) {
              <div class="holders">
                @for (m of knownMembers(a.memberIds); track m) {
                  <f-avatar [ini]="foyer.memberIni(m)" [color]="foyer.memberColor(m)" [size]="26" />
                }
              </div>
            }
          </div>
          <div class="name">{{ a.name }}</div>
          @if (a.kind === 'credit') {
            @if (loan(a.id); as l) {
              <div class="bal f-display">{{ fmt(l.owed) }} €</div>
              <div class="meta">capital restant dû, sur {{ fmt(l.principal) }} € empruntés</div>
              <div class="gauge"><div class="fill" [style.width]="pct(l.progress)"></div></div>
              <div class="meta">
                {{ round(l.progress * 100) }} % remboursé, {{ l.left }} échéance{{ l.left > 1 ? 's' : '' }} restante{{ l.left > 1 ? 's' : '' }}
              </div>
              <div class="anchor">{{ fmt(l.monthly) }} € par mois, dernière échéance le {{ foyer.fmtNumDate(l.endsOn) }}</div>
            } @else {
              <div class="bal f-display muted">—</div>
              <div class="meta muted">Termes du prêt à renseigner</div>
            }
          } @else {
            <div class="bal f-display" [style.color]="store.balanceOf(a.id) < 0 ? 'var(--primary)' : 'var(--ink)'">{{ fmt(store.balanceOf(a.id)) }} €</div>
            <div class="meta">
              @if (cov(a.id); as c) {
                @if (c.count) {
                  <span>{{ c.count }} opération{{ c.count > 1 ? 's' : '' }}, jusqu'au {{ foyer.fmtNumDate(c.lastDate || '') }}</span>
                } @else { <span class="muted">Aucune opération</span> }
              }
            </div>
            @if (a.openingDate) { <div class="anchor">{{ anchorLabel(a) }}</div> }
          }
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

        <div class="field-label">Titulaires</div>
        <div class="picker">
          @for (m of members(); track m.id) {
            <button class="pick" [class.on]="store.ui().acMembers.includes(m.id)"
                    [style.border-color]="store.ui().acMembers.includes(m.id) ? m.color : 'transparent'"
                    (click)="store.toggleMember('acMembers', m.id)">
              <f-avatar [ini]="foyer.memberIni(m.id)" [color]="m.color" [size]="22" />
              {{ m.name }}
            </button>
          } @empty {
            <div class="hint">Aucun membre déclaré dans le foyer.</div>
          }
        </div>
        <div class="hint sm">Un compte joint en a deux. Aucun sélectionné veut dire « le foyer ».</div>

        @if (store.ui().acKind === 'credit') {
          <div class="field-label">Termes du prêt</div>
          <div class="frow">
            <div class="fgrow">
              <div class="field-label sm">Capital emprunté €</div>
              <input class="input" [ngModel]="store.ui().acPrincipal" (ngModelChange)="store.patch({ acPrincipal: $event })" placeholder="200 000,00" inputmode="decimal" />
            </div>
            <div class="fnarrow">
              <div class="field-label sm">Taux annuel %</div>
              <input class="input" [ngModel]="store.ui().acRate" (ngModelChange)="store.patch({ acRate: $event })" placeholder="3,00" inputmode="decimal" />
            </div>
          </div>
          <div class="frow">
            <div class="fgrow">
              <div class="field-label sm">Mensualité €</div>
              <input class="input" [ngModel]="store.ui().acPayment" (ngModelChange)="store.patch({ acPayment: $event })" placeholder="1 109,20" inputmode="decimal" />
            </div>
            <div class="fgrow">
              <div class="field-label sm">Assurance €/mois</div>
              <input class="input" [ngModel]="store.ui().acInsurance" (ngModelChange)="store.patch({ acInsurance: $event })" placeholder="0,00" inputmode="decimal" />
            </div>
            <div class="fgrow">
              <div class="field-label sm">Première échéance</div>
              <input class="input" type="date" [ngModel]="store.ui().acFirstOn" (ngModelChange)="store.patch({ acFirstOn: $event })" />
            </div>
          </div>
          <div class="note">
            Recopiez ces quatre chiffres de votre offre de prêt. Tout le reste se calcule :
            capital restant dû, part d'intérêts de chaque échéance, date de fin, intérêts de l'année.
            La mensualité s'entend hors assurance : laissez l'assurance à zéro si elle y est déjà comprise.
          </div>
        }

        <div class="frow">
          <div class="fgrow">
            <div class="field-label">{{ store.ui().acKind === 'credit' ? 'Capital restant dû €' : "Solde d'ouverture €" }}</div>
            <input class="input" [ngModel]="store.ui().acOpening" (ngModelChange)="store.patch({ acOpening: $event })" placeholder="0,00" inputmode="decimal" />
          </div>
          <div class="fgrow">
            <div class="field-label">À la date du</div>
            <input class="input" type="date" [ngModel]="store.ui().acOpeningDate" (ngModelChange)="store.patch({ acOpeningDate: $event })" />
          </div>
        </div>
        @if (store.ui().acKind === 'credit') {
          <div class="note">
            Facultatif, et c'est le recalage : après un remboursement anticipé ou une
            renégociation, recopiez ici le capital restant dû lu sur votre relevé, avec sa date.
            Le tableau d'amortissement repart de ce chiffre. Laissez vide pour suivre l'offre
            de prêt d'origine.
          </div>
        } @else {
          <div class="note">
            Avec une date, le solde affiché part de ce montant et n'ajoute que les opérations
            postérieures : celles du jour même et d'avant sont considérées comme
            déjà comprises dedans, comme sur un relevé bancaire. Sans date, le solde d'ouverture
            s'ajoute à toutes les opérations enregistrées.
          </div>
        }

        <label class="check">
          <input type="checkbox" [ngModel]="store.ui().acArchived" (ngModelChange)="store.patch({ acArchived: $event })" />
          <span>Compte archivé (historique conservé, plus d'alerte de mois incomplet)</span>
        </label>

        @if (store.ui().acId && store.ui().acKind !== 'credit') {
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
    .holders { display: flex; gap: -4px; }
    .holders f-avatar + f-avatar { margin-left: -8px; }
    .picker { display: flex; gap: 8px; flex-wrap: wrap; }
    .pick { display: inline-flex; align-items: center; gap: 7px; border: 2px solid transparent; border-radius: 20px; padding: 4px 12px 4px 4px; background: var(--soft2); font-family: inherit; font-size: 12.5px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .pick.on { background: var(--surface); color: var(--ink); box-shadow: 0 6px 14px -10px rgba(90,60,40,.6); }
    .hint { font-size: 12.5px; font-weight: 700; color: var(--ink3); line-height: 1.5; }
    .hint.sm { margin-top: 8px; }
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
    .gauge { margin-top: 8px; height: 7px; border-radius: 99px; background: var(--soft2); overflow: hidden; }
    .fill { height: 100%; border-radius: 99px; background: #B8735A; }
    .field-label.sm { font-size: 10.5px; }
    .anchor { margin-top: 6px; font-size: 11.5px; font-weight: 700; color: var(--ink3); line-height: 1.35; }
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
  /** Titulaires encore présents dans le foyer : un membre supprimé n'a plus d'avatar. */
  knownMembers(ids: string[]): string[] {
    const known = this.members();
    return ids.filter((id) => known.some((m) => m.id === id));
  }
  kindLabel(k: AccountKind): string { return KINDS.find((x) => x.k === k)?.label || k; }
  kindColor(k: AccountKind): string { return KINDS.find((x) => x.k === k)?.color || '#8A7E74'; }
  cov(id: number) { return this.store.coverageOf(id); }
  loan(id: number) { return this.store.loanOf(id); }
  pct(v: number): string { return `${Math.max(0, Math.min(100, v * 100))}%`; }
  round(v: number): number { return Math.round(v); }
  /** Date du solde, et ce qu'elle écarte : sans ça, les opérations d'avant semblent perdues. */
  anchorLabel(a: FinAccount): string {
    const base = `Solde constaté le ${this.foyer.fmtNumDate(a.openingDate || '')}`;
    const n = this.store.ignoredOpsOf(a.id);
    if (!n) return base;
    const s = n > 1 ? 's' : '';
    return `${base}, ${n} opération${s} antérieure${s} déjà comprise${s}`;
  }
  delName = computed(() => this.store.accounts().find((a) => a.id === this.store.ui().acDelId)?.name || '');
}
