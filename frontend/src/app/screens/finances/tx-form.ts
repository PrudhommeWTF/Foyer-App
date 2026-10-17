import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinancesStore } from '../../core/finances.store';
import { afterSpend, daysLeft } from '../../core/finances-plan';
import { CAT_ICONS } from '../../core/constants';
import { IconComponent } from '../../core/icon';
import { CheckComponent } from '../../shared/check';
import { FinAttachments } from './attachments';
import { eur } from './charts/tip';

/**
 * La fiche d'une opération : saisie ou modification. Elle ne décide pas de son
 * cadre : à droite de la liste sur ordinateur, dans un panneau sur téléphone.
 * Une dépense se range d'un tap dans une enveloppe, qui montre son reste, et la
 * fiche dit ce que la dépense y laissera.
 */
@Component({
  selector: 'fin-tx-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, CheckComponent, FinAttachments],
  template: `
    @let u = store.ui();
    @if (store.openTx(); as t) {
      <div class="origin">Libellé d'origine : {{ t.labelRaw }}</div>
    }
    @if (u.txTransfer) {
      <div class="transfer"><span aria-hidden="true">⇄</span> Virement interne{{ transferWith() }} : ni dépense ni recette, il reste apparié à l'autre compte.</div>
    } @else {
      <div class="seg type-seg">
        <button [class.active]="u.txSign === 'out'" (click)="store.patch({ txSign: 'out' })">Dépense</button>
        <button [class.active]="u.txSign === 'in'" (click)="store.patch({ txSign: 'in', txCategory: null, txContract: null })">Recette</button>
      </div>
    }
    <div class="frow">
      <div class="fgrow">
        <div class="field-label">Libellé</div>
        <input class="input" [ngModel]="u.txLabel" (ngModelChange)="store.setTxLabel($event)" placeholder="Ex : Marché du samedi" />
      </div>
      <div class="fnarrow">
        <div class="field-label">Montant €</div>
        <input class="input" [ngModel]="u.txAmount" (ngModelChange)="store.patch({ txAmount: $event })" placeholder="84,30" inputmode="decimal" />
      </div>
    </div>
    <div class="frow">
      <div class="fgrow">
        <div class="field-label">Compte</div>
        <select class="input" [ngModel]="u.txAccount" (ngModelChange)="store.patch({ txAccount: $event })">
          @for (a of accounts(); track a.id) { <option [ngValue]="a.id">{{ a.name }}{{ a.archived ? ' (archivé)' : '' }}</option> }
        </select>
      </div>
      <div class="fnarrow">
        <div class="field-label">Date</div>
        <input class="input" type="date" [ngModel]="u.txDate" (ngModelChange)="store.patch({ txDate: $event })" />
      </div>
    </div>

    @if (u.txSign === 'out' && !u.txTransfer) {
      <div class="field-label">Enveloppe</div>
      @if (store.envelopes().length) {
        <div class="envs" role="radiogroup" aria-label="Enveloppe">
          @for (e of store.envelopes(); track e.categoryId) {
            <button type="button" class="env" role="radio" [attr.aria-checked]="pickedRoot() === e.categoryId" [class.on]="pickedRoot() === e.categoryId"
                    (click)="store.patch({ txCategory: e.categoryId })">
              <f-icon [path]="CAT_ICONS[e.icon] || CAT_ICONS['facture']" [size]="15" [color]="pickedRoot() === e.categoryId ? 'currentColor' : e.color" [width]="2.2" />
              <span>{{ e.name }}</span>
              @if (e.left < 0) { <small><span aria-hidden="true">⚠</span> dépassé</small> } @else { <small>{{ eur(e.left) }}</small> }
            </button>
          }
        </div>
      }
      <select class="input" [ngModel]="u.txCategory" (ngModelChange)="store.patch({ txCategory: $event })" aria-label="Catégorie">
        <option [ngValue]="null">{{ store.envelopes().length ? 'Autre catégorie, ou aucune' : 'Sans catégorie' }}</option>
        @for (c of store.rootCategories(); track c.id) {
          <option [ngValue]="c.id">{{ c.name }}</option>
          @for (s of store.childrenOf(c.id); track s.id) { <option [ngValue]="s.id">&nbsp;&nbsp;{{ c.name }} · {{ s.name }}</option> }
        }
      </select>
      @if (after(); as a) {
        <div class="after">
          Après cette dépense : <b>{{ a.name }} {{ a.left < 0 ? 'dépassée de ' + eur(-a.left) : eur(a.left) + ' restants' }}</b>@if (a.left >= 0) {, soit <b>{{ eur(a.perDay) }} par jour</b> (au lieu de {{ eur(a.before) }})}.
        </div>
      }
      @if (u.txSuggest; as sg) {
        @if (!u.txCategory) {
          <button class="suggest" (click)="store.applyTxSuggestion()">
            <f-icon name="bolt" [size]="14" color="var(--sage-dark)" [width]="2.2" />
            <span>Suggestion : <b>{{ store.categoryPath(sg.categoryId) }}</b> <span class="sg-why">{{ sg.via === 'merchant' ? 'déjà classé ainsi ' + sg.seen + '×' : 'd’après des libellés ressemblants' }}</span></span>
            <span class="sg-apply">Appliquer</span>
          </button>
        }
      }
      @if (store.contracts().length) {
        <div class="field-label">Contrat</div>
        <select class="input" [ngModel]="u.txContract" (ngModelChange)="store.patch({ txContract: $event })">
          <option [ngValue]="null">Aucun contrat</option>
          @for (c of store.activeContracts(); track c.id) { <option [ngValue]="c.id">{{ c.name }}{{ c.provider ? ' · ' + c.provider : '' }}</option> }
        </select>
      }
    }

    @if (store.openTx()?.tags?.length) {
      <div class="field-label">Étiquettes</div>
      <div class="tags">
        @for (g of store.openTx()!.tags; track g) { <span class="tag">{{ g }}</span> }
        <span class="tags-hint">posées par les règles</span>
      </div>
    }

    <div class="field-label">Notes</div>
    <input class="input" [ngModel]="u.txNotes" (ngModelChange)="store.patch({ txNotes: $event })" placeholder="Facultatif" />
    <label class="check" (click)="store.patch({ txCleared: !u.txCleared })">
      <f-check [checked]="u.txCleared" />
      <span>Pointée sur le relevé</span>
    </label>

    @if (u.txId) {
      @if (!u.txTransfer) {
        <div class="prov">
          @if (ruleName(); as r) {
            Catégorie posée par la règle « {{ r }} ». La modifier ici la fige : les rejeux ne la toucheront plus.
          } @else {
            Catégorie choisie à la main. Les rejeux de règles la laisseront intacte.
          }
        </div>
      }
      <div class="field-label">Justificatif</div>
      <fin-attachments owner="transaction" [ownerId]="u.txId" empty="Aucun justificatif : ticket, facture, reçu." label="Joindre un justificatif" />
    } @else {
      <div class="prov">Enregistrez l'opération pour y joindre un justificatif.</div>
    }

    <div class="acts">
      @if (u.txId) {
        @if (!u.txTransfer) { <button class="btn btn-soft" (click)="store.ruleFromTx(u.txId)">Créer une règle</button> }
        <button class="btn btn-soft danger" (click)="store.patch({ txDelId: u.txId })">Supprimer</button>
      }
      <div class="spacer"></div>
      <button class="btn btn-soft" (click)="store.patch({ txForm: false, txId: null })">Annuler</button>
      <button class="btn btn-primary" [disabled]="u.busy" (click)="store.saveTx()">Enregistrer</button>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .field-label { margin-top: 14px; }
    .origin { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-bottom: 12px; overflow-wrap: anywhere; }
    .transfer { background: var(--tint-blue); color: var(--ink); border-radius: 12px; padding: 10px 12px; font-size: 12.5px; font-weight: 700; line-height: 1.45; }
    .type-seg { margin-bottom: 4px; }
    .frow { display: flex; gap: 10px; flex-wrap: wrap; }
    .fgrow { flex: 1 1 200px; min-width: 0; }
    .fnarrow { flex: 0 1 150px; min-width: 120px; }
    .envs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .env { display: inline-flex; align-items: center; gap: 6px; border: none; border-radius: 11px; padding: 7px 10px; background: var(--soft2); color: var(--ink2); font-family: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
    .env small { font-size: 11.5px; font-weight: 800; color: var(--ink3); }
    .env.on { background: var(--ink); color: var(--surface); }
    .env.on small { color: var(--surface); opacity: .75; }
    .after { margin-top: 10px; font-size: 13px; font-weight: 700; color: var(--ink2); line-height: 1.5; }
    .after b { color: var(--ink); }
    .suggest { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 8px; border: 1.5px dashed var(--line2); border-radius: 12px; background: none; padding: 8px 11px; font-family: inherit; font-size: 12.5px; font-weight: 700; color: var(--ink2); cursor: pointer; text-align: left; }
    .sg-why { color: var(--ink3); }
    .sg-apply { margin-left: auto; color: var(--primary); font-weight: 800; flex: none; }
    .tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .tag { background: var(--soft2); color: var(--ink2); border-radius: 8px; padding: 3px 8px; font-size: 12px; font-weight: 800; }
    .tags-hint { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .check { display: flex; align-items: flex-start; gap: 10px; margin-top: 14px; font-size: 13.5px; font-weight: 800; color: var(--ink); cursor: pointer; }
    .prov { margin-top: 14px; background: var(--soft); border-radius: 12px; padding: 10px 12px; font-size: 12.5px; font-weight: 700; color: var(--ink2); line-height: 1.45; }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .spacer { flex: 1; }
    .danger { color: var(--status-crit); }
  `],
})
export class FinTxForm {
  readonly store = inject(FinancesStore);
  readonly CAT_ICONS = CAT_ICONS;
  readonly eur = eur;

  /** Les comptes qui portent des opérations ; un compte archivé reste choisi s'il l'est déjà. */
  readonly accounts = computed(() => {
    const cur = this.store.ui().txAccount;
    return this.store.ledgerAccounts().filter((a) => !a.archived || a.id === cur);
  });

  readonly pickedRoot = computed(() => this.store.rootOf(this.store.ui().txCategory));

  /** « Après cette dépense » : pour une saisie nouvelle, dans une enveloppe du mois affiché. */
  readonly after = computed(() => {
    const u = this.store.ui(), f = this.store.flow();
    const e = this.store.envelopes().find((x) => x.categoryId === this.pickedRoot());
    const cents = Math.round(parseFloat((u.txAmount || '').replace(/[\s  €]/g, '').replace(',', '.')) * 100);
    if (u.txId || !e || !f || !cents || u.txDate.slice(0, 7) !== f.month) return null;
    return { name: e.name, ...afterSpend(e, cents, daysLeft(f)) };
  });

  readonly transferWith = computed(() => {
    const t = this.store.openTx();
    return t?.transferAccountId ? ` avec « ${this.store.accountName(t.transferAccountId)} »` : '';
  });

  readonly ruleName = computed(() => {
    const id = this.store.openTx()?.ruleId;
    return id ? this.store.rules().find((r) => r.id === id)?.name ?? null : null;
  });

}
