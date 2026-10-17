import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FinDeadline } from '../../core/finances.api';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import {
  Envelope, daysLeft, envelopes, fixedCharges, paceSeries, paceStatus, proposeBudgets, remainingToFinish,
} from '../../core/finances-plan';
import { CAT_ICONS, tint } from '../../core/constants';
import { IconComponent } from '../../core/icon';
import { FinMonthNav } from './month-nav';
import { FinPaceChart } from './charts/pace-chart';
import { FinEnvelope } from './charts/envelope';
import { eur } from './charts/tip';
import { shortMonth } from './charts/net-chart';

/** Une ligne de « À surveiller ». */
type Watch =
  | { kind: 'preavis'; key: string; d: FinDeadline }
  | { kind: 'releve'; key: string; contractId: number; name: string; daysSince: number | null }
  | { kind: 'incomplet'; key: string; label: string; date: string }
  | { kind: 'classer'; key: string };

/**
 * L'Aperçu : ce qu'il reste pour finir le mois, le rythme des enveloppes, ce
 * qui demande un geste (préavis, relevés, mois incomplet, opérations à
 * classer), les charges fixes payées ou attendues, et les comptes.
 */
@Component({
  selector: 'fin-apercu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FinMonthNav, FinPaceChart, FinEnvelope],
  template: `
    <fin-month-nav>
      @if (envs().length && current()) {
        @switch (status()) {
          @case ('crit') { <span class="pill crit"><span aria-hidden="true">⚠</span> {{ overLabel() }}</span> }
          @case ('warn') { <span class="pill warn">Au-dessus du rythme</span> }
          @case ('ok') { @if (!foyer.narrow()) { <span class="pill ok">Dans le rythme</span> } }
        }
      }
    </fin-month-nav>

    <div class="top">
      <!-- LE CHIFFRE DU MOIS -->
      <section class="card hero">
        @if (store.summary(); as s) {
          <div class="overline">{{ foyer.narrow() ? monthWord() + ' · ' : '' }}{{ current() ? 'Reste pour finir le mois' : 'Solde du mois' }}</div>
          <div class="big f-display" [class.neg]="heroValue() < 0">{{ eur(heroValue()) }}</div>
          @if (current()) {
            @if (envs().length) {
              <div class="lead">dont <b>{{ eur(envLeft()) }}</b> dans vos enveloppes · {{ left() }} jour{{ left() > 1 ? 's' : '' }} restant{{ left() > 1 ? 's' : '' }}</div>
            } @else if (heroValue() > 0) {
              <div class="lead">{{ eur(heroValue() / left()) }} par jour d'ici le {{ flow()?.days }}</div>
            }
          }
          <div class="parts">
            <span>Ressources <b>{{ eur(s.income) }}</b></span>
            <span>− Dépensé <b>{{ eur(s.expense) }}</b></span>
            @if (current() && pending() > 0) { <span>− Charges à venir <b>{{ eur(pending()) }}</b></span> }
          </div>
          @if (envs().length && flow(); as f) {
            <div class="sec-title">Rythme des enveloppes</div>
            <fin-pace-chart [series]="pace()" [days]="f.days" [budget]="envBudget()" [monthShort]="monthShort()"
                            [current]="current()" [width]="foyer.narrow() ? 340 : 520" [height]="foyer.narrow() ? 180 : 200" />
            <div class="legend">
              <span class="lg"><span class="ln seq"></span>Dépensé, cumulé</span>
              <span class="lg"><span class="ln pace"></span>Rythme prévu ({{ eur(envBudget()) }})</span>
            </div>
          }
        } @else {
          <div class="loading">Chargement…</div>
        }
      </section>

      <!-- ENVELOPPES -->
      <section class="card envs-card">
        <div class="head">
          <div class="title">Enveloppes</div>
          <button class="soft-btn" (click)="store.goTab('organiser', 'categories')">Modifier les budgets</button>
        </div>
        @if (envs().length) {
          <div class="envs" (scroll)="onScroll($event)">
            @for (e of envs(); track e.categoryId) {
              <fin-envelope [env]="e" [pace]="paceFraction()" [current]="current()" />
            }
          </div>
          @if (foyer.narrow() && envs().length > 1) {
            <div class="dots" aria-hidden="true">
              @for (e of envs(); track e.categoryId; let i = $index) { <span [class.on]="i === slide()"></span> }
            </div>
          }
        } @else if (proposals().length) {
          <div class="propose">
            <div class="p-title">Vous n'avez pas encore de budgets</div>
            <div class="p-txt">D'après vos {{ store.completeMonths().length > 1 ? store.completeMonths().length + ' derniers mois complets' : 'dernier mois complet' }}, voici des enveloppes réalistes. Vous pourrez les ajuster.</div>
            @for (p of proposals(); track p.categoryId) {
              <div class="p-row">
                <span class="ic" [style.background]="tint(p.color)"><f-icon [path]="CAT_ICONS[p.icon] || CAT_ICONS['facture']" [size]="14" [color]="p.color" [width]="2.2" /></span>
                <span class="p-name">{{ p.name }}</span>
                <span class="p-amt">{{ eur(p.budget) }} / mois</span>
              </div>
            }
            <div class="p-acts">
              <button class="btn btn-primary" [disabled]="store.ui().busy" (click)="store.createBudgets(proposals())">Créer ces {{ proposals().length }} enveloppes</button>
              <button class="btn btn-soft" (click)="store.goTab('organiser', 'categories')">Ajuster</button>
            </div>
          </div>
        } @else {
          <div class="empty">
            Donnez un budget mensuel à une catégorie pour en faire une enveloppe : son reste et son rythme s'afficheront ici.
            Les charges fixes (loyer, prêt, assurances) n'en sont pas : elles sont suivies à part.
          </div>
        }
      </section>
    </div>

    <div class="row">
      <!-- À SURVEILLER -->
      @if (watch().length) {
        <section class="card">
          <div class="head"><div class="title">À surveiller</div><span class="count">{{ watch().length }}</span></div>
          @for (w of watch(); track w.key) {
            <div class="w">
              @switch (w.kind) {
                @case ('preavis') {
                  <span class="w-ic crit"><f-icon name="urgent" [size]="17" color="var(--status-crit)" /></span>
                  <div class="w-body">
                    <div class="w-t">{{ w.d.contractName }}{{ w.d.provider ? ' · ' + w.d.provider : '' }} : résilier avant le {{ shortDate(w.d.date) }}</div>
                    <div class="w-s">{{ w.d.daysAway === 0 ? "Préavis : c'est aujourd'hui" : 'Préavis dans ' + w.d.daysAway + ' jour' + (w.d.daysAway > 1 ? 's' : '') }}</div>
                  </div>
                  <button class="soft-btn" (click)="store.taskFromDeadline(w.d)">+ Tâche</button>
                }
                @case ('releve') {
                  <span class="w-ic warn"><f-icon name="bolt" [size]="17" color="var(--status-warn)" /></span>
                  <div class="w-body">
                    <div class="w-t">Relevé du compteur {{ w.name }}</div>
                    <div class="w-s">{{ w.daysSince === null ? 'Jamais relevé' : 'Dernier relevé il y a ' + w.daysSince + ' jours' }}</div>
                  </div>
                  <button class="soft-btn" (click)="store.openContract(w.contractId)">Relever</button>
                }
                @case ('incomplet') {
                  <span class="w-ic warn"><f-icon name="calendar" [size]="17" color="var(--status-warn)" /></span>
                  <div class="w-body">
                    <div class="w-t">{{ w.label }} : données jusqu'au {{ w.date }}</div>
                    <div class="w-s">Mois incomplet : importez le relevé, ou archivez le compte s'il n'est plus suivi</div>
                  </div>
                  <button class="soft-btn" (click)="store.goTab('organiser', 'import')">Importer</button>
                }
                @case ('classer') {
                  @if (store.toClassify()[0]; as t) {
                    <span class="w-ic warn"><f-icon name="urgent" [size]="17" color="var(--status-warn)" /></span>
                    <div class="w-body">
                      <div class="w-t">{{ store.toClassify().length }} opération{{ store.toClassify().length > 1 ? 's' : '' }} à classer</div>
                      <div class="w-s">{{ t.label }} · {{ foyer.fmtNumDate(t.date) }} · −{{ money(-t.amount) }} €</div>
                      <div class="choices">
                        @for (c of choices(); track c.id; let first = $first) {
                          <button class="chip" [class.main]="first && c.suggested" (click)="store.classify(t.id, c.id)"
                                  [attr.aria-label]="'Classer dans ' + c.name">{{ c.name }}</button>
                        }
                        <select class="chip other" aria-label="Autre catégorie" (change)="pick(t.id, $event)">
                          <option value="">Autre…</option>
                          @for (c of store.categories(); track c.id) { <option [value]="c.id">{{ store.categoryPath(c.id) }}</option> }
                        </select>
                      </div>
                    </div>
                  }
                }
              }
            </div>
          }
        </section>
      }

      <!-- CHARGES FIXES -->
      <section class="card">
        <div class="head">
          <div class="title">Charges fixes</div>
          @if (charges().length) { <span class="count wide">{{ eur(paid()) }} sur {{ eur(paid() + pending()) }}</span> }
        </div>
        @for (c of charges(); track c.contractId) {
          <div class="fx" [class.todo]="!c.paid">
            <span class="box" [class.on]="c.paid" [attr.aria-label]="c.paid ? 'Payée' : 'Attendue'">
              @if (c.paid) { <f-icon name="check" [size]="13" color="#fff" [width]="3.2" /> }
            </span>
            <span class="fx-n">{{ c.name }}{{ c.provider ? ' · ' + c.provider : '' }}@if (!c.paid && c.day) { <span class="fx-when"> · attendu le {{ c.day }} {{ monthShort() }}</span> }</span>
            <span class="fx-a">−{{ money(c.amount) }} €</span>
          </div>
        } @empty {
          <div class="empty">
            Les catégories marquées « charge fixe » (loyer, prêt, assurances, abonnements) apparaissent ici, payées ou attendues, d'après leurs contrats.
            <button class="soft-btn inline" (click)="store.goTab('organiser', 'categories')">Choisir les catégories</button>
          </div>
        }
      </section>

      <!-- COMPTES -->
      <section class="card">
        <div class="head"><div class="title">Comptes</div><button class="soft-btn" (click)="store.goTab('comptes')">Comptes</button></div>
        @for (a of accounts(); track a.id; let first = $first) {
          <div class="acc" [class.first]="first">
            <div class="acc-t">
              <div class="acc-n">{{ a.name }}</div>
              <div class="acc-v f-display" [class.neg]="a.balance < 0">{{ money(a.balance) }} €</div>
            </div>
            @if (a.spark; as sp) {
              <svg class="spark" viewBox="0 0 90 34" width="90" height="34" role="img" [attr.aria-label]="'Solde sur six mois'">
                <polyline [attr.points]="sp.points" />
                <circle [attr.cx]="sp.lastX" [attr.cy]="sp.lastY" r="3" />
              </svg>
            }
          </div>
        } @empty {
          <div class="empty">Aucun compte pour l'instant.</div>
        }
        @for (l of loans(); track l.id) {
          <div class="loan">{{ l.name }} : {{ eur(l.owed) }} restants · {{ l.pct }} % remboursé</div>
        }
      </section>
    </div>

    @if (foyer.narrow()) {
      <button class="fab" (click)="store.newTx()"><f-icon name="plus" [size]="19" color="#fff" [width]="2.6" /> Opération</button>
    }
  `,
  styles: [`
    :host { display: block; }
    /* Le bouton flottant ne doit pas cacher le bas de la dernière carte. */
    @media (max-width: 860px) { :host { padding-bottom: 72px; } }
    .top { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 16px; align-items: start; margin-bottom: 16px; }
    .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; align-items: start; }
    @media (max-width: 1100px) { .top { grid-template-columns: minmax(0, 1fr); } }
    .card { background: var(--surface); border-radius: var(--r-card-lg); padding: 20px 22px; box-shadow: var(--sh-card); min-width: 0; }
    .overline { font-size: 12px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .06em; }
    .big { font-size: 52px; font-weight: 700; color: var(--ink); line-height: 1.05; margin: 6px 0 6px; }
    .big.neg { color: var(--status-crit); }
    .lead { font-size: 14px; font-weight: 700; color: var(--ink2); }
    .lead b, .parts b { color: var(--ink); font-weight: 800; }
    .parts { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 12px; font-size: 13.5px; font-weight: 700; color: var(--ink2); }
    .sec-title { font-size: 14.5px; font-weight: 800; color: var(--ink); margin: 18px 0 8px; }
    .legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; }
    .lg { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .ln { width: 14px; height: 3px; border-radius: 2px; }
    .ln.seq { background: var(--chart-seq); }
    .ln.pace { background: var(--chart-pace); }
    .loading { color: var(--ink3); font-weight: 700; padding: 20px 0; }

    .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
    .title { font-size: 16px; font-weight: 800; color: var(--ink); }
    .count { background: var(--soft2); color: var(--ink2); font-size: 12.5px; font-weight: 800; border-radius: 10px; padding: 4px 10px; flex: none; }
    .soft-btn { flex: none; border: none; background: var(--soft2); color: var(--ink2); font-family: inherit; font-size: 12.5px; font-weight: 800; border-radius: 10px; padding: 7px 12px; cursor: pointer; white-space: nowrap; }
    .soft-btn:hover { background: var(--line); color: var(--ink); }
    .soft-btn.inline { margin-top: 10px; display: block; }
    .pill { font-size: 12.5px; font-weight: 800; border-radius: 99px; padding: 5px 12px; }
    .pill.crit { background: var(--status-crit-bg); color: var(--status-crit); }
    .pill.warn { background: var(--status-warn-bg); color: var(--status-warn); }
    .pill.ok { background: var(--soft2); color: var(--ink2); }
    .empty { font-size: 13px; font-weight: 700; color: var(--ink3); line-height: 1.5; }

    .envs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    @media (max-width: 1300px) and (min-width: 1101px) { .envs { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 860px) {
      .envs { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; gap: 10px; margin: 0 -22px; padding: 0 22px 4px; scrollbar-width: none; }
      .envs::-webkit-scrollbar { display: none; }
      .envs fin-envelope { flex: 0 0 74%; scroll-snap-align: start; }
      .big { font-size: 44px; }
    }
    .dots { display: flex; justify-content: center; gap: 6px; margin-top: 10px; }
    .dots span { width: 6px; height: 6px; border-radius: 99px; background: var(--line2); }
    .dots span.on { background: var(--ink2); width: 16px; }

    .propose { border: 2px dashed var(--line2); border-radius: 18px; padding: 16px 18px; }
    .p-title { font-size: 15.5px; font-weight: 800; color: var(--ink); }
    .p-txt { font-size: 13px; font-weight: 600; color: var(--ink2); margin: 4px 0 10px; line-height: 1.45; }
    .p-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
    .ic { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; flex: none; }
    .p-name { flex: 1; font-size: 14px; font-weight: 800; color: var(--ink); }
    .p-amt { font-size: 14px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
    .p-acts { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }

    .w { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
    .w-ic { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; flex: none; }
    .w-ic.crit { background: var(--status-crit-bg); }
    .w-ic.warn { background: var(--status-warn-bg); }
    .w-body { flex: 1; min-width: 0; }
    .w-t { font-size: 14px; font-weight: 800; color: var(--ink); line-height: 1.3; }
    .w-s { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; overflow-wrap: anywhere; }
    .choices { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .chip { border: 1.5px solid var(--line2); background: var(--surface); color: var(--ink); font-family: inherit; font-size: 12.5px; font-weight: 800; border-radius: 10px; padding: 5px 10px; cursor: pointer; max-width: 100%; }
    .chip.main { background: var(--primary); border-color: var(--primary); color: #fff; }
    .chip.other { color: var(--ink2); }

    .fx { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); font-size: 13.5px; font-weight: 700; }
    .fx:first-of-type { border-top: none; }
    .box { width: 20px; height: 20px; border-radius: 6px; border: 2px solid var(--line2); display: grid; place-items: center; flex: none; box-sizing: border-box; }
    .box.on { background: var(--sage-dark); border-color: var(--sage-dark); }
    .fx-n { flex: 1; min-width: 0; color: var(--ink); }
    .fx.todo .fx-n { color: var(--ink2); }
    .fx-when { color: var(--ink3); }
    .fx-a { flex: none; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }

    .acc { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); }
    .acc.first { border-top: none; }
    .acc-t { flex: 1; min-width: 0; }
    .acc-n { font-size: 12.5px; font-weight: 800; color: var(--ink2); }
    .acc-v { font-size: 19px; font-weight: 700; color: var(--ink); }
    .acc-v.neg { color: var(--status-crit); }
    .spark polyline { fill: none; stroke: var(--chart-pos); stroke-width: 2; stroke-linejoin: round; }
    .spark circle { fill: var(--chart-pos); }
    .loan { font-size: 12.5px; font-weight: 700; color: var(--ink2); padding-top: 9px; border-top: 1px solid var(--line); margin-top: 4px; }

    .fab { position: fixed; right: 16px; bottom: calc(18px + env(safe-area-inset-bottom)); z-index: 30; display: flex; align-items: center; gap: 7px;
      border: none; border-radius: 18px; padding: 14px 20px; background: var(--primary); color: #fff; font-family: inherit; font-size: 15px; font-weight: 800;
      box-shadow: var(--sh-primary); cursor: pointer; }
  `],
})
export class FinancesApercu {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  CAT_ICONS = CAT_ICONS; tint = tint; eur = eur;
  money = (cents: number): string => fmtEuros(cents);

  readonly slide = signal(0);

  readonly flow = computed(() => this.store.flow());
  readonly current = computed(() => this.store.isCurrentMonth());
  readonly left = computed(() => { const f = this.flow(); return f ? daysLeft(f) : 1; });
  readonly monthShort = computed(() => shortMonth(this.store.ui().month));
  readonly monthWord = computed(() => this.store.monthLabel().split(' ')[0]);

  readonly envs = computed<Envelope[]>(() => { const f = this.flow(); return f ? envelopes(this.store.categories(), f) : []; });
  readonly envBudget = computed(() => this.envs().reduce((a, e) => a + e.budget, 0));
  readonly envLeft = computed(() => this.envs().reduce((a, e) => a + Math.max(0, e.left), 0));
  readonly paceFraction = computed(() => { const f = this.flow(); return f ? f.day / f.days : 0; });
  readonly pace = computed(() => { const f = this.flow(); return f ? paceSeries(f, this.envs().map((e) => e.categoryId)) : []; });
  readonly status = computed(() => { const f = this.flow(); return f ? paceStatus(this.envs(), f) : 'ok'; });
  readonly overLabel = computed(() => {
    const over = this.envs().filter((e) => e.left < 0);
    return over.length === 1 ? `${over[0].name} : budget dépassé` : `${over.length} enveloppes dépassées`;
  });

  readonly charges = computed(() => fixedCharges(
    this.store.ui().month, this.store.contracts(), this.store.categories(), this.store.costs(), this.flow()?.contracts ?? [],
  ));
  readonly paid = computed(() => this.charges().reduce((a, c) => a + (c.paid ? c.amount : 0), 0));
  readonly pending = computed(() => this.charges().reduce((a, c) => a + (c.paid ? 0 : c.amount), 0));

  /** Le mois en cours : ce qui reste une fois les charges attendues payées. Un mois passé : son solde. */
  readonly heroValue = computed(() => {
    const s = this.store.summary();
    if (!s) return 0;
    return this.current() ? remainingToFinish(s, this.charges()) : s.balance;
  });

  readonly proposals = computed(() => proposeBudgets(this.store.categories(), this.store.completeMonths()));

  readonly watch = computed<Watch[]>(() => {
    const out: Watch[] = [];
    for (const d of this.store.deadlines()) {
      if (d.kind === 'preavis' && d.daysAway >= 0 && d.daysAway < 30) out.push({ kind: 'preavis', key: `p${d.contractId}-${d.date}`, d });
    }
    for (const r of this.store.home()?.energy.due ?? []) {
      out.push({ kind: 'releve', key: `r${r.contractId}`, contractId: r.contractId, name: r.name + (r.provider ? ' · ' + r.provider : ''), daysSince: r.daysSince });
    }
    // Dix comptes arrêtés le même jour sont un seul fait, pas dix lignes.
    const byDate = new Map<string, string[]>();
    for (const m of this.store.summary()?.missing ?? []) {
      const date = this.shortDate(m.coveredThrough || '');
      byDate.set(date, [...(byDate.get(date) ?? []), m.name]);
    }
    for (const [date, names] of byDate) {
      out.push({ kind: 'incomplet', key: 'i' + date, date, label: names.length > 3 ? `${names.length} comptes` : names.join(', ') });
    }
    if (this.store.toClassify().length) out.push({ kind: 'classer', key: 'c' });
    return out;
  });

  /**
   * Les catégories proposées pour la première opération à classer : la
   * suggestion (déjà classé ainsi, ou libellé ressemblant), puis les
   * catégories hors charges fixes les plus utilisées du mois.
   */
  readonly choices = computed(() => {
    const t = this.store.toClassify()[0];
    const hint = this.store.classifyHint();
    const ids: { id: number; suggested: boolean }[] = [];
    if (t && hint?.txId === t.id) ids.push({ id: hint.categoryId, suggested: true });
    // Une charge fixe se rattache à son contrat, pas à une opération de passage.
    const fixed = new Set(this.store.categories().filter((c) => c.fixed).map((c) => c.id));
    const top = (this.store.summary()?.categories ?? [])
      .filter((c) => c.categoryId !== null && c.spent > 0 && !fixed.has(c.categoryId)).sort((a, b) => b.spent - a.spent);
    for (const c of top) {
      if (ids.length >= 3) break;
      if (!ids.some((x) => x.id === c.categoryId)) ids.push({ id: c.categoryId!, suggested: false });
    }
    return ids.map((x) => ({ ...x, name: this.store.categoryPath(x.id) }));
  });

  /** Comptes actifs hors crédit, avec leur courbe des six derniers mois. */
  readonly accounts = computed(() => this.store.activeLedgerAccounts().map((a) => {
    const h = this.store.history()[a.id] ?? [];
    let spark: { points: string; lastX: number; lastY: number } | null = null;
    if (h.length > 1) {
      const mn = Math.min(...h), mx = Math.max(...h), span = mx - mn || 1;
      const pts = h.map((v, i) => [4 + i * (82 / (h.length - 1)), 30 - ((v - mn) / span) * 26]);
      spark = { points: pts.map((p) => p.join(',')).join(' '), lastX: pts[pts.length - 1][0], lastY: pts[pts.length - 1][1] };
    }
    return { id: a.id, name: a.name, balance: this.store.balanceOf(a.id), spark };
  }));

  readonly loans = computed(() => this.store.accounts().filter((a) => a.kind === 'credit' && !a.archived).flatMap((a) => {
    const l = this.store.loanOf(a.id);
    return l ? [{ id: a.id, name: a.name, owed: l.owed, pct: Math.round(l.progress * 100) }] : [];
  }));

  shortDate(iso: string): string {
    if (!iso) return '?';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  pick(txId: number, ev: Event): void {
    const id = Number((ev.target as HTMLSelectElement).value);
    if (id) void this.store.classify(txId, id);
  }

  onScroll(ev: Event): void {
    const el = ev.target as HTMLElement;
    const card = el.firstElementChild as HTMLElement | null;
    if (card) this.slide.set(Math.round(el.scrollLeft / (card.offsetWidth + 10)));
  }
}
