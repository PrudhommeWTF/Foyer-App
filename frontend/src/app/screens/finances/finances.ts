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

type TabId = 'transactions' | 'bilan' | 'comptes' | 'categories' | 'contrats' | 'regles' | 'import';
/**
 * Les onglets rangés en trois familles : « Suivi » (l'argent au quotidien),
 * « Organisation » (les structures qui classent) et « Données » (ce qui entre et
 * sort). La barre les affiche par grappes, séparées d'un filet, chacune coiffée
 * d'un petit intitulé, pour qu'une rangée de sept ne se lise plus d'un bloc.
 */
const GROUPS: { label: string; tabs: { id: TabId; label: string }[] }[] = [
  { label: 'Suivi', tabs: [
    { id: 'transactions', label: 'Opérations' },
    { id: 'bilan', label: 'Bilan' },
    { id: 'comptes', label: 'Comptes' },
  ] },
  { label: 'Organisation', tabs: [
    { id: 'categories', label: 'Catégories' },
    { id: 'contrats', label: 'Contrats' },
    { id: 'regles', label: 'Règles' },
  ] },
  { label: 'Données', tabs: [
    { id: 'import', label: 'Import' },
  ] },
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
      </div>

      @if (store.error(); as err) {
        <div class="banner err">
          <f-icon name="urgent" [size]="18" color="var(--primary)" [width]="2.2" />
          <span>{{ err }}</span>
          <button class="banner-act" (click)="reload()">Réessayer</button>
        </div>
      }

      <div class="tabgroups">
        @for (g of groups; track g.label; let last = $last) {
          <div class="tabgroup">
            <span class="tg-label">{{ g.label }}</span>
            <div class="seg">
              @for (t of g.tabs; track t.id) {
                <button [class.active]="store.ui().tab === t.id" (click)="store.patch({ tab: t.id })">{{ t.label }}</button>
              }
            </div>
          </div>
          @if (!last) { <span class="tg-div"></span> }
        }
      </div>

      @if (store.ui().tab === 'transactions' || store.ui().tab === 'bilan') {
        <div class="synth">
          <div class="synth-top">
            <div class="nav">
              <button class="nav-btn" (click)="store.prevMonth()" aria-label="Mois précédent"><f-icon name="chevronLeft" [size]="17" color="var(--ink2)" [width]="2.2" /></button>
              <div class="nav-label">
                <div class="nav-month f-display">{{ store.monthLabel() }}</div>
                <div class="nav-tag">{{ store.isCurrentMonth() ? 'Ce mois-ci' : 'Historique' }}</div>
              </div>
              <button class="nav-btn" (click)="store.nextMonth()" aria-label="Mois suivant"><f-icon name="chevronRight" [size]="17" color="var(--ink2)" [width]="2.2" /></button>
            </div>
          </div>
          @if (store.summary(); as s) {
            <div class="overline">Dépenses du mois</div>
            <div class="big f-display">{{ fmtInt(s.expense) }} €</div>
            <div class="sub">{{ s.budgetTotal > 0 ? 'sur ' + fmtInt(s.budgetTotal) + ' € de budget de référence' : 'aucun budget de référence défini' }}</div>
            <div class="mini">
              <div class="stat"><div class="overline">Ressources</div><div class="mini-val pos f-display">+{{ fmtInt(s.income) }} €</div></div>
              <div class="stat"><div class="overline">Dépenses</div><div class="mini-val neg f-display">−{{ fmtInt(s.expense) }} €</div></div>
              <div class="stat"><div class="overline">Solde</div><div class="mini-val f-display" [class.pos]="s.balance >= 0" [class.neg]="s.balance < 0">{{ s.balance > 0 ? '+' : '' }}{{ fmtInt(s.balance) }} €</div></div>
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
    /* Les onglets par familles : chaque grappe porte son intitulé, un filet les
       sépare. Sur téléphone, les grappes passent à la ligne, chacune restant
       lisible. */
    .tabgroups { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 16px; margin-bottom: 20px; }
    .tabgroup { display: flex; align-items: center; gap: 10px; }
    .tg-label { font-size: 10px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .07em; white-space: nowrap; }
    .tg-div { width: 1px; align-self: stretch; min-height: 28px; background: var(--line); }
    @media (max-width: 720px) { .tg-div { display: none; } .tabgroups { gap: 8px 12px; } }

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

    /* Le résumé du mois : une carte claire, comme le reste de l'app (mêmes jetons
       d'ombre et de rayon), et non plus un bloc sombre à part. Les trois chiffres
       tiennent dans des tuiles douces, avec le vert « entrée » et le rouge
       « sortie » communs à l'accueil. */
    .synth { background: var(--surface); border-radius: var(--r-card-lg, 24px); padding: 24px 26px; color: var(--ink); margin-bottom: 18px; box-shadow: var(--sh-card); }
    .synth-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .nav { display: flex; align-items: center; gap: 12px; }
    .nav-btn { width: 38px; height: 38px; border: none; border-radius: 12px; background: var(--soft); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .nav-btn:hover { background: var(--soft2); }
    .nav-label { min-width: 150px; }
    .nav-month { font-size: 20px; font-weight: 700; color: var(--ink); text-transform: capitalize; }
    .nav-tag { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; }
    .overline { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; }
    .big { font-size: 44px; font-weight: 700; color: var(--ink); margin: 6px 0 2px; }
    .sub { font-size: 13.5px; font-weight: 700; color: var(--ink3); }
    .sub.loading { padding: 14px 0; }
    .mini { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
    .stat { flex: 1; min-width: 130px; background: var(--soft); border-radius: 14px; padding: 12px 14px; }
    .mini-val { font-size: 20px; font-weight: 700; color: var(--ink); margin-top: 3px; }
    .mini-val.pos { color: #5F9A55; }
    .mini-val.neg { color: #C2503A; }
    @media (max-width: 640px) { .big { font-size: 36px; } .synth { padding: 20px; } }
  `],
})
export class FinancesScreen {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  groups = GROUPS;
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
