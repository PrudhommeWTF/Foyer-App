import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';
import { CAT_ICONS } from '../../core/constants';

@Component({
  selector: 'fin-transactions-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <div class="bar">
      <div class="sfield">
        <f-icon name="search" [size]="17" color="var(--ink3)" [width]="2.2" />
        <input class="sinput" [ngModel]="store.ui().fltQuery" (ngModelChange)="store.setFilter({ fltQuery: $event })"
               placeholder="Rechercher un libellé (toute la période)" />
      </div>
      <select class="input sel" [ngModel]="store.ui().fltAccount" (ngModelChange)="store.setFilter({ fltAccount: $event })">
        <option [ngValue]="null">Tous les comptes</option>
        @for (a of store.accounts(); track a.id) { <option [ngValue]="a.id">{{ a.name }}{{ a.archived ? ' (archivé)' : '' }}</option> }
      </select>
      <select class="input sel" [ngModel]="store.ui().fltCategory" (ngModelChange)="store.setFilter({ fltCategory: $event })">
        <option [ngValue]="null">Toutes les catégories</option>
        @for (c of store.rootCategories(); track c.id) {
          <option [ngValue]="c.id">{{ c.name }}</option>
          @for (s of store.childrenOf(c.id); track s.id) { <option [ngValue]="s.id">&nbsp;&nbsp;{{ c.name }} · {{ s.name }}</option> }
        }
      </select>
      <button class="chip" [class.on]="store.ui().fltUncategorised" (click)="store.setFilter({ fltUncategorised: !store.ui().fltUncategorised })">Sans catégorie</button>
      @if (store.ui().fltTag; as tag) { <button class="chip on" (click)="store.setFilter({ fltTag: '' })">Étiquette « {{ tag }} » <f-icon name="x" [size]="13" color="#fff" [width]="2.6" /></button> }
      @if (store.hasFilters()) { <button class="chip clear" (click)="store.clearFilters()"><f-icon name="x" [size]="13" color="var(--ink2)" [width]="2.6" /> Effacer</button> }
      <div class="spacer"></div>
      <button class="btn btn-primary" (click)="store.newTx()"><f-icon name="plus" [size]="16" color="#fff" [width]="2.6" /> Ajouter</button>
    </div>

    @if (store.hasFilters()) {
      <div class="count">{{ store.total() }} opération{{ store.total() > 1 ? 's' : '' }} correspondent{{ store.ui().fltQuery.trim() ? ', toutes périodes confondues' : '' }}</div>
    }

    <div class="tx-list">
      @for (t of store.transactions(); track t.id) {
        <div class="tx" (click)="store.editTx(t.id)">
          <div class="tx-chip" [style.background]="foyer.tint(store.categoryColor(t.categoryId))">
            @if (t.kind === 'virement') {
              <f-icon name="refresh" [size]="18" color="#8A7E74" [width]="2.2" />
            } @else if (t.amount > 0) {
              <f-icon name="arrowUp" [size]="18" color="#7A9B76" [width]="2.2" />
            } @else {
              <f-icon [path]="CAT_ICONS[store.categoryIcon(t.categoryId)] || CAT_ICONS['facture']" [size]="18" [color]="store.categoryColor(t.categoryId)" [width]="2.2" />
            }
          </div>
          <div class="tx-body">
            <div class="tx-name">{{ t.label }}</div>
            <div class="tx-meta">
              <span [class.muted]="!t.categoryId">{{ foyer.fmtNumDate(t.date) }} · {{ store.accountName(t.accountId) }} · {{ store.categoryPath(t.categoryId) }}</span>
              @for (g of t.tags; track g) { <span class="tag">{{ g }}</span> }
              @if (t.cleared) { <span class="tag">pointée</span> }
            </div>
          </div>
          <div class="tx-amt" [style.color]="t.amount > 0 ? '#6E9E5F' : 'var(--ink)'">{{ t.amount > 0 ? '+' : '−' }}{{ fmt(abs(t.amount)) }} €</div>
        </div>
      } @empty {
        <div class="tx-empty">
          @if (!store.activeAccounts().length) {
            <div class="empty-title">Aucun compte pour l'instant</div>
            <div class="empty-txt">Créez vos comptes dans l'onglet « Comptes », puis saisissez ou importez vos opérations.</div>
          } @else if (store.hasFilters()) {
            <div class="empty-title">Aucune opération ne correspond</div>
            <div class="empty-txt">Élargissez la recherche ou effacez les filtres.</div>
          } @else {
            <div class="empty-title">Aucune opération en {{ store.monthLabel().toLowerCase() }}</div>
            <div class="empty-txt">Changez de mois, ou ajoutez une opération.</div>
          }
        </div>
      }
    </div>

    @if (store.pageCount() > 1) {
      <div class="pager">
        <button class="pg" [disabled]="store.ui().page === 0" (click)="store.goPage(store.ui().page - 1)"><f-icon name="chevronLeft" [size]="15" color="var(--ink2)" [width]="2.4" /></button>
        <span>Page {{ store.ui().page + 1 }} sur {{ store.pageCount() }}</span>
        <button class="pg" [disabled]="store.ui().page + 1 >= store.pageCount()" (click)="store.goPage(store.ui().page + 1)"><f-icon name="chevronRight" [size]="15" color="var(--ink2)" [width]="2.4" /></button>
      </div>
    }

    <!-- FORMULAIRE D'OPÉRATION -->
    @if (store.ui().txForm) {
      <f-modal [title]="store.ui().txId ? 'Modifier l’opération' : 'Nouvelle opération'" [maxWidth]="500" (close)="store.patch({ txForm: false })">
        <div class="seg type-seg">
          <button [class.active]="store.ui().txSign === 'out'" (click)="store.patch({ txSign: 'out' })">Dépense</button>
          <button [class.active]="store.ui().txSign === 'in'" (click)="store.patch({ txSign: 'in' })">Recette</button>
        </div>
        <div class="frow">
          <div class="fgrow">
            <div class="field-label">Libellé</div>
            <input class="input" [ngModel]="store.ui().txLabel" (ngModelChange)="store.patch({ txLabel: $event })" placeholder="Ex : CB Remoulins Carrefour Marke" />
          </div>
          <div class="fnarrow">
            <div class="field-label">Montant €</div>
            <input class="input" [ngModel]="store.ui().txAmount" (ngModelChange)="store.patch({ txAmount: $event })" placeholder="84,30" inputmode="decimal" />
          </div>
        </div>
        <div class="frow">
          <div class="fgrow">
            <div class="field-label">Compte</div>
            <select class="input" [ngModel]="store.ui().txAccount" (ngModelChange)="store.patch({ txAccount: $event })">
              @for (a of store.activeAccounts(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
            </select>
          </div>
          <div class="fnarrow">
            <div class="field-label">Date</div>
            <input class="input" type="date" [ngModel]="store.ui().txDate" (ngModelChange)="store.patch({ txDate: $event })" />
          </div>
        </div>
        @if (store.ui().txSign === 'out') {
          <div class="field-label">Catégorie</div>
          <select class="input" [ngModel]="store.ui().txCategory" (ngModelChange)="store.patch({ txCategory: $event })">
            <option [ngValue]="null">Sans catégorie</option>
            @for (c of store.rootCategories(); track c.id) {
              <option [ngValue]="c.id">{{ c.name }}</option>
              @for (s of store.childrenOf(c.id); track s.id) { <option [ngValue]="s.id">&nbsp;&nbsp;{{ c.name }} · {{ s.name }}</option> }
            }
          </select>
        }
        <div class="field-label">Notes</div>
        <input class="input" [ngModel]="store.ui().txNotes" (ngModelChange)="store.patch({ txNotes: $event })" placeholder="Facultatif" />
        <label class="check">
          <input type="checkbox" [ngModel]="store.ui().txCleared" (ngModelChange)="store.patch({ txCleared: $event })" />
          <span>Opération pointée sur le relevé</span>
        </label>
        @if (store.ui().txId) {
          <div class="prov">
            @if (ruleName(); as r) {
              <span>Catégorie posée par la règle « {{ r }} ». La modifier ici la fige : les rejeux ne la toucheront plus.</span>
            } @else {
              <span>Catégorie choisie à la main. Les rejeux de règles la laisseront intacte.</span>
            }
            <button class="mkrule" (click)="store.ruleFromTx(store.ui().txId!)">Créer une règle à partir de cette opération</button>
          </div>
        }
        <div class="modal-acts">
          @if (store.ui().txId) {
            <button class="btn btn-danger" (click)="store.patch({ txDelId: store.ui().txId })"><f-icon name="trash" [size]="16" color="var(--primary)" /> Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ txForm: false })">Annuler</button>
          <button class="btn btn-primary" [disabled]="store.ui().busy" (click)="store.saveTx()">Enregistrer</button>
        </div>
      </f-modal>
    }

    @if (store.ui().txDelId) {
      <f-modal [maxWidth]="400" (close)="store.patch({ txDelId: null })">
        <div class="confirm">
          <div class="confirm-ic"><f-icon name="trash" [size]="26" color="var(--primary)" [width]="2" /></div>
          <div class="confirm-title f-display">Supprimer cette opération ?</div>
          <div class="confirm-txt">« {{ delLabel() }} » sera retirée définitivement. Les soldes de compte seront recalculés.</div>
          <div class="modal-acts">
            <button class="btn btn-soft grow" (click)="store.patch({ txDelId: null })">Annuler</button>
            <button class="btn btn-primary grow" (click)="store.confirmTxDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
    .spacer { flex: 1; }
    .sfield { display: flex; align-items: center; gap: 9px; background: var(--surface); border-radius: 13px; padding: 0 14px; height: 42px; flex: 1; min-width: 220px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .sinput { flex: 1; border: none; outline: none; background: transparent; font-size: 13.5px; font-weight: 700; color: var(--ink); font-family: inherit; min-width: 0; }
    .sinput::placeholder { color: var(--ink3); font-weight: 600; }
    .sel { height: 42px; padding: 0 12px; max-width: 230px; border: none; font-size: 13.5px; font-weight: 700; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .chip { height: 42px; padding: 0 15px; border-radius: 13px; border: none; background: var(--surface); font-size: 13px; font-weight: 800; color: var(--ink2); cursor: pointer; font-family: inherit; display: flex; align-items: center; gap: 6px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .chip.on { background: var(--primary); color: #fff; }
    .chip.clear { background: var(--soft2); box-shadow: none; }
    .count { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-bottom: 12px; }

    .tx-list { display: flex; flex-direction: column; gap: 10px; }
    .tx { display: flex; align-items: center; gap: 13px; background: var(--surface); border-radius: 16px; padding: 13px 16px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); cursor: pointer; }
    .tx:hover { background: var(--soft); }
    .tx-chip { width: 38px; height: 38px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
    .tx-body { flex: 1; min-width: 0; }
    .tx-name { font-weight: 800; font-size: 14.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tx-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 2px; }
    .tx-meta .muted { font-style: italic; }
    .tag { background: var(--soft2); border-radius: 20px; padding: 1px 8px; font-size: 10.5px; font-weight: 800; }
    .tx-amt { font-size: 15px; font-weight: 800; flex: none; font-variant-numeric: tabular-nums; }
    .tx-empty { background: var(--surface); border-radius: 16px; padding: 34px 24px; text-align: center; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .empty-title { font-size: 15px; font-weight: 800; color: var(--ink); }
    .empty-txt { font-size: 13px; font-weight: 700; color: var(--ink3); margin-top: 6px; }

    .pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 18px; font-size: 13px; font-weight: 800; color: var(--ink2); }
    .pg { width: 34px; height: 34px; border: none; border-radius: 11px; background: var(--surface); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .pg:disabled { opacity: .35; cursor: default; }

    .frow { display: flex; gap: 12px; }
    .fgrow { flex: 1; min-width: 0; }
    .fnarrow { width: 150px; flex: none; }
    @media (max-width: 520px) { .frow { flex-direction: column; } .fnarrow { width: 100%; } }
    .type-seg { margin-bottom: 18px; }
    .field-label { margin-top: 16px; }
    .frow .field-label { margin-top: 0; }
    .frow + .frow .field-label { margin-top: 16px; }
    .prov { margin-top: 18px; background: var(--soft); border-radius: 13px; padding: 12px 14px; font-size: 12.5px; font-weight: 700; color: var(--ink3); line-height: 1.5; }
    .mkrule { display: block; margin-top: 8px; border: none; border-radius: 10px; padding: 7px 13px; background: var(--soft2); font-size: 12.5px; font-weight: 800; color: var(--ink2); cursor: pointer; font-family: inherit; }
    .check { display: flex; align-items: center; gap: 10px; margin-top: 16px; font-size: 13.5px; font-weight: 700; color: var(--ink2); cursor: pointer; }
    .modal-acts { display: flex; gap: 12px; margin-top: 22px; align-items: center; }
    .modal-acts .spacer { flex: 1; }
    .modal-acts .grow { flex: 1; }
    .confirm { text-align: center; }
    .confirm-ic { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #FCE9E3; display: flex; align-items: center; justify-content: center; }
    .confirm-title { font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-txt { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 0; }
  `],
})
export class FinancesTransactionsTab {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  CAT_ICONS = CAT_ICONS;
  fmt = fmtEuros;
  abs = Math.abs;

  delLabel = computed(() => this.store.transactions().find((t) => t.id === this.store.ui().txDelId)?.label || '');

  /** Name of the rule that decided this row's category, when a rule did. */
  ruleName = computed(() => {
    const id = this.store.transactions().find((t) => t.id === this.store.ui().txId)?.ruleId;
    return id ? this.store.rules().find((r) => r.id === id)?.name || '' : '';
  });
}
