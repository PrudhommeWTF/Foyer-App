import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FinancesStore, fmtEuros, fmtEurosInt, frMonthLabel } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { compareToAverage } from '../../core/finances-plan';
import { IconComponent } from '../../core/icon';
import { AlertComponent } from '../../shared/alert';
import { CAT_ICONS } from '../../core/constants';
import { FinNetChart, shortMonth } from './charts/net-chart';
import { CompareRow, FinCatCompare } from './charts/cat-compare';
import { FinBudgetYear } from './charts/budget-year';

/**
 * Tendances : le mois comparé (au précédent, à la moyenne, à l'année), le solde
 * de chaque mois, les catégories face à leur moyenne au même jour, les plus
 * grosses dépenses et l'année face au budget cumulé. Ce sont les cinq blocs de
 * l'ancien Bilan, redessinés ; les budgets du mois sont devenus les enveloppes
 * de l'Aperçu.
 */
@Component({
  selector: 'fin-tendances',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AlertComponent, FinNetChart, FinCatCompare, FinBudgetYear],
  template: `
    @if (store.dashboard(); as d) {
      @if (yearWarning()) {
        <f-alert kind="warn" class="mb">
          <div class="warn-title">Le cumul {{ d.year.year }} est sous-estimé</div>
          <div class="warn-txt">
            {{ d.year.incompleteMonths.length }} mois de l'année ne sont pas entièrement couverts par vos imports :
            {{ incompleteLabel(d.year.incompleteMonths) }}. Les totaux ci-dessous comptent ce qui est là, pas ce qui manque.
          </div>
        </f-alert>
      }

      <div class="cards">
        @if (d.previous; as p) {
          @let delta = d.month.expense - p.expense;
          <div class="card">
            <div class="overline">Par rapport à {{ word(p.month) }}</div>
            <div class="big f-display">{{ delta > 0 ? '+' : '−' }}{{ fmtInt(abs(delta)) }} €</div>
            <div class="sub">{{ fmtInt(d.month.expense) }} € dépensés en {{ word(d.month.month) }}{{ store.isCurrentMonth() ? ' au ' + flowDay() : '' }} contre {{ fmtInt(p.expense) }} €</div>
          </div>
        } @else {
          <div class="card">
            <div class="overline">Comparaison</div>
            <div class="big f-display">·</div>
            <div class="sub">Aucun mois précédent à comparer</div>
          </div>
        }
        <div class="card">
          <div class="overline">Moyenne mensuelle</div>
          <div class="big f-display">{{ d.averageExpense ? fmtInt(d.averageExpense) + ' €' : '·' }}</div>
          <div class="sub">
            @if (d.completeMonths) {
              de dépenses, sur {{ d.completeMonths }} mois complet{{ d.completeMonths > 1 ? 's' : '' }} des douze derniers
            } @else {
              aucun mois complet sur douze, moyenne impossible
            }
          </div>
        </div>
        <div class="card">
          <div class="overline">Année {{ d.year.year }}</div>
          <div class="big f-display">{{ d.year.balance > 0 ? '+' : '' }}{{ fmtInt(d.year.balance) }} €</div>
          <div class="sub">{{ fmtInt(d.year.income) }} € reçus · {{ fmtInt(d.year.expense) }} € dépensés · {{ d.year.months }} mois</div>
        </div>
      </div>

      <div class="two">
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Solde de chaque mois</div><span class="chip">{{ d.series.length }} mois</span></div>
          <fin-net-chart [points]="d.series" [current]="store.homeMonth()" [day]="flowDay()" [compact]="foyer.narrow()" />
          <div class="legend">
            <span class="lg"><span class="sw" style="background: var(--chart-pos)"></span>Positif</span>
            <span class="lg"><span class="sw" style="background: var(--chart-neg)"></span>Négatif</span>
            <span class="lg"><span class="sw hatch"></span>Mois incomplet</span>
          </div>
          <div class="panel-sub">Au survol ou au clavier : ressources, dépenses et solde du mois. Virements internes exclus.</div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div class="panel-title">{{ store.isCurrentMonth() ? 'Ce mois' : monthName(d.month.month) }} face à votre moyenne</div>
            <span class="chip">{{ store.isCurrentMonth() ? 'au ' + flowDay() : 'mois entier' }}</span>
          </div>
          @if (compare().length) {
            <fin-cat-compare [rows]="compare()" [monthName]="word(d.month.month)"
                             [when]="store.isCurrentMonth() ? 'au ' + flowDay() : 'sur le mois'" />
            <div class="legend">
              <span class="lg"><span class="sw" style="background: var(--chart-seq)"></span>{{ store.isCurrentMonth() ? 'Dépensé à ce jour' : 'Dépensé' }}</span>
              <span class="lg"><span class="bar-mark"></span>Moyenne des 3 mois précédents{{ store.isCurrentMonth() ? ', au même jour' : '' }}</span>
            </div>
          } @else {
            <div class="none">Rien à comparer : aucune dépense classée ce mois-ci ni les trois précédents.</div>
          }
        </div>
      </div>

      <div class="two">
        <div class="panel">
          <div class="panel-title">Plus grosses dépenses du mois</div>
          <div class="tops">
            @for (t of d.topExpenses; track t.id) {
              <button type="button" class="top" (click)="openMonthFiltered(t.label)">
                <div class="top-chip" [style.background]="foyer.tint(store.categoryColor(t.categoryId))">
                  <f-icon [path]="CAT_ICONS[store.categoryIcon(t.categoryId)] || CAT_ICONS['facture']" [size]="15"
                          [color]="store.categoryColor(t.categoryId)" [width]="2.2" />
                </div>
                <div class="top-body">
                  <div class="top-name">{{ t.label }}</div>
                  <div class="top-meta">{{ foyer.fmtNumDate(t.date) }} · {{ store.categoryPath(t.categoryId) }} · voir dans Opérations →</div>
                </div>
                <div class="top-amt">−{{ fmt(abs(t.amount)) }} €</div>
              </button>
            } @empty {
              <div class="none">Aucune dépense ce mois-ci.</div>
            }
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><div class="panel-title">Dépenses {{ d.year.year }} par catégorie</div><span class="chip">face au budget cumulé</span></div>
          @if (d.year.categories.length) {
            <fin-budget-year [rows]="d.year.categories" [span]="'de janvier à ' + shortName(d.month.month)" />
            <div class="legend">
              <span class="lg"><span class="sw" style="background: var(--chart-pace)"></span>Dépensé de janvier à {{ shortName(d.month.month) }}</span>
              <span class="lg"><span class="bar-mark"></span>Budget × {{ d.year.months }} mois</span>
            </div>
          } @else {
            <div class="none">Aucune dépense enregistrée sur {{ d.year.year }}.</div>
          }
        </div>
      </div>
    } @else {
      <div class="panel loading">Chargement des tendances…</div>
    }
  `,
  styles: [`
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .card { background: var(--surface); border-radius: 18px; padding: 16px 18px; box-shadow: var(--sh-card); }
    .overline { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; }
    .big { font-size: 27px; font-weight: 700; color: var(--ink); margin: 6px 0 4px; }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); line-height: 1.45; }

    f-alert.mb { display: block; margin-bottom: 14px; }
    .warn-title { font-size: 13.5px; font-weight: 800; }
    .warn-txt { font-size: 12.5px; font-weight: 700; opacity: .85; margin-top: 3px; line-height: 1.5; }

    .panel { background: var(--surface); border-radius: 18px; padding: 18px; margin-bottom: 14px; box-shadow: var(--sh-card); min-width: 0; }
    .panel.loading { color: var(--ink3); font-weight: 700; font-size: 13.5px; text-align: center; padding: 40px; }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .panel-title { font-size: 15px; font-weight: 800; color: var(--ink); }
    .panel-sub { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 6px; }
    .chip { flex: none; background: var(--soft2); color: var(--ink2); font-size: 12px; font-weight: 800; border-radius: 10px; padding: 4px 10px; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
    .lg { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: var(--ink2); }
    .sw { width: 11px; height: 11px; border-radius: 3px; flex: none; }
    .sw.hatch { background: repeating-linear-gradient(45deg, var(--chart-pos) 0 2px, var(--surface) 2px 4px); }
    .bar-mark { width: 3px; height: 13px; border-radius: 1px; background: var(--ink); flex: none; }

    /* align-items: start, sinon le panneau le plus court s'étire à vide. */
    .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; align-items: start; }
    @media (max-width: 400px) { .two { grid-template-columns: minmax(0, 1fr); } }
    .none { font-size: 13px; font-weight: 700; color: var(--ink3); padding: 14px 0; }

    .tops { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
    .top { display: flex; align-items: center; gap: 11px; border-radius: 13px; padding: 7px 9px; cursor: pointer; border: none; background: none; text-align: left; font-family: inherit; width: 100%; }
    .top:hover, .top:focus-visible { background: var(--soft); }
    .top-chip { width: 32px; height: 32px; flex: none; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
    .top-body { flex: 1; min-width: 0; }
    .top-name { font-size: 13px; font-weight: 800; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .top-meta { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 1px; }
    .top-amt { flex: none; font-size: 13.5px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
  `],
})
export class FinancesTendances {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  CAT_ICONS = CAT_ICONS;
  fmt = fmtEuros;
  fmtInt = fmtEurosInt;
  abs = Math.abs;
  readonly monthName = frMonthLabel;
  /** « septembre » : le mois seul, sans l'année. */
  readonly word = (m: string): string => frMonthLabel(m).split(' ')[0].toLowerCase();
  readonly shortName = (m: string): string => shortMonth(m).replace(/\.$/, '').replace(/ \d+$/, '');

  constructor() { void this.store.loadDashboard(); }

  readonly flowDay = computed(() => this.store.flow()?.day ?? 0);

  /** Les catégories face à leur moyenne au même jour (dix au plus, les plus grosses). */
  readonly compare = computed<CompareRow[]>(() => {
    const f = this.store.flow();
    return f ? compareToAverage(f).slice(0, 10).map((c) => ({ id: c.categoryId, name: this.store.categoryPath(c.categoryId), ...c })) : [];
  });

  /**
   * Le bandeau de l'année ne parle que s'il dit autre chose que celui du mois :
   * un trou dans un mois antérieur. Répéter « août est incomplet » deux fois de
   * suite apprend surtout à sauter les deux.
   */
  readonly yearWarning = computed(() => {
    const d = this.store.dashboard();
    return !!d && d.year.incompleteMonths.some((m) => m !== d.month.month);
  });

  incompleteLabel(months: string[]): string { return months.map((m) => shortMonth(m)).join(', '); }

  /** Vers Opérations, filtrées sur la dépense cliquée. */
  openMonthFiltered(label: string): void {
    this.store.patch({ tab: 'operations', fltQuery: label, page: 0 });
    void this.store.reloadTransactions();
  }
}
