import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FinancesStore, fmtEurosInt } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { FinancesTransactionsTab } from './transactions-tab';
import { FinancesDashboardTab } from './dashboard-tab';
import { FinancesAccountsTab } from './accounts-tab';
import { FinancesCategoriesTab } from './categories-tab';
import { FinancesContractsTab } from './contracts-tab';
import { FinancesRulesTab } from './rules-tab';
import { FinancesImportTab } from './import-tab';

const TABS: { id: 'transactions' | 'bilan' | 'comptes' | 'categories' | 'contrats' | 'regles' | 'import'; label: string }[] = [
  { id: 'transactions', label: 'Opérations' },
  { id: 'bilan', label: 'Bilan' },
  { id: 'comptes', label: 'Comptes' },
  { id: 'categories', label: 'Catégories' },
  { id: 'contrats', label: 'Contrats' },
  { id: 'regles', label: 'Règles' },
  { id: 'import', label: 'Import' },
];

@Component({
  selector: 'screen-finances',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FinancesTransactionsTab, FinancesDashboardTab, FinancesAccountsTab, FinancesCategoriesTab, FinancesContractsTab, FinancesRulesTab, FinancesImportTab],
  template: `
    <div class="screen-enter">
      <div class="screen-head">
        <div>
          <div class="screen-title f-display">Finances</div>
          <div class="screen-sub">{{ accountCount() }} · {{ store.total() }} opération{{ store.total() > 1 ? 's' : '' }} sur la période</div>
        </div>
        <button class="btn btn-soft" (click)="store.exportCsv()"><f-icon name="export" [size]="17" color="var(--ink2)" /> Exporter en CSV</button>
      </div>

      @if (store.error(); as err) {
        <div class="banner err">
          <f-icon name="urgent" [size]="18" color="var(--primary)" [width]="2.2" />
          <span>{{ err }}</span>
          <button class="banner-act" (click)="reload()">Réessayer</button>
        </div>
      }

      <div class="seg tabs">
        @for (t of tabs; track t.id) {
          <button [class.active]="store.ui().tab === t.id" (click)="store.patch({ tab: t.id })">{{ t.label }}</button>
        }
      </div>

      @if (store.ui().tab === 'transactions' || store.ui().tab === 'bilan') {
        <div class="synth">
          <div class="synth-top">
            <div class="nav">
              <button class="nav-btn" (click)="store.prevMonth()" aria-label="Mois précédent"><f-icon name="chevronLeft" [size]="17" color="#fff" [width]="2.2" /></button>
              <div class="nav-label">
                <div class="nav-month f-display">{{ store.monthLabel() }}</div>
                <div class="nav-tag">{{ store.isCurrentMonth() ? 'Ce mois-ci' : 'Historique' }}</div>
              </div>
              <button class="nav-btn" (click)="store.nextMonth()" aria-label="Mois suivant"><f-icon name="chevronRight" [size]="17" color="#fff" [width]="2.2" /></button>
            </div>
          </div>
          @if (store.summary(); as s) {
            <div class="overline light">Dépenses du mois</div>
            <div class="big f-display">{{ fmtInt(s.expense) }} €</div>
            <div class="sub">{{ s.budgetTotal > 0 ? 'sur ' + fmtInt(s.budgetTotal) + ' € de budget de référence' : 'aucun budget de référence défini' }}</div>
            <div class="mini">
              <div><div class="overline light">Ressources</div><div class="mini-val f-display" style="color:#8FBF86">+{{ fmtInt(s.income) }} €</div></div>
              <div><div class="overline light">Dépenses</div><div class="mini-val f-display" style="color:#F0A98B">−{{ fmtInt(s.expense) }} €</div></div>
              <div><div class="overline light">Solde</div><div class="mini-val f-display" [style.color]="s.balance >= 0 ? '#8FBF86' : '#F0A98B'">{{ s.balance > 0 ? '+' : '' }}{{ fmtInt(s.balance) }} €</div></div>
            </div>
          } @else {
            <div class="sub loading">Chargement…</div>
          }
        </div>

        <!-- Un mois incomplet produit des chiffres plausibles mais faux : on le dit. -->
        @if (store.summary()?.incomplete) {
          <div class="banner warn">
            <f-icon name="urgent" [size]="18" color="#B8860B" [width]="2.2" />
            <div>
              <div class="banner-title">Mois incomplet, les chiffres ci-dessus sont sous-estimés</div>
              <div class="banner-txt">
                @for (g of missingGroups(); track g.date) {
                  <span class="miss">{{ g.label }} : données jusqu'au {{ g.date }}</span>
                }
              </div>
              <div class="banner-hint">Importez les relevés manquants (onglet Import), ou archivez le compte s'il n'est plus suivi.</div>
            </div>
          </div>
        }

        @if (store.ui().tab === 'bilan') { <fin-dashboard-tab /> } @else { <fin-transactions-tab /> }
      } @else if (store.ui().tab === 'comptes') {
        <fin-accounts-tab />
      } @else if (store.ui().tab === 'categories') {
        <fin-categories-tab />
      } @else if (store.ui().tab === 'contrats') {
        <fin-contracts-tab />
      } @else if (store.ui().tab === 'regles') {
        <fin-rules-tab />
      } @else {
        <fin-import-tab />
      }
    </div>
  `,
  styles: [`
    .screen-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
    .screen-title { font-size: 30px; font-weight: 700; color: var(--ink); }
    .tabs { margin-bottom: 20px; }

    .banner { display: flex; align-items: flex-start; gap: 12px; border-radius: 16px; padding: 14px 16px; margin-bottom: 18px; font-size: 13.5px; font-weight: 700; }
    .banner.warn { background: #FDF0DA; color: #7A5C12; }
    .banner.err { background: #FCE9E3; color: #8C3B26; align-items: center; }
    :host-context(.dark) .banner.warn { background: #3A3123; color: #E8C88A; }
    :host-context(.dark) .banner.err { background: #3A2622; color: #F0A98B; }
    .banner-title { font-weight: 800; margin-bottom: 4px; }
    .banner-txt { display: flex; flex-wrap: wrap; gap: 6px 14px; }
    .miss { font-weight: 700; }
    .banner-hint { margin-top: 6px; font-size: 12.5px; font-weight: 700; opacity: .8; }
    .banner-act { margin-left: auto; background: rgba(0,0,0,.08); border: none; border-radius: 10px; padding: 7px 13px; font-size: 12.5px; font-weight: 800; color: inherit; cursor: pointer; font-family: inherit; }

    .synth { background: linear-gradient(135deg, #3A302A, #5A4A3E); border-radius: 24px; padding: 28px; color: #fff; margin-bottom: 18px; box-shadow: 0 18px 34px -18px rgba(58,48,42,.6); }
    .synth-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .nav { display: flex; align-items: center; gap: 12px; }
    .nav-btn { width: 36px; height: 36px; border: none; border-radius: 11px; background: rgba(255,255,255,.14); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .nav-label { text-align: center; min-width: 170px; }
    .nav-month { font-size: 19px; font-weight: 700; }
    .nav-tag { font-size: 11px; font-weight: 800; opacity: .6; text-transform: uppercase; letter-spacing: .05em; }
    .overline.light { opacity: .65; }
    .big { font-size: 46px; font-weight: 700; margin: 8px 0 4px; }
    .sub { font-size: 14px; font-weight: 700; opacity: .7; }
    .sub.loading { padding: 14px 0; }
    .mini { display: flex; gap: 26px; margin-top: 20px; flex-wrap: wrap; }
    .mini-val { font-size: 20px; font-weight: 700; }
    @media (max-width: 640px) { .big { font-size: 36px; } .synth { padding: 20px; } }
  `],
})
export class FinancesScreen {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  tabs = TABS;
  fmtInt = fmtEurosInt;

  constructor() { void this.store.init(); }

  reload(): void { void this.store.init(true); }

  /**
   * Ten accounts stopping on the same day is one fact, not ten lines. Accounts are
   * grouped by the date their data stops at, and only listed by name when there
   * are few enough for the list to stay readable.
   */
  missingGroups = computed(() => {
    const missing = this.store.summary()?.missing ?? [];
    const byDate = new Map<string, string[]>();
    for (const m of missing) {
      const date = this.foyer.fmtNumDate(m.coveredThrough || '');
      const list = byDate.get(date);
      if (list) list.push(m.name); else byDate.set(date, [m.name]);
    }
    return [...byDate.entries()].map(([date, names]) => ({
      date,
      label: names.length > 3 ? `${names.length} comptes` : names.join(', '),
    }));
  });

  accountCount = computed(() => {
    const n = this.store.activeAccounts().length;
    return n ? `${n} compte${n > 1 ? 's' : ''} actif${n > 1 ? 's' : ''}` : 'Aucun compte';
  });
}
