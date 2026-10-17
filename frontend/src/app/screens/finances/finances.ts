import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FinOrgTab, FinTab, FinancesStore } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { FinancesTransactionsTab } from './transactions-tab';
import { FinancesTendances } from './tendances';
import { FinancesApercu } from './apercu';
import { FinancesAccountsTab } from './accounts-tab';
import { FinancesCategoriesTab } from './categories-tab';
import { FinancesContractsTab } from './contracts-tab';
import { FinancesRulesTab } from './rules-tab';
import { FinancesImportTab } from './import-tab';
import { FinancesDataTab } from './data-tab';
import { FinMonthNav } from './month-nav';
import { FinEnvelopeSheet } from './envelope-sheet';
import { AlertComponent } from '../../shared/alert';
import { SheetComponent } from '../../shared/sheet';
import { eur } from './charts/tip';

/** Les espaces du sélecteur. Sur téléphone, les trois premiers ; le reste passe par « ⋯ ». */
const TABS: { id: FinTab; label: string }[] = [
  { id: 'apercu', label: 'Aperçu' },
  { id: 'operations', label: 'Opérations' },
  { id: 'tendances', label: 'Tendances' },
  { id: 'comptes', label: 'Comptes' },
  { id: 'contrats', label: 'Contrats' },
];
const ORG_TABS: { id: FinOrgTab; label: string }[] = [
  { id: 'categories', label: 'Catégories' },
  { id: 'regles', label: 'Règles' },
  { id: 'import', label: 'Import' },
  { id: 'donnees', label: 'Données' },
];

@Component({
  selector: 'screen-finances',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent, AlertComponent, SheetComponent, FinMonthNav, FinEnvelopeSheet, FinancesApercu, FinancesTransactionsTab, FinancesTendances,
    FinancesAccountsTab, FinancesCategoriesTab, FinancesContractsTab, FinancesRulesTab, FinancesImportTab, FinancesDataTab,
  ],
  template: `
    <div class="screen-enter">
      <div class="screen-head">
        @if (!foyer.narrow()) {
          <div>
            <div class="screen-title f-display">Finances</div>
            <div class="screen-sub">{{ accountCount() }} · {{ store.total() }} opération{{ store.total() > 1 ? 's' : '' }} sur la période</div>
          </div>
        }
        <div class="seg spaces" role="tablist" aria-label="Espaces des finances">
          @for (t of tabs(); track t.id) {
            <button role="tab" [attr.aria-selected]="ui().tab === t.id" [class.active]="ui().tab === t.id" (click)="store.goTab(t.id)">{{ t.label }}</button>
          }
          @if (foyer.narrow()) {
            <button role="tab" [attr.aria-selected]="inMenu()" [class.active]="inMenu()" aria-label="Autres espaces : comptes, contrats, organiser"
                    (click)="openMenu()">⋯</button>
          } @else {
            <button role="tab" [attr.aria-selected]="ui().tab === 'organiser'" [class.active]="ui().tab === 'organiser'"
                    aria-label="Organiser : catégories, règles, import, données" title="Organiser" (click)="store.goTab('organiser')">
              <f-icon name="gear" [size]="17" [width]="2.2" />
            </button>
          }
        </div>
      </div>

      @if (store.error(); as err) {
        <f-alert kind="error" class="mb">
          <div class="al-row"><span>{{ err }}</span><button class="banner-act" (click)="reload()">Réessayer</button></div>
        </f-alert>
      }

      @switch (ui().tab) {
        @case ('apercu') { <fin-apercu /> }
        @case ('operations') {
          <fin-month-nav />
          <!-- Un mois incomplet produit des chiffres plausibles mais faux : on le dit. -->
          @if (store.summary()?.incomplete) {
            <f-alert kind="warn" class="mb">
              <div class="banner-title">Mois incomplet : il manque des opérations</div>
              <div class="banner-txt">
                @for (g of missingGroups(); track g.date) { <span class="miss">{{ g.label }} : données jusqu'au {{ g.date }}</span> }
              </div>
              <div class="banner-hint">Importez les relevés manquants (Organiser › Import), ou archivez le compte s'il n'est plus suivi.</div>
            </f-alert>
          }
          <fin-transactions-tab />
        }
        @case ('tendances') { <fin-tendances /> }
        @case ('comptes') { <fin-accounts-tab /> }
        @case ('contrats') { <fin-contracts-tab /> }
        @case ('organiser') {
          <div class="seg org" role="tablist" aria-label="Organiser">
            @for (t of orgTabs; track t.id) {
              <button role="tab" [attr.aria-selected]="ui().orgTab === t.id" [class.active]="ui().orgTab === t.id" (click)="store.goTab('organiser', t.id)">{{ t.label }}</button>
            }
          </div>
          @switch (ui().orgTab) {
            @case ('categories') { <fin-categories-tab /> }
            @case ('regles') { <fin-rules-tab /> }
            @case ('import') { <fin-import-tab /> }
            @case ('donnees') { <fin-data-tab /> }
          }
        }
      }
    </div>

    @if (ui().envId) { <fin-envelope-sheet /> }

    @if (ui().menuOpen) {
      <f-sheet heading="Finances" (close)="store.patch({ menuOpen: false })" (back)="store.patch({ menuOpen: false })">
        @for (m of menu(); track m.label) {
          <button class="mi" (click)="store.goTab(m.tab, m.org)">
            <span class="mi-ic" [style.background]="m.bg"><f-icon [name]="m.icon" [size]="19" [color]="m.color" /></span>
            <span class="mi-t"><b>{{ m.label }}</b><small>{{ m.sub }}</small></span>
          </button>
        }
      </f-sheet>
    }
  `,
  styles: [`
    .screen-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
    .screen-title { font-size: 30px; font-weight: 700; color: var(--ink); }
    .spaces { flex-wrap: nowrap; }
    .spaces button { white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; }
    @media (max-width: 860px) {
      .screen-head { margin-bottom: 16px; }
      .spaces { width: 100%; }
      .spaces button { flex: 1; padding-left: 6px; padding-right: 6px; }
      .spaces button:last-child { flex: 0 0 48px; }
    }
    .org { margin-bottom: 18px; }

    f-alert.mb { display: block; margin-bottom: 18px; }
    .al-row { display: flex; align-items: center; gap: 12px; width: 100%; }
    .banner-title { font-weight: 800; margin-bottom: 4px; }
    .banner-txt { display: flex; flex-wrap: wrap; gap: 6px 14px; }
    .miss { font-weight: 700; }
    .banner-hint { margin-top: 6px; font-size: 12.5px; font-weight: 700; opacity: .8; }
    .banner-act { margin-left: auto; background: rgba(0,0,0,.08); border: none; border-radius: 10px; padding: 7px 13px; font-size: 12.5px; font-weight: 800; color: inherit; cursor: pointer; font-family: inherit; }

    .mi { display: flex; align-items: center; gap: 14px; width: 100%; border: none; background: none; padding: 12px 2px; border-top: 1px solid var(--line); cursor: pointer; text-align: left; font-family: inherit; }
    .mi:first-child { border-top: none; }
    .mi-ic { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; flex: none; }
    .mi-t { display: flex; flex-direction: column; min-width: 0; }
    .mi-t b { font-size: 16px; font-weight: 800; color: var(--ink); }
    .mi-t small { font-size: 13px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
  `],
})
export class FinancesScreen {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  readonly ui = this.store.ui;
  readonly orgTabs = ORG_TABS;

  constructor() { void this.store.init(); }

  reload(): void { void this.store.init(true); }

  readonly tabs = computed(() => (this.foyer.narrow() ? TABS.slice(0, 3) : TABS));
  /** Sur téléphone, « ⋯ » est actif quand on est dans un des espaces qu'il ouvre. */
  readonly inMenu = computed(() => ['comptes', 'contrats', 'organiser'].includes(this.ui().tab));

  openMenu(): void {
    this.store.patch({ menuOpen: true });
    if (!this.store.imports().length) void this.store.loadImports();
  }

  /** Le panneau « ⋯ » : chaque espace avec une ligne qui dit ce qu'on y trouvera. */
  readonly menu = computed(() => {
    const s = this.store;
    const plural = (n: number, w: string): string => `${n} ${w}${n > 1 ? 's' : ''}`;
    const credits = s.accounts().filter((a) => a.kind === 'credit' && !a.archived).length;
    const soon = s.deadlines().filter((d) => d.daysAway >= 0 && d.daysAway <= 185).length;
    const pending = s.savingsTotals().pending;
    const last = s.imports().find((i) => i.status === 'committed')?.finishedAt;
    const ago = last ? Math.max(0, Math.round((Date.now() - new Date(last).getTime()) / 86400000)) : null;
    return [
      { tab: 'comptes' as FinTab, org: undefined, label: 'Comptes', icon: 'card', color: 'var(--blue)', bg: 'var(--tint-blue)',
        sub: plural(s.activeAccounts().length - credits, 'compte') + (credits ? ' · ' + plural(credits, 'crédit') : '') },
      { tab: 'contrats' as FinTab, org: undefined, label: 'Contrats', icon: 'folder', color: 'var(--sage-dark)', bg: 'var(--tint-sage)',
        sub: plural(soon, 'échéance') + (pending > 0 ? ` · ${eur(pending)} d'économies possibles` : '') },
      { tab: 'organiser' as FinTab, org: 'categories' as FinOrgTab, label: 'Catégories', icon: 'budget', color: '#B08A2E', bg: 'var(--tint-honey)',
        sub: plural(s.categories().length, 'catégorie') + ' · ' + plural(s.envelopeCount(), 'enveloppe') },
      { tab: 'organiser' as FinTab, org: 'regles' as FinOrgTab, label: 'Règles', icon: 'refresh', color: 'var(--violet)', bg: 'var(--tint-violet)',
        sub: plural(s.rules().length, 'règle') + ' · ' + plural(s.tags().length, 'étiquette') },
      { tab: 'organiser' as FinTab, org: 'import' as FinOrgTab, label: 'Import', icon: 'upload', color: 'var(--primary)', bg: 'var(--tint-primary)',
        sub: (ago === null ? 'Relevés CSV, OFX, CAMT.053, xlsx' : ago === 0 ? "Dernier import : aujourd'hui" : `Dernier import : il y a ${plural(ago, 'jour')}`) },
      { tab: 'organiser' as FinTab, org: 'donnees' as FinOrgTab, label: 'Données', icon: 'export', color: 'var(--ink2)', bg: 'var(--soft2)',
        sub: this.foyer.isAdmin() ? 'Export CSV, sauvegarde, restauration' : 'Réservé à un administrateur' },
    ];
  });

  /**
   * Dix comptes arrêtés le même jour sont un seul fait, pas dix lignes : ils
   * sont regroupés par la date où leurs données s'arrêtent.
   */
  readonly missingGroups = computed(() => {
    const byDate = new Map<string, string[]>();
    for (const m of this.store.summary()?.missing ?? []) {
      const date = this.foyer.fmtNumDate(m.coveredThrough || '');
      byDate.set(date, [...(byDate.get(date) ?? []), m.name]);
    }
    return [...byDate.entries()].map(([date, names]) => ({ date, label: names.length > 3 ? `${names.length} comptes` : names.join(', ') }));
  });

  readonly accountCount = computed(() => {
    const n = this.store.activeAccounts().length;
    return n ? `${n} compte${n > 1 ? 's' : ''} actif${n > 1 ? 's' : ''}` : 'Aucun compte';
  });
}
