import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FinMonthPoint } from '../../core/finances.api';
import { FinancesStore, fmtEuros, fmtEurosInt } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { CAT_ICONS } from '../../core/constants';

// Two series, so colour is the identity channel and has to survive colour
// blindness: the house green against the terracotta separates by ΔE 4.8 for a
// deuteranope, where 8 is the floor. The house blue, one step deeper, reaches
// 16.1 and passes every check in both themes. Green stays on the transaction
// rows, where the sign already carries the meaning.
const INCOME = '#3B8CBD';
const EXPENSE = '#E56B4E';

/** Chart geometry, in the SVG's own units; the box is scaled by the browser. */
const W = 720;
const H = 210;
const PAD_L = 64;
const PAD_B = 26;
const PAD_T = 10;

@Component({
  selector: 'fin-dashboard-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (store.dashboard(); as d) {
      <!-- COMPARAISON DU MOIS -->
      <div class="cards">
        <!-- Le montant du mois est déjà en gros au-dessus : cette carte porte l'écart. -->
        @if (d.previous; as p) {
          @let delta = d.month.expense - p.expense;
          <div class="card">
            <div class="overline">Par rapport à {{ monthName(p.month).toLowerCase() }}</div>
            <div class="big f-display" [style.color]="delta > 0 ? '#C6492F' : '#6E9E5F'">
              {{ delta > 0 ? '+' : '−' }}{{ fmtInt(abs(delta)) }} €
            </div>
            <div class="delta muted">{{ fmtInt(d.month.expense) }} € dépensés contre {{ fmtInt(p.expense) }} €</div>
          </div>
        } @else {
          <div class="card">
            <div class="overline">Comparaison</div>
            <div class="big f-display">—</div>
            <div class="delta muted">Aucun mois précédent à comparer</div>
          </div>
        }

        <div class="card">
          <div class="overline">Moyenne mensuelle</div>
          <div class="big f-display">{{ d.averageExpense ? fmtInt(d.averageExpense) + ' €' : '—' }}</div>
          <div class="delta muted">
            @if (d.completeMonths) {
              sur {{ d.completeMonths }} mois complet{{ d.completeMonths > 1 ? 's' : '' }} des douze derniers
            } @else {
              aucun mois complet sur douze, moyenne impossible
            }
          </div>
        </div>

        <div class="card">
          <div class="overline">Année {{ d.year.year }}</div>
          <div class="big f-display" [style.color]="d.year.balance >= 0 ? '#6E9E5F' : '#C6492F'">
            {{ d.year.balance > 0 ? '+' : '' }}{{ fmtInt(d.year.balance) }} €
          </div>
          <div class="delta muted">{{ fmtInt(d.year.income) }} € reçus, {{ fmtInt(d.year.expense) }} € dépensés sur {{ d.year.months }} mois</div>
        </div>
      </div>

      @if (yearWarning()) {
        <div class="warn">
          <f-icon name="urgent" [size]="17" color="#B8860B" [width]="2.2" />
          <div>
            <div class="warn-title">Le cumul {{ d.year.year }} est sous-estimé</div>
            <div class="warn-txt">
              {{ d.year.incompleteMonths.length }} mois de l'année ne sont pas entièrement couverts par vos imports :
              {{ incompleteLabel(d.year.incompleteMonths) }}. Les totaux ci-dessus comptent ce qui est là, pas ce qui manque.
            </div>
          </div>
        </div>
      }

      <!-- DOUZE MOIS -->
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">Douze derniers mois</div>
            <div class="panel-sub">Ressources et dépenses, virements internes exclus</div>
          </div>
          <div class="legend">
            <span class="lg"><span class="sw" [style.background]="INCOME"></span>Ressources</span>
            <span class="lg"><span class="sw" [style.background]="EXPENSE"></span>Dépenses</span>
            <span class="lg"><span class="sw hatch"></span>Mois incomplet</span>
          </div>
        </div>

        @let point = focused();
        <div class="readout" [class.dim]="!hovered()">
          @if (point) {
            <span class="ro-month">{{ monthName(point.month) }}</span>
            <span class="ro-v" [style.color]="INCOME">+{{ fmtInt(point.income) }} €</span>
            <span class="ro-v" [style.color]="EXPENSE">−{{ fmtInt(point.expense) }} €</span>
            <span class="ro-b">solde {{ point.balance > 0 ? '+' : '' }}{{ fmtInt(point.balance) }} €</span>
            @if (point.incomplete) { <span class="ro-warn">mois incomplet</span> }
          } @else {
            <span class="ro-month">Aucune donnée sur la période</span>
          }
        </div>

        <svg class="chart" [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img"
             [attr.aria-label]="'Ressources et dépenses des douze derniers mois, ' + (point ? monthName(point.month) : '')">
          <defs>
            <pattern id="finHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--soft2)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink3)" stroke-width="2" />
            </pattern>
          </defs>

          <!-- Grille : trois repères, volontairement discrets. -->
          @for (g of gridLines(); track g.v) {
            <line class="grid" [attr.x1]="PAD_L" [attr.x2]="W" [attr.y1]="g.y" [attr.y2]="g.y" />
            <text class="gtxt" [attr.x]="PAD_L - 8" [attr.y]="g.y + 4" text-anchor="end">{{ fmtInt(g.v) }}</text>
          }

          @for (b of bars(); track b.month) {
            <g (mouseenter)="hovered.set(b.month)" (mouseleave)="hovered.set(null)">
              <!-- Cible de survol plus large que les barres. -->
              <rect class="hit" [attr.x]="b.x" [attr.y]="PAD_T" [attr.width]="b.slot" [attr.height]="H - PAD_T - PAD_B"
                    [class.on]="hovered() === b.month" />
              @if (b.incomplete) {
                <rect [attr.x]="b.x + 1" [attr.y]="PAD_T" [attr.width]="b.slot - 2" [attr.height]="H - PAD_T - PAD_B"
                      fill="url(#finHatch)" opacity=".5" />
              }
              @if (b.incomeH > 0) {
                <rect [attr.x]="b.incomeX" [attr.y]="b.incomeY" [attr.width]="b.w" [attr.height]="b.incomeH" rx="4" [attr.fill]="INCOME" />
              }
              @if (b.expenseH > 0) {
                <rect [attr.x]="b.expenseX" [attr.y]="b.expenseY" [attr.width]="b.w" [attr.height]="b.expenseH" rx="4" [attr.fill]="EXPENSE" />
              }
              <text class="mtxt" [attr.x]="b.x + b.slot / 2" [attr.y]="H - 8" text-anchor="middle"
                    [class.on]="hovered() === b.month">{{ shortMonth(b.month) }}</text>
            </g>
          }
          <line class="axis" [attr.x1]="PAD_L" [attr.x2]="W" [attr.y1]="H - PAD_B" [attr.y2]="H - PAD_B" />
        </svg>
      </div>

      <div class="two">
        <!-- BUDGETS DU MOIS -->
        <div class="panel">
          <div class="panel-title">Budgets du mois</div>
          <div class="panel-sub">Dépense réelle face au budget de référence</div>
          <div class="bars">
            @for (c of monthCategories(); track c.categoryId) {
              <div class="row">
                <div class="row-top">
                  <span class="dot" [style.background]="c.color"></span>
                  <span class="row-name">{{ c.name }}</span>
                  <span class="row-val" [class.over]="c.budget > 0 && c.spent > c.budget">
                    {{ fmtInt(c.spent) }} €@if (c.budget > 0) { <span class="row-of"> / {{ fmtInt(c.budget) }} €</span> }
                  </span>
                </div>
                <div class="track">
                  <div class="fill" [style.width.%]="pct(c.spent, c.budget)"
                       [style.background]="c.budget > 0 && c.spent > c.budget ? '#C6492F' : c.color"></div>
                </div>
              </div>
            } @empty {
              <div class="none">Aucune dépense ce mois-ci.</div>
            }
          </div>
          @if (allUncategorised()) {
            <div class="none tip">
              Tout est encore « sans catégorie » : l'onglet Règles range ces opérations
              automatiquement, et ces barres deviennent alors lisibles.
            </div>
          }
        </div>

        <!-- PLUS GROSSES DÉPENSES -->
        <div class="panel">
          <div class="panel-title">Plus grosses dépenses du mois</div>
          <div class="panel-sub">Virements internes exclus</div>
          <div class="tops">
            @for (t of d.topExpenses; track t.id) {
              <div class="top" (click)="openMonthFiltered(t.label)">
                <div class="top-chip" [style.background]="foyer.tint(store.categoryColor(t.categoryId))">
                  <f-icon [path]="CAT_ICONS[store.categoryIcon(t.categoryId)] || CAT_ICONS['facture']" [size]="15"
                          [color]="store.categoryColor(t.categoryId)" [width]="2.2" />
                </div>
                <div class="top-body">
                  <div class="top-name">{{ t.label }}</div>
                  <div class="top-meta">{{ foyer.fmtNumDate(t.date) }} · {{ store.accountName(t.accountId) }}</div>
                </div>
                <div class="top-amt">−{{ fmt(abs(t.amount)) }} €</div>
              </div>
            } @empty {
              <div class="none">Aucune dépense ce mois-ci.</div>
            }
          </div>
        </div>
      </div>

      <!-- ANNÉE -->
      <div class="panel">
        <div class="panel-title">Dépenses {{ d.year.year }} par catégorie</div>
        <div class="panel-sub">Cumul de janvier à {{ monthName(store.ui().month) }}, face au budget de référence sur {{ d.year.months }} mois</div>
        <div class="bars">
          @for (c of d.year.categories; track c.categoryId) {
            <div class="row">
              <div class="row-top">
                <span class="dot" [style.background]="c.color"></span>
                <span class="row-name">{{ c.name }}</span>
                <span class="row-val" [class.over]="c.budget > 0 && c.spent > c.budget">
                  {{ fmtInt(c.spent) }} €@if (c.budget > 0) { <span class="row-of"> / {{ fmtInt(c.budget) }} €</span> }
                </span>
              </div>
              <div class="track">
                <div class="fill" [style.width.%]="pct(c.spent, c.budget || maxYearSpent())"
                     [style.background]="c.budget > 0 && c.spent > c.budget ? '#C6492F' : c.color"></div>
              </div>
            </div>
          } @empty {
            <div class="none">Aucune dépense enregistrée sur {{ d.year.year }}.</div>
          }
        </div>
      </div>
    } @else {
      <div class="panel loading">Chargement du bilan…</div>
    }
  `,
  styles: [`
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .card { background: var(--surface); border-radius: 18px; padding: 16px 18px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .big { font-size: 27px; font-weight: 700; color: var(--ink); margin: 6px 0 4px; }
    .delta { display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 800; }
    .delta.up { color: #C6492F; }
    .delta.down { color: #6E9E5F; }
    .delta.muted { color: var(--ink3); font-weight: 700; }

    .warn { display: flex; align-items: flex-start; gap: 12px; background: #FDF0DA; color: #7A5C12; border-radius: 16px; padding: 13px 16px; margin-bottom: 14px; }
    :host-context(.dark) .warn { background: #3A3123; color: #E8C88A; }
    .warn-title { font-size: 13.5px; font-weight: 800; }
    .warn-txt { font-size: 12.5px; font-weight: 700; opacity: .85; margin-top: 3px; line-height: 1.5; }

    .panel { background: var(--surface); border-radius: 18px; padding: 18px; margin-bottom: 14px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .panel.loading { color: var(--ink3); font-weight: 700; font-size: 13.5px; text-align: center; padding: 40px; }
    .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
    .panel-title { font-size: 15px; font-weight: 800; color: var(--ink); }
    .panel-sub { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 2px; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; }
    .lg { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: var(--ink2); }
    .sw { width: 11px; height: 11px; border-radius: 3px; flex: none; }
    .sw.hatch { background: repeating-linear-gradient(45deg, var(--soft2) 0 2px, var(--ink3) 2px 4px); }

    .readout { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 14px 0 2px; font-size: 12.5px; font-weight: 800; min-height: 19px; }
    .readout.dim { opacity: .75; }
    .ro-month { color: var(--ink); }
    .ro-v { font-variant-numeric: tabular-nums; }
    .ro-b { color: var(--ink2); font-variant-numeric: tabular-nums; }
    .ro-warn { background: #FDF0DA; color: #7A5C12; border-radius: 20px; padding: 1px 9px; font-size: 11px; }
    :host-context(.dark) .ro-warn { background: #3A3123; color: #E8C88A; }

    .chart { width: 100%; height: auto; display: block; }
    .grid { stroke: var(--line); stroke-width: 1; }
    .axis { stroke: var(--line2); stroke-width: 1; }
    .gtxt, .mtxt { font-family: inherit; font-size: 11px; font-weight: 700; fill: var(--ink3); }
    .mtxt.on { fill: var(--ink); }
    .hit { fill: transparent; }
    .hit.on { fill: var(--soft); }

    /* align-items: start, sinon le panneau le plus court s'étire à vide. */
    .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; align-items: start; }

    .bars { display: flex; flex-direction: column; gap: 11px; margin-top: 14px; }
    .row-top { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 800; color: var(--ink2); }
    .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
    .row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
    .row-val { flex: none; font-variant-numeric: tabular-nums; }
    .row-val.over { color: #C6492F; }
    .row-of { color: var(--ink3); font-weight: 700; }
    .track { height: 7px; border-radius: 20px; background: var(--soft2); margin-top: 5px; overflow: hidden; }
    .fill { height: 100%; border-radius: 20px; }
    .none { font-size: 13px; font-weight: 700; color: var(--ink3); padding: 14px 0; }
    .none.tip { font-size: 12.5px; line-height: 1.5; border-top: 1px solid var(--line); margin-top: 6px; }

    .tops { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .top { display: flex; align-items: center; gap: 11px; border-radius: 13px; padding: 7px 9px; cursor: pointer; }
    .top:hover { background: var(--soft); }
    .top-chip { width: 32px; height: 32px; flex: none; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
    .top-body { flex: 1; min-width: 0; }
    .top-name { font-size: 13px; font-weight: 800; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .top-meta { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 1px; }
    .top-amt { flex: none; font-size: 13.5px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
  `],
})
export class FinancesDashboardTab {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  CAT_ICONS = CAT_ICONS;
  INCOME = INCOME;
  EXPENSE = EXPENSE;
  W = W; H = H; PAD_L = PAD_L; PAD_B = PAD_B; PAD_T = PAD_T;
  fmt = fmtEuros;
  fmtInt = fmtEurosInt;
  abs = Math.abs;

  readonly hovered = signal<string | null>(null);

  constructor() { void this.store.loadDashboard(); }

  /** Hovered month, or the one being viewed when the pointer is away. */
  readonly focused = computed<FinMonthPoint | null>(() => {
    const s = this.store.dashboard()?.series ?? [];
    const h = this.hovered();
    return (h ? s.find((p) => p.month === h) : s[s.length - 1]) ?? null;
  });

  /** Tallest value of the chart, rounded up so the grid lands on round figures. */
  private readonly scale = computed(() => {
    const s = this.store.dashboard()?.series ?? [];
    const peak = Math.max(1, ...s.map((p) => Math.max(p.income, p.expense)));
    const step = Math.pow(10, Math.floor(Math.log10(peak / 100))) * 100;
    return Math.ceil(peak / step) * step;
  });

  gridLines(): { v: number; y: number }[] {
    const max = this.scale();
    return [0, 0.5, 1].map((f) => ({ v: max * f, y: H - PAD_B - f * (H - PAD_B - PAD_T) }));
  }

  bars(): {
    month: string; x: number; slot: number; w: number; incomplete: boolean;
    incomeX: number; incomeY: number; incomeH: number;
    expenseX: number; expenseY: number; expenseH: number;
  }[] {
    const s = this.store.dashboard()?.series ?? [];
    if (!s.length) return [];
    const max = this.scale();
    const usable = H - PAD_B - PAD_T;
    const slot = (W - PAD_L) / s.length;
    // A 2px gap of surface between the two bars, and a wider one between months.
    const w = Math.max(4, (slot - 14) / 2);
    return s.map((p, i) => {
      const x = PAD_L + i * slot;
      const incomeH = Math.round((p.income / max) * usable);
      const expenseH = Math.round((p.expense / max) * usable);
      const mid = x + slot / 2;
      return {
        month: p.month, x, slot, w, incomplete: p.incomplete,
        incomeX: mid - w - 1, incomeY: H - PAD_B - incomeH, incomeH,
        expenseX: mid + 1, expenseY: H - PAD_B - expenseH, expenseH,
      };
    });
  }

  /** Month categories with something to show, biggest spender first. */
  monthCategories(): { categoryId: number | null; name: string; color: string; spent: number; budget: number }[] {
    return (this.store.dashboard()?.month.categories ?? [])
      .filter((c) => c.spent > 0 || c.budget > 0)
      .sort((a, b) => b.spent - a.spent);
  }

  /**
   * The year banner only speaks when it says something the month banner does not:
   * a hole in an earlier month. Repeating « August is incomplete » twice in a row
   * teaches the reader to skip both.
   */
  readonly yearWarning = computed(() => {
    const d = this.store.dashboard();
    if (!d) return false;
    return d.year.incompleteMonths.some((m) => m !== d.month.month);
  });

  readonly maxYearSpent = computed(() =>
    Math.max(1, ...(this.store.dashboard()?.year.categories ?? []).map((c) => c.spent)));

  /** Nothing is classified yet: the panel would be a single grey bar. */
  readonly allUncategorised = computed(() => {
    const rows = this.monthCategories();
    return rows.length > 0 && rows.every((c) => c.categoryId === null);
  });

  pct(spent: number, reference: number): number {
    if (reference <= 0) return 0;
    return Math.min(100, Math.round((spent / reference) * 100));
  }

  monthName(month: string): string {
    const [y, m] = month.split('-').map(Number);
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  shortMonth(month: string): string {
    const [y, m] = month.split('-').map(Number);
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' });
    return m === 1 ? `${label} ${String(y).slice(2)}` : label;
  }

  incompleteLabel(months: string[]): string {
    return months.map((m) => this.shortMonth(m)).join(', ');
  }

  /** Jump to the operations list, filtered on the expense that was clicked. */
  openMonthFiltered(label: string): void {
    this.store.patch({ tab: 'transactions', fltQuery: label, page: 0 });
    void this.store.reloadTransactions();
  }
}
