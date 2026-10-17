import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinTransaction } from '../../core/finances.api';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ConfirmComponent } from '../../shared/confirm';
import { SheetComponent } from '../../shared/sheet';
import { CAT_ICONS } from '../../core/constants';
import { FinTxForm } from './tx-form';

/**
 * Opérations : la recherche (libellé ou montant, toutes périodes), les filtres
 * en pastilles, le tableau groupé par jour et, à côté, la fiche de l'opération
 * ouverte. Sur téléphone, la fiche monte dans un panneau.
 */
@Component({
  selector: 'fin-transactions-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ConfirmComponent, SheetComponent, FinTxForm],
  template: `
    @let u = store.ui();
    <div class="bar">
      <div class="sfield">
        <f-icon name="search" [size]="17" color="var(--ink3)" [width]="2.2" />
        <input class="sinput" [ngModel]="u.fltQuery" (ngModelChange)="store.setFilter({ fltQuery: $event })"
               placeholder="Rechercher un libellé, un montant (toutes périodes)" aria-label="Rechercher" />
      </div>
      <select class="input sel" [ngModel]="u.fltAccount" (ngModelChange)="store.setFilter({ fltAccount: $event })" aria-label="Compte">
        <option [ngValue]="null">Tous les comptes</option>
        @for (a of store.ledgerAccounts(); track a.id) { <option [ngValue]="a.id">{{ a.name }}{{ a.archived ? ' (archivé)' : '' }}</option> }
      </select>
      <select class="input sel" [ngModel]="u.fltCategory" (ngModelChange)="store.setFilter({ fltCategory: $event })" aria-label="Catégorie">
        <option [ngValue]="null">Toutes les catégories</option>
        @for (c of store.rootCategories(); track c.id) {
          <option [ngValue]="c.id">{{ c.name }}</option>
          @for (s of store.childrenOf(c.id); track s.id) { <option [ngValue]="s.id">&nbsp;&nbsp;{{ c.name }} · {{ s.name }}</option> }
        }
      </select>
      <button class="btn btn-soft" (click)="store.goTab('organiser', 'import')"><f-icon name="download" [size]="15" color="var(--ink2)" [width]="2.4" /> Importer un relevé</button>
      <button class="btn btn-primary" (click)="store.newTx()"><f-icon name="plus" [size]="16" color="#fff" [width]="2.6" /> Opération</button>
    </div>

    <div class="pills">
      <button class="pill" [class.on]="u.fltUncategorised" [attr.aria-pressed]="u.fltUncategorised"
              (click)="store.setFilter({ fltUncategorised: !u.fltUncategorised })">Sans catégorie · {{ store.toClassify().length }}</button>
      <button class="pill" [class.on]="u.fltUncleared" [attr.aria-pressed]="u.fltUncleared"
              (click)="store.setFilter({ fltUncleared: !u.fltUncleared })">Non pointées · {{ store.unclearedCount() }}</button>
      @if (u.fltTag; as tag) {
        <button class="pill on" (click)="store.setFilter({ fltTag: '' })" [attr.aria-label]="'Retirer le filtre étiquette ' + tag">Étiquette « {{ tag }} » <f-icon name="x" [size]="13" color="currentColor" [width]="2.6" /></button>
      }
      @if (u.fltContract; as cid) {
        <button class="pill on" (click)="store.setFilter({ fltContract: null })" [attr.aria-label]="'Retirer le filtre contrat'">Contrat « {{ store.contractName(cid) }} » <f-icon name="x" [size]="13" color="currentColor" [width]="2.6" /></button>
      }
      @if (store.hasFilters()) { <button class="pill clear" (click)="store.clearFilters()">Effacer</button> }
    </div>

    @if (store.hasFilters()) {
      <div class="count">{{ store.total() }} opération{{ store.total() > 1 ? 's' : '' }} correspond{{ store.total() > 1 ? 'ent' : '' }}{{ store.spansHistory() ? ', toutes périodes confondues' : '' }}</div>
    }

    <div class="main" [class.with-form]="u.txForm && !foyer.narrow()">
      <div class="list card">
        @if (days().length) {
          @if (!foyer.narrow()) {
            <div class="row head" aria-hidden="true"><span>Libellé</span><span>Catégorie</span><span>Compte</span><span></span><span class="num">Montant</span></div>
          }
          @for (d of days(); track d.date) {
            <div class="day"><span>{{ d.label }}</span><span class="num">{{ d.total ? signed(d.total) : '' }}</span></div>
            @for (t of d.rows; track t.id) {
              <button type="button" class="row" [class.picked]="u.txForm && u.txId === t.id" (click)="store.editTx(t.id)">
                <span class="l">
                  <b>{{ t.label }}</b>
                  @if (t.labelRaw && t.labelRaw !== t.label) { <small>{{ t.labelRaw }}</small> }
                  @if (foyer.narrow()) { <small class="acc-m">{{ accountOf(t) }}</small> }
                </span>
                <span class="c">
                  @if (t.kind === 'virement') {
                    <span class="cp transfer"><span aria-hidden="true">⇄</span> Virement interne</span>
                  } @else if (t.amount > 0) {
                    <span class="cp income">Recette</span>
                  } @else if (t.categoryId) {
                    <span class="cp" [style.background]="foyer.tint(store.categoryColor(t.categoryId))">
                      <f-icon [path]="CAT_ICONS[store.categoryIcon(t.categoryId)] || CAT_ICONS['facture']" [size]="12" [color]="store.categoryColor(t.categoryId)" [width]="2.4" />
                      {{ store.categoryPath(t.categoryId) }}
                    </span>
                  } @else {
                    <span class="cp warn">À classer</span>
                  }
                  @if (store.contractName(t.contractId); as cn) { <span class="tagx">{{ cn }}</span> }
                  @for (g of t.tags; track g) { <span class="tagx">{{ g }}</span> }
                </span>
                @if (!foyer.narrow()) { <span class="a">{{ accountOf(t) }}</span> }
                <span class="ck">
                  @if (t.cleared) { <span class="ckm" title="Pointée" aria-label="Pointée"><f-icon name="check" [size]="11" color="#fff" [width]="3.4" /></span> }
                </span>
                <span class="num amt" [class.pos]="t.amount > 0">{{ t.amount > 0 ? '+' : '−' }}{{ fmt(abs(t.amount)) }} €</span>
              </button>
            }
          }
        } @else {
          <div class="tx-empty">
            @if (!store.activeLedgerAccounts().length) {
              <div class="empty-title">Aucun compte pour l'instant</div>
              <div class="empty-txt">Créez vos comptes dans l'espace « Comptes », puis saisissez ou importez vos opérations.</div>
            } @else if (store.hasFilters()) {
              <div class="empty-title">Aucune opération ne correspond</div>
              <div class="empty-txt">Élargissez la recherche ou effacez les filtres.</div>
            } @else {
              <div class="empty-title">Aucune opération en {{ store.monthLabel().toLowerCase() }}</div>
              <div class="empty-txt">Changez de mois, ou ajoutez une opération.</div>
            }
          </div>
        }
        <div class="foot">
          <span>{{ store.total() }} opération{{ store.total() > 1 ? 's' : '' }} · page {{ u.page + 1 }} sur {{ store.pageCount() }}</span>
          @if (store.pageCount() > 1) {
            <span class="pager">
              <button class="pg" [disabled]="u.page === 0" (click)="store.goPage(u.page - 1)" aria-label="Page précédente"><f-icon name="chevronLeft" [size]="15" color="var(--ink2)" [width]="2.4" /></button>
              <button class="pg" [disabled]="u.page + 1 >= store.pageCount()" (click)="store.goPage(u.page + 1)" aria-label="Page suivante"><f-icon name="chevronRight" [size]="15" color="var(--ink2)" [width]="2.4" /></button>
            </span>
          }
          <span class="spacer"></span>
          @if (foyer.isAdmin()) { <button class="link" (click)="store.exportCsv()">Export CSV</button> }
        </div>
      </div>

      @if (u.txForm && !foyer.narrow()) {
        <aside class="side card" aria-label="Fiche de l'opération">
          <div class="kicker">{{ u.txId ? 'Opération · ' + shortDate(u.txDate) : 'Nouvelle opération' }}</div>
          <h2 class="side-title f-display">{{ u.txLabel || 'Sans libellé' }}</h2>
          <fin-tx-form />
        </aside>
      }
    </div>

    @if (u.txForm && foyer.narrow()) {
      <f-sheet [heading]="u.txId ? (u.txLabel || 'Opération') : 'Nouvelle opération'" [kicker]="u.txId ? 'Opération · ' + shortDate(u.txDate) : ''"
               [full]="true" (close)="store.patch({ txForm: false, txId: null })" (back)="store.patch({ txForm: false, txId: null })">
        <fin-tx-form />
      </f-sheet>
    }

    @if (u.txDelId) {
      <f-confirm title="Supprimer cette opération ?" (cancel)="store.patch({ txDelId: null })" (confirm)="store.confirmTxDel()">
        « {{ delLabel() }} » sera retirée définitivement, avec ses justificatifs. Les soldes de compte seront recalculés.
      </f-confirm>
    }
  `,
  styles: [`
    :host { display: block; }
    .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .sfield { display: flex; align-items: center; gap: 9px; background: var(--surface); border-radius: 13px; padding: 0 14px; height: 42px; flex: 1; min-width: 220px; box-shadow: var(--sh-card); }
    .sinput { flex: 1; border: none; outline: none; background: transparent; font-size: 13.5px; font-weight: 700; color: var(--ink); font-family: inherit; min-width: 0; }
    .sinput::placeholder { color: var(--ink3); font-weight: 600; }
    .sel { height: 42px; padding: 0 12px; max-width: 230px; border: none; font-size: 13.5px; font-weight: 700; box-shadow: var(--sh-card); }
    @media (max-width: 860px) { .sel { flex: 1 1 140px; max-width: none; } .bar .btn { flex: 1 1 auto; justify-content: center; } }
    .pills { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; border: none; border-radius: 11px; padding: 7px 12px; background: var(--surface); color: var(--ink2); font-family: inherit; font-size: 13px; font-weight: 800; cursor: pointer; box-shadow: var(--sh-card); }
    .pill.on { background: var(--ink); color: var(--surface); }
    .pill.clear { background: none; box-shadow: none; color: var(--ink3); }
    .count { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-bottom: 12px; }

    .main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
    .main.with-form { grid-template-columns: minmax(0, 1.55fr) minmax(320px, 1fr); }
    .card { background: var(--surface); border-radius: var(--r-card-lg); box-shadow: var(--sh-card); }
    .list { padding: 8px 14px 4px; min-width: 0; }
    .row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.5fr) minmax(0, .9fr) 26px 110px; align-items: center; gap: 12px;
      width: 100%; border: none; background: none; text-align: left; font-family: inherit; padding: 10px 8px; border-bottom: 1px solid var(--line); cursor: pointer; color: var(--ink); }
    .row:hover, .row:focus-visible { background: var(--soft); }
    .row.picked { background: color-mix(in srgb, var(--primary) 8%, transparent); }
    .row.head { cursor: default; font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); padding-top: 8px; }
    .row.head:hover { background: none; }
    .day { display: flex; justify-content: space-between; background: var(--soft); padding: 6px 8px; font-size: 11.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--ink2); border-bottom: 1px solid var(--line); }
    .l { display: flex; flex-direction: column; min-width: 0; }
    .l b { font-size: 14px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .l small { font-size: 11.5px; font-weight: 700; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: uppercase; }
    .l small.acc-m { text-transform: none; }
    .c { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; min-width: 0; }
    .cp { display: inline-flex; align-items: center; gap: 5px; border-radius: 9px; padding: 3px 9px; font-size: 12px; font-weight: 800; color: var(--ink); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cp.warn { background: var(--status-warn-bg); color: var(--status-warn); }
    .cp.transfer { background: var(--tint-blue); }
    .cp.income { background: var(--tint-sage); color: var(--status-good); }
    .tagx { background: var(--soft2); color: var(--ink2); border-radius: 8px; padding: 2px 7px; font-size: 11px; font-weight: 800; }
    .a { font-size: 13px; font-weight: 700; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; }
    .ck { display: flex; justify-content: center; }
    .ckm { width: 18px; height: 18px; border-radius: 5px; background: var(--sage-dark); display: grid; place-items: center; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .amt { font-size: 14px; font-weight: 800; }
    .amt.pos { color: var(--status-good); }
    @media (max-width: 860px) {
      .list { padding: 6px 10px 4px; }
      .row { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'l amt' 'c ck'; row-gap: 5px; padding: 10px 4px; }
      .l { grid-area: l; } .c { grid-area: c; } .ck { grid-area: ck; justify-content: flex-end; } .amt { grid-area: amt; }
    }
    .foot { display: flex; align-items: center; gap: 12px; padding: 12px 8px; font-size: 12.5px; font-weight: 700; color: var(--ink2); flex-wrap: wrap; }
    .pager { display: inline-flex; gap: 6px; }
    .pg { width: 30px; height: 30px; border: none; border-radius: 9px; background: var(--soft2); display: grid; place-items: center; cursor: pointer; }
    .pg:disabled { opacity: .35; cursor: default; }
    .spacer { flex: 1; }
    .link { border: none; background: none; font-family: inherit; font-size: 12.5px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .tx-empty { padding: 34px 16px; text-align: center; }
    .empty-title { font-size: 15px; font-weight: 800; color: var(--ink); }
    .empty-txt { font-size: 13px; font-weight: 700; color: var(--ink3); margin-top: 6px; }

    .side { padding: 20px 22px; position: sticky; top: 12px; max-height: calc(100vh - 120px); overflow-y: auto; }
    .kicker { font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); }
    .side-title { margin: 4px 0 6px; font-size: 22px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
  `],
})
export class FinancesTransactionsTab {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  CAT_ICONS = CAT_ICONS;
  fmt = fmtEuros;
  abs = Math.abs;

  delLabel = computed(() => this.store.transactions().find((t) => t.id === this.store.ui().txDelId)?.label || '');

  /** La page, groupée par jour avec le total du jour (virements internes exclus). */
  readonly days = computed(() => {
    const out: { date: string; label: string; total: number; rows: FinTransaction[] }[] = [];
    for (const t of this.store.transactions()) {
      let d = out[out.length - 1];
      if (!d || d.date !== t.date) { d = { date: t.date, label: this.dayLabel(t.date), total: 0, rows: [] }; out.push(d); }
      d.rows.push(t);
      if (t.kind !== 'virement') d.total += t.amount;
    }
    return out;
  });

  /** « Compte joint », ou « Compte joint → Livret A » pour un virement. */
  accountOf(t: FinTransaction): string {
    const a = this.store.accountName(t.accountId);
    if (t.kind !== 'virement' || !t.transferAccountId) return a;
    const b = this.store.accountName(t.transferAccountId);
    return t.amount < 0 ? `${a} → ${b}` : `${b} → ${a}`;
  }

  signed(cents: number): string { return (cents > 0 ? '+' : '−') + fmtEuros(Math.abs(cents)) + ' €'; }

  /** « Ven. 17 oct. » ; l'année seulement quand ce n'est pas celle d'aujourd'hui. */
  private dayLabel(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    const sameYear = String(y) === this.foyer.todayStr().slice(0, 4);
    const s = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC', ...(sameYear ? {} : { year: 'numeric' }) });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  shortDate(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
}
