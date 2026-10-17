import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { daysLeft, paceSeries } from '../../core/finances-plan';
import { CAT_ICONS, tint } from '../../core/constants';
import { IconComponent } from '../../core/icon';
import { SheetComponent } from '../../shared/sheet';
import { FinPaceChart } from './charts/pace-chart';
import { shortMonth } from './charts/net-chart';
import { eur } from './charts/tip';

/**
 * La fiche d'une enveloppe : ce qui reste et par jour, son rythme, ses
 * dépenses du mois, son budget de référence modifiable sur place, et les
 * transferts du mois (d'une autre enveloppe vers celle-ci), annulables.
 */
@Component({
  selector: 'fin-envelope-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, SheetComponent, FinPaceChart],
  template: `
    @if (env(); as e) {
      @let u = store.ui();
      <f-sheet [heading]="e.name" [kicker]="'Enveloppe · ' + monthWord()" (close)="close()" (back)="close()">
        <div class="head">
          <span class="ic" [style.background]="tint(e.color)"><f-icon [path]="CAT_ICONS[e.icon] || CAT_ICONS['facture']" [size]="18" [color]="e.color" [width]="2.2" /></span>
          <div class="big f-display" [class.crit]="e.left < 0">
            @if (e.left < 0) { <span aria-hidden="true">⚠</span> {{ eur(-e.left) }} <small>de trop</small> } @else { {{ eur(e.left) }} <small>restants</small> }
          </div>
        </div>
        <div class="sub">
          @if (store.isCurrentMonth() && e.left >= 0) { {{ eur(e.perDay) }} par jour pendant {{ left() }} jour{{ left() > 1 ? 's' : '' }} · }
          {{ eur(e.spent) }} sur {{ eur(e.budget) }}
        </div>

        @if (store.flow(); as f) {
          <fin-pace-chart [series]="series()" [days]="f.days" [budget]="e.budget" [monthShort]="monthShort()" [current]="store.isCurrentMonth()"
                          [compact]="true" [width]="420" [height]="170" />
          <div class="legend">
            <span class="lg"><span class="ln seq"></span>Dépensé</span>
            <span class="lg"><span class="ln pace"></span>Rythme prévu</span>
          </div>
        }

        <div class="sec">Dépenses du mois</div>
        @for (t of store.envOps(); track t.id) {
          <div class="op">
            <span class="op-l"><b>{{ t.label }}</b><small>{{ day(t.date) }}{{ t.categoryId !== e.categoryId ? ' · ' + store.categoryPath(t.categoryId) : '' }}</small></span>
            <span class="op-a">−{{ money(-t.amount) }} €</span>
          </div>
        } @empty {
          <div class="none">Aucune dépense dans cette enveloppe ce mois-ci.</div>
        }

        <div class="sec">Transferts du mois</div>
        @for (m of moves(); track m.id) {
          <div class="op">
            <span class="op-l"><b>{{ m.in ? '+' : '−' }}{{ eur(m.amount) }} {{ m.in ? 'depuis' : 'vers' }} {{ store.categoryPath(m.other) }}</b></span>
            <button class="soft-btn" (click)="store.deleteBudgetMove(m.id)" [attr.aria-label]="'Annuler le transfert de ' + eur(m.amount)">Annuler</button>
          </div>
        } @empty {
          <div class="none">Aucun transfert : le budget du mois est celui de référence.</div>
        }

        <div class="sec">Transférer vers {{ e.name }}</div>
        <div class="row">
          <select class="input" [ngModel]="u.mvFrom" (ngModelChange)="store.patch({ mvFrom: $event })" aria-label="Enveloppe d'où vient le budget">
            <option [ngValue]="null">Depuis l'enveloppe…</option>
            @for (o of others(); track o.categoryId) { <option [ngValue]="o.categoryId">{{ o.name }} · {{ o.left < 0 ? 'dépassée' : eur(o.left) + ' restants' }}</option> }
          </select>
          <input class="input amt" [ngModel]="u.mvAmount" (ngModelChange)="store.patch({ mvAmount: $event })" placeholder="50" inputmode="decimal" aria-label="Montant à transférer" />
        </div>
        <div class="hint">Pour {{ monthWord() }} seulement : le budget de référence ne change pas.</div>

        <div sheetFoot class="foot">
          @if (u.envBudget === null) {
            <button class="btn btn-soft" (click)="store.patch({ envBudget: money(baseBudget()) })">Budget : {{ eur(baseBudget()) }} / mois ✎</button>
          } @else {
            <input class="input bud" [ngModel]="u.envBudget" (ngModelChange)="store.patch({ envBudget: $event })" inputmode="decimal" aria-label="Budget de référence par mois" />
            <button class="btn btn-soft" (click)="store.saveEnvelopeBudget()">Enregistrer</button>
          }
          <button class="btn btn-primary" [disabled]="!u.mvFrom || !u.mvAmount" (click)="store.moveBudget()">Transférer…</button>
        </div>
      </f-sheet>
    }
  `,
  styles: [`
    .head { display: flex; align-items: center; gap: 12px; }
    .ic { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; flex: none; }
    .big { font-size: 38px; font-weight: 700; color: var(--ink); line-height: 1.1; }
    .big small { font-family: var(--font-body); font-size: 15px; font-weight: 700; color: var(--ink2); }
    .big.crit { color: var(--status-crit); }
    .sub { font-size: 13.5px; font-weight: 700; color: var(--ink2); margin: 6px 0 12px; }
    .legend { display: flex; gap: 14px; margin: 6px 0 4px; }
    .lg { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .ln { width: 14px; height: 3px; border-radius: 2px; }
    .ln.seq { background: var(--chart-seq); }
    .ln.pace { background: var(--chart-pace); }
    .sec { font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); margin: 18px 0 6px; }
    .op { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
    .op-l { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .op-l b { font-size: 14px; font-weight: 800; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .op-l small { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .op-a { flex: none; font-size: 14px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
    .none { font-size: 13px; font-weight: 700; color: var(--ink3); }
    .row { display: flex; gap: 8px; }
    .row select { flex: 1; min-width: 0; }
    .amt { width: 110px; flex: none; }
    .hint { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 6px; }
    .soft-btn { flex: none; border: none; background: var(--soft2); color: var(--ink2); font-family: inherit; font-size: 12.5px; font-weight: 800; border-radius: 10px; padding: 6px 11px; cursor: pointer; }
    .foot { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .foot .btn { flex: 1 1 auto; justify-content: center; }
    .bud { width: 120px; flex: none; }
  `],
})
export class FinEnvelopeSheet {
  readonly store = inject(FinancesStore);
  readonly CAT_ICONS = CAT_ICONS; readonly tint = tint; readonly eur = eur;
  money = (cents: number): string => fmtEuros(cents);

  readonly env = computed(() => this.store.envelopes().find((e) => e.categoryId === this.store.ui().envId) ?? null);
  readonly left = computed(() => { const f = this.store.flow(); return f ? daysLeft(f) : 1; });
  readonly monthShort = computed(() => shortMonth(this.store.ui().month));
  readonly monthWord = computed(() => this.store.monthLabel().split(' ')[0].toLowerCase());
  readonly series = computed(() => { const f = this.store.flow(), e = this.env(); return f && e ? paceSeries(f, [e.categoryId]) : []; });
  readonly baseBudget = computed(() => this.store.categories().find((c) => c.id === this.store.ui().envId)?.monthlyBudget ?? 0);
  readonly others = computed(() => this.store.envelopes().filter((e) => e.categoryId !== this.store.ui().envId));

  /** Les transferts du mois qui touchent cette enveloppe, entrants ou sortants. */
  readonly moves = computed(() => {
    const id = this.store.ui().envId;
    return (this.store.flow()?.moves ?? [])
      .filter((m) => m.toCategoryId === id || m.fromCategoryId === id)
      .map((m) => ({ id: m.id, amount: m.amount, in: m.toCategoryId === id, other: m.toCategoryId === id ? m.fromCategoryId : m.toCategoryId }));
  });

  day(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    const s = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  close(): void { this.store.patch({ envId: null, envBudget: null, mvFrom: null, mvAmount: '' }); }
}
