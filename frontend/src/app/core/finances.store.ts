import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  AccountKind, FinAccount, FinAction, FinActionKind, FinAlias, FinApplyReport, FinCategory,
  FinAsset, FinAssetKind, FinAssetStatus, FinCondition, FinConditionField, FinConditionOp, FinContract,
  FinContractCost, FinContractKind, FinContractRef, FinContractStatus, FinCoverage, FinDashboard,
  FinAttachment, FinDeadline, FinEnergySummary, FinImport, FinImportPreview, FinOwnerKind,
  FinPeriod, FinPeriodicity, FinReading, FinSaving, FinSavingStatus, FinSavingsTotals,
  FinMonthSummary, FinRule, FinRuleInput, FinRulePreview, FinTag, FinTransfer,
  FinTransferCandidate, FinTransaction, FinancesApi, TxKind,
} from './finances.api';
import { DayExtra, FoyerStore, SearchHit } from './foyer.store';
import { Notif } from './models';
import { CAL_KINDS } from './constants';

/**
 * Finances state. Unlike FoyerStore, which holds the whole household as one
 * document and resends it on every change, this store talks to granular
 * endpoints: a new transaction is one INSERT, not a rewrite of everything.
 */

export interface FinancesUi {
  tab: 'transactions' | 'bilan' | 'comptes' | 'categories' | 'contrats' | 'regles' | 'import';
  month: string;

  // transaction filters
  fltQuery: string; fltAccount: number | null; fltCategory: number | null;
  fltUncategorised: boolean; fltTag: string; fltContract: number | null; page: number;

  // transaction form
  txForm: boolean; txId: number | null;
  txLabel: string; txAmount: string; txSign: 'out' | 'in'; txDate: string;
  txAccount: number | null; txCategory: number | null; txContract: number | null;
  txNotes: string; txCleared: boolean;
  txDelId: number | null;

  // account form
  acForm: boolean; acId: number | null;
  acName: string; acKind: AccountKind; acMembers: string[]; acOpening: string; acOpeningDate: string; acArchived: boolean;
  acAliasInput: string; acDelId: number | null;

  // category form
  catForm: boolean; catId: number | null;
  catName: string; catBudget: string; catColor: string; catIcon: string; catParent: number | null;
  catDelId: number | null;

  // import
  importBusy: boolean;
  importError: string;
  /** Labels the user is currently mapping: unknown label to chosen account. */
  mapping: Record<string, number | null>;
  /** Candidates the user has ticked for merging. */
  picked: Record<string, boolean>;
  showWeakCandidates: boolean;
  undoImportId: number | null;

  // asset form
  asForm: boolean; asId: number | null;
  asName: string; asKind: FinAssetKind; asStatus: FinAssetStatus; asAddress: string;
  asAcquired: string; asSold: string; asNotes: string; asDelId: number | null;

  // contract form
  coForm: boolean; coId: number | null;
  coName: string; coProvider: string; coKind: FinContractKind;
  coAsset: number | null; coAccount: number | null; coCategory: number | null; coMembers: string[];
  coMin: string; coMax: string; coPeriodicity: FinPeriodicity;
  coRenewal: string; coNotice: string; coEnds: string;
  coStatus: FinContractStatus; coNotes: string; coRefs: FinContractRef[];
  coDelId: number | null;

  // rule editor
  ruleForm: boolean; ruleId: number | null;
  ruleName: string; ruleEnabled: boolean; ruleMatch: 'all' | 'any'; ruleStop: boolean;
  ruleConditions: FinCondition[]; ruleActions: FinAction[];
  // savings idea form
  saForm: boolean; saId: number | null;
  saTitle: string; saDesc: string; saGain: string; saStatus: FinSavingStatus;
  saContract: number | null; saDate: string; saDelId: number | null;

  // meter reading form
  reDate: string; reIndex: string; reIndexHp: string; reIndexHc: string;
  reKwh: string; reCost: string; reDelId: number | null;

  /** Fichier de sauvegarde déposé, en attente de confirmation. */
  restorePending: unknown | null;
  restoreName: string;

  ruleDelId: number | null; ruleError: string; ruleBusy: boolean;
  /** « Tout réappliquer » also overwrites the categories corrected by hand. */
  applyForce: boolean;

  busy: boolean;
}

function initialUi(month: string): FinancesUi {
  return {
    tab: 'transactions', month,
    fltQuery: '', fltAccount: null, fltCategory: null, fltUncategorised: false, fltTag: '', fltContract: null, page: 0,
    txForm: false, txId: null, txLabel: '', txAmount: '', txSign: 'out', txDate: '',
    txAccount: null, txCategory: null, txContract: null, txNotes: '', txCleared: false, txDelId: null,
    acForm: false, acId: null, acName: '', acKind: 'courant', acMembers: [], acOpening: '',
    acOpeningDate: '', acArchived: false, acAliasInput: '', acDelId: null,
    catForm: false, catId: null, catName: '', catBudget: '', catColor: '#7A9B76', catIcon: 'facture',
    catParent: null, catDelId: null,
    importBusy: false, importError: '', mapping: {}, picked: {},
    showWeakCandidates: false, undoImportId: null,
    asForm: false, asId: null, asName: '', asKind: 'immobilier', asStatus: 'actif', asAddress: '',
    asAcquired: '', asSold: '', asNotes: '', asDelId: null,
    coForm: false, coId: null, coName: '', coProvider: '', coKind: 'assurance',
    coAsset: null, coAccount: null, coCategory: null, coMembers: [],
    coMin: '', coMax: '', coPeriodicity: 'mensuelle', coRenewal: '', coNotice: '', coEnds: '',
    coStatus: 'actif', coNotes: '', coRefs: [], coDelId: null,
    saForm: false, saId: null, saTitle: '', saDesc: '', saGain: '', saStatus: 'idee',
    saContract: null, saDate: '', saDelId: null,
    reDate: '', reIndex: '', reIndexHp: '', reIndexHc: '', reKwh: '', reCost: '', reDelId: null,
    restorePending: null, restoreName: '',
    ruleForm: false, ruleId: null, ruleName: '', ruleEnabled: true, ruleMatch: 'all', ruleStop: false,
    ruleConditions: [], ruleActions: [], ruleDelId: null, ruleError: '', ruleBusy: false,
    applyForce: false,
    busy: false,
  };
}

const PAGE_SIZE = 50;

/** Operators the engine accepts per criterion; the editor must not offer others. */
const OPS_FOR: Record<FinConditionField, FinConditionOp[]> = {
  label: ['contains', 'notContains', 'equals', 'startsWith', 'regex'],
  amount: ['gt', 'lt', 'between', 'equals'],
  sens: ['is', 'isNot'],
  account: ['is', 'isNot'],
  dayOfMonth: ['equals', 'between', 'gt', 'lt'],
  date: ['between', 'before', 'after'],
};

/** Cents to a French euro string, e.g. -8430 gives « -84,30 ». */
export function fmtEuros(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Cents rounded to whole euros, for dense summary figures. */
export function fmtEurosInt(cents: number): string {
  return Math.round(cents / 100).toLocaleString('fr-FR');
}
/** Parse a typed amount into cents; null when nothing numeric was entered. */
function parseEuros(v: string): number | null {
  const s = String(v ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  if (!s || !/^-?\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

@Injectable({ providedIn: 'root' })
export class FinancesStore {
  private api = inject(FinancesApi);
  private foyer = inject(FoyerStore);

  readonly accounts = signal<FinAccount[]>([]);
  readonly categories = signal<FinCategory[]>([]);
  readonly balances = signal<Record<number, number>>({});
  readonly coverage = signal<FinCoverage[]>([]);
  readonly months = signal<string[]>([]);
  readonly aliases = signal<FinAlias[]>([]);
  readonly transactions = signal<FinTransaction[]>([]);
  readonly total = signal(0);
  readonly summary = signal<FinMonthSummary | null>(null);
  /** Summary of the month we are actually in, for notifications and the home tile. */
  readonly currentSummary = signal<FinMonthSummary | null>(null);
  readonly searchHits = signal<SearchHit[]>([]);
  readonly dashboard = signal<FinDashboard | null>(null);

  // Assets, contracts and deadlines
  readonly assets = signal<FinAsset[]>([]);
  readonly contracts = signal<FinContract[]>([]);
  readonly deadlines = signal<FinDeadline[]>([]);
  readonly costs = signal<Record<number, FinContractCost>>({});
  readonly pieces = signal<Record<number, number>>({});
  /** Attachments of the item currently open in a form. */
  readonly attachments = signal<FinAttachment[]>([]);

  // Meter readings of the contract currently open
  readonly savings = signal<FinSaving[]>([]);
  readonly savingsTotals = signal<FinSavingsTotals>({ pending: 0, done: 0, count: 0, openCount: 0 });

  readonly readings = signal<FinReading[]>([]);
  readonly periods = signal<FinPeriod[]>([]);
  readonly energy = signal<FinEnergySummary | null>(null);

  // Import workflow
  readonly preview = signal<FinImportPreview | null>(null);
  readonly imports = signal<FinImport[]>([]);
  readonly candidates = signal<FinTransferCandidate[]>([]);
  readonly transfers = signal<FinTransfer[]>([]);

  // Categorisation rules
  readonly rules = signal<FinRule[]>([]);
  readonly tags = signal<FinTag[]>([]);
  readonly rulePreview = signal<FinRulePreview | null>(null);
  readonly applyReport = signal<FinApplyReport | null>(null);
  readonly loaded = signal(false);
  readonly error = signal('');

  readonly ui = signal<FinancesUi>(initialUi(this.currentMonth()));

  constructor() {
    // Logging out must not leave the previous user's figures on screen for the next one.
    effect(() => { if (!this.foyer.authed() && this.loaded()) this.reset(); });
    // Budget overruns and incomplete months are notifications, but they are computed
    // here: FoyerStore must not depend on this store (it would be circular).
    effect(() => this.foyer.externalNotifs.set([
      ...this.buildNotifs(this.currentSummary()),
      ...this.deadlineNotifs(),
    ]));
    // Les échéances apparaissent dans le calendrier partagé sans y être stockées.
    effect(() => this.foyer.externalDayExtras.set(this.deadlineDayExtras()));
  }

  /** Overrun and coverage alerts for the month in progress. */
  private buildNotifs(s: FinMonthSummary | null): Notif[] {
    if (!s) return [];
    const out: Notif[] = [];
    for (const c of s.categories) {
      if (c.categoryId === null || c.budget <= 0 || c.spent <= c.budget) continue;
      out.push({
        id: `fin-budget-${c.categoryId}-${s.month}`, kind: 'budget',
        title: `Budget « ${c.name} » dépassé`,
        desc: `${fmtEurosInt(c.spent)} € dépensés sur ${fmtEurosInt(c.budget)} €`,
        time: 'Ce mois-ci', read: false,
      });
    }
    if (s.incomplete) {
      out.push({
        id: `fin-incomplet-${s.month}-${s.missing.map((m) => m.accountId).join('-')}`, kind: 'budget',
        title: 'Mois incomplet dans les finances',
        desc: s.missing.map((m) => `${m.name} : données jusqu'au ${this.foyer.fmtNumDate(m.coveredThrough || '')}`).join(', '),
        time: 'À vérifier', read: false,
      });
    }
    return out;
  }

  /** Libellés des échéances, partagés par les notifications, les tâches et l'écran. */
  private deadlineLabel(kind: string): string {
    return kind === 'preavis' ? 'Dernier jour pour résilier'
      : kind === 'renouvellement' ? 'Reconduction tacite'
      : 'Fin du contrat';
  }

  /** Version courte : une case de calendrier fait quelques dizaines de pixels. */
  private shortDeadlineLabel(kind: string): string {
    return kind === 'preavis' ? 'Résilier' : kind === 'renouvellement' ? 'Reconduction' : 'Fin';
  }

  /** Repères de calendrier, un par échéance à venir. */
  private deadlineDayExtras(): Record<string, DayExtra[]> {
    const out: Record<string, DayExtra[]> = {};
    // Les échéances passées sont affichées elles aussi : elles sont sur une date
    // révolue, donc seule une navigation en arrière les fait apparaître, et une
    // fenêtre de résiliation manquée explique pourquoi rien n'est possible cette
    // année. L'écran Contrats les montre déjà, le calendrier ne peut pas dire
    // l'inverse.
    for (const d of this.deadlines()) {
      const item: DayExtra = {
        kind: 'echeance',
        label: `${this.shortDeadlineLabel(d.kind)} : ${d.contractName}`,
        color: CAL_KINDS['echeance'].color,
        // Le type est déjà dans le libellé : le complément se réduit au
        // fournisseur, sans quoi il mange la place et tronque l'essentiel.
        sub: d.provider || undefined,
      };
      (out[d.date] ??= []).push(item);
    }
    return out;
  }

  /**
   * Alerte sur les seules échéances qui coûtent de l'argent si on les manque :
   * la fenêtre de résiliation, et seulement dans le mois qui précède. Alerter
   * six mois à l'avance apprendrait surtout à ignorer l'alerte.
   */
  private deadlineNotifs(): Notif[] {
    return this.deadlines()
      .filter((d) => d.kind === 'preavis' && d.daysAway >= 0 && d.daysAway <= 30)
      .map((d) => ({
        id: `fin-preavis-${d.contractId}-${d.date}`,
        kind: 'budget',
        title: `Résiliation possible jusqu'au ${this.foyer.fmtNumDate(d.date)}`,
        desc: `${d.contractName}${d.provider ? ' · ' + d.provider : ''}. Passé ce jour, le contrat est reconduit.`,
        time: d.daysAway === 0 ? "Aujourd'hui" : `Dans ${d.daysAway} jour${d.daysAway > 1 ? 's' : ''}`,
        read: false,
      }));
  }

  /** Copier une échéance dans les tâches, à la demande et une seule fois. */
  taskFromDeadline(contractId: number, kind: string, date: string): void {
    const c = this.contracts().find((x) => x.id === contractId);
    if (!c) return;
    this.foyer.addExternalTask(`${this.deadlineLabel(kind)} : ${c.name}`, date, c.memberIds[0] ?? null);
  }

  patch(p: Partial<FinancesUi>): void { this.ui.update((u) => ({ ...u, ...p })); }

  /** Current month (YYYY-MM) in the household time zone. */
  private currentMonth(): string { return this.foyer.todayStr().slice(0, 7); }

  readonly activeAccounts = computed(() => this.accounts().filter((a) => !a.archived));
  readonly rootCategories = computed(() => this.categories().filter((c) => c.parentId === null));
  childrenOf(id: number): FinCategory[] { return this.categories().filter((c) => c.parentId === id); }

  accountName(id: number): string { return this.accounts().find((a) => a.id === id)?.name || 'Compte supprimé'; }
  categoryColor(id: number | null): string { return (id ? this.categories().find((c) => c.id === id)?.color : null) || '#8A7E74'; }
  categoryIcon(id: number | null): string { return (id ? this.categories().find((c) => c.id === id)?.icon : null) || 'facture'; }
  /** Full path of a category, e.g. « Alimentation · Supermarché ». */
  categoryPath(id: number | null): string {
    const c = id ? this.categories().find((x) => x.id === id) : null;
    if (!c) return 'Sans catégorie';
    const parent = c.parentId ? this.categories().find((x) => x.id === c.parentId) : null;
    return parent ? `${parent.name} · ${c.name}` : c.name;
  }
  balanceOf(id: number): number { return this.balances()[id] ?? 0; }
  coverageOf(id: number): FinCoverage | undefined { return this.coverage().find((c) => c.accountId === id); }

  // ---- lifecycle ---------------------------------------------------------
  /** Load reference data once per session; the screen calls this on first open. */
  async init(force = false): Promise<void> {
    if (this.loaded() && !force) return;
    try {
      const b = await this.api.bootstrap();
      this.accounts.set(b.accounts);
      this.categories.set(b.categories);
      this.balances.set(b.balances);
      this.coverage.set(b.coverage);
      this.months.set(b.months);
      this.aliases.set(b.aliases);
      // Land on the most recent month that actually holds data.
      if (b.months.length && !b.months.includes(this.ui().month)) this.patch({ month: b.months[0] });
      this.loaded.set(true);
      this.error.set('');
      // Rules are loaded up front: an operation's form names the rule that
      // decided its category, and that must not depend on visiting the tab.
      await Promise.all([this.reloadTransactions(), this.reloadSummary(), this.loadRules(), this.loadContracts()]);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  reset(): void {
    this.accounts.set([]); this.categories.set([]); this.balances.set({});
    this.coverage.set([]); this.months.set([]); this.aliases.set([]);
    this.transactions.set([]); this.total.set(0); this.summary.set(null);
    this.currentSummary.set(null); this.searchHits.set([]); this.dashboard.set(null);
    this.assets.set([]); this.contracts.set([]); this.deadlines.set([]); this.costs.set({});
    this.pieces.set({}); this.attachments.set([]);
    this.readings.set([]); this.periods.set([]); this.energy.set(null);
    this.savings.set([]); this.savingsTotals.set({ pending: 0, done: 0, count: 0, openCount: 0 });
    this.preview.set(null); this.imports.set([]); this.candidates.set([]); this.transfers.set([]);
    this.rules.set([]); this.tags.set([]); this.rulePreview.set(null); this.applyReport.set(null);
    this.loaded.set(false); this.error.set('');
    this.ui.set(initialUi(this.currentMonth()));
  }

  private async refreshReference(): Promise<void> {
    const b = await this.api.bootstrap();
    this.accounts.set(b.accounts);
    this.categories.set(b.categories);
    this.balances.set(b.balances);
    this.coverage.set(b.coverage);
    this.months.set(b.months);
    this.aliases.set(b.aliases);
  }

  // ---- month navigation --------------------------------------------------
  private shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number);
    const idx = y * 12 + (m - 1) + delta;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  }
  prevMonth(): void { this.setMonth(this.shiftMonth(this.ui().month, -1)); }
  nextMonth(): void { this.setMonth(this.shiftMonth(this.ui().month, 1)); }
  setMonth(month: string): void {
    this.patch({ month, page: 0 });
    void this.reloadTransactions();
    void this.reloadSummary();
    if (this.dashboard()) void this.loadDashboard();
  }

  /** Aggregates of the displayed month, its twelve predecessors and the year. */
  async loadDashboard(): Promise<void> {
    try {
      this.dashboard.set((await this.api.dashboard(this.ui().month)).dashboard);
      this.error.set('');
    } catch (e) { this.error.set((e as Error).message); }
  }
  readonly monthLabel = computed(() => {
    const [y, m] = this.ui().month.split('-').map(Number);
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  });
  readonly isCurrentMonth = computed(() => this.ui().month === this.currentMonth());

  // ---- transactions ------------------------------------------------------
  private monthBounds(month: string): { from: string; to: string } {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
  }

  async reloadTransactions(): Promise<void> {
    const u = this.ui();
    // Some filters are inherently cross-period: a search, an étiquette, a contract
    // that has run for years. Keeping the month bounds on those would silently
    // return nothing. Without such a filter, the list follows the displayed month.
    const bounds = this.spansHistory() ? {} : this.monthBounds(u.month);
    try {
      const r = await this.api.transactions({
        ...bounds,
        accountId: u.fltAccount ?? undefined,
        categoryId: u.fltCategory ?? undefined,
        uncategorised: u.fltUncategorised || undefined,
        contractId: u.fltContract ?? undefined,
        tag: u.fltTag || undefined,
        q: u.fltQuery.trim() || undefined,
        limit: PAGE_SIZE,
        offset: u.page * PAGE_SIZE,
      });
      this.transactions.set(r.rows);
      this.total.set(r.total);
      this.error.set('');
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  async reloadSummary(): Promise<void> {
    const month = this.ui().month;
    const now = this.currentMonth();
    try {
      const s = (await this.api.summary(month)).summary;
      this.summary.set(s);
      // Le mois affiché peut être un mois d'archive : les notifications et la tuile
      // d'accueil parlent toujours du mois en cours.
      if (month === now) this.currentSummary.set(s);
      else this.currentSummary.set((await this.api.summary(now)).summary);
    } catch (e) { this.error.set((e as Error).message); }
  }

  /** Search transactions server-side, for the global search palette. */
  async search(q: string): Promise<void> {
    const query = q.trim();
    if (query.length < 2) { this.searchHits.set([]); return; }
    try {
      const r = await this.api.transactions({ q: query, limit: 12 });
      this.searchHits.set(r.rows.map((t) => ({
        kind: 'fin', icon: 'budget', color: t.amount > 0 ? '#6E9E5F' : '#C6492F',
        title: t.label,
        sub: `${this.foyer.fmtNumDate(t.date)} · ${this.accountName(t.accountId)} · ${t.amount > 0 ? '+' : '−'}${fmtEuros(Math.abs(t.amount))} €`,
        screen: 'finances', id: String(t.id),
      })));
    } catch { this.searchHits.set([]); }
  }

  /** Open the Finances screen filtered on a search hit's label. */
  openSearchHit(h: SearchHit): void {
    this.foyer.go('finances');
    this.patch({ tab: 'transactions', fltQuery: h.title, fltAccount: null, fltCategory: null, fltUncategorised: false, fltTag: '', fltContract: null, page: 0 });
    void this.reloadTransactions();
  }

  setFilter(p: Partial<FinancesUi>): void {
    this.patch({ ...p, page: 0 });
    void this.reloadTransactions();
  }
  clearFilters(): void {
    this.patch({ fltQuery: '', fltAccount: null, fltCategory: null, fltUncategorised: false, fltTag: '', fltContract: null, page: 0 });
    void this.reloadTransactions();
  }
  /** True when the active filters make the month bounds meaningless. */
  readonly spansHistory = computed(() => {
    const u = this.ui();
    return !!(u.fltQuery.trim() || u.fltTag || u.fltContract);
  });
  readonly hasFilters = computed(() => {
    const u = this.ui();
    return !!(u.fltQuery.trim() || u.fltAccount || u.fltCategory || u.fltUncategorised || u.fltTag || u.fltContract);
  });
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  goPage(p: number): void {
    this.patch({ page: Math.min(Math.max(p, 0), this.pageCount() - 1) });
    void this.reloadTransactions();
  }

  newTx(): void {
    const { from } = this.monthBounds(this.ui().month);
    const today = this.foyer.todayStr();
    this.patch({
      txForm: true, txId: null, txLabel: '', txAmount: '', txSign: 'out',
      txDate: this.isCurrentMonth() ? today : from,
      txAccount: this.ui().fltAccount ?? this.activeAccounts()[0]?.id ?? null,
      txCategory: null, txContract: null, txNotes: '', txCleared: false,
    });
  }

  editTx(id: number): void {
    const t = this.transactions().find((x) => x.id === id);
    if (!t) return;
    this.patch({
      txForm: true, txId: t.id, txLabel: t.label, txAmount: fmtEuros(Math.abs(t.amount)),
      txSign: t.amount < 0 ? 'out' : 'in', txDate: t.date, txAccount: t.accountId,
      txCategory: t.categoryId, txContract: t.contractId, txNotes: t.notes, txCleared: t.cleared,
    });
  }

  async saveTx(): Promise<void> {
    const u = this.ui();
    if (u.busy) return;
    const label = u.txLabel.trim();
    if (!label) { this.foyer.toast('Donnez un libellé à l’opération'); return; }
    if (!u.txAccount) { this.foyer.toast('Choisissez un compte'); return; }
    const cents = parseEuros(u.txAmount);
    if (cents === null || cents === 0) { this.foyer.toast('Saisissez un montant, par exemple 84,30'); return; }
    if (!u.txDate) { this.foyer.toast('Choisissez une date'); return; }
    const signed = u.txSign === 'out' ? -Math.abs(cents) : Math.abs(cents);

    const payload = {
      accountId: u.txAccount, date: u.txDate, amount: (signed / 100).toFixed(2),
      kind: (u.txSign === 'out' ? 'depense' : 'recette') as TxKind,
      label, categoryId: u.txSign === 'out' ? u.txCategory : null,
      contractId: u.txSign === 'out' ? u.txContract : null,
      notes: u.txNotes.trim(), cleared: u.txCleared,
    };
    this.patch({ busy: true });
    try {
      if (u.txId) await this.api.updateTransaction(u.txId, payload);
      else await this.api.createTransaction(payload);
      this.patch({ txForm: false, txId: null, busy: false });
      await this.afterWrite();
      this.foyer.toast(u.txId ? 'Opération modifiée' : 'Opération ajoutée');
    } catch (e) {
      this.patch({ busy: false });
      this.foyer.toast((e as Error).message);
    }
  }

  async confirmTxDel(): Promise<void> {
    const id = this.ui().txDelId;
    if (!id) return;
    try {
      await this.api.deleteTransaction(id);
      this.patch({ txDelId: null, txForm: false, txId: null });
      await this.afterWrite();
      this.foyer.toast('Opération supprimée');
    } catch (e) {
      this.patch({ txDelId: null });
      this.foyer.toast((e as Error).message);
    }
  }

  /** Anything that changes money reloads the list, the balances and the summary. */
  private async afterWrite(): Promise<void> {
    await Promise.all([
      this.reloadTransactions(), this.reloadSummary(), this.refreshReference(),
      this.dashboard() ? this.loadDashboard() : Promise.resolve(),
      this.loadContracts(),
    ]);
  }

  // ---- accounts ----------------------------------------------------------
  newAccount(): void {
    this.patch({
      acForm: true, acId: null, acName: '', acKind: 'courant', acMembers: [],
      acOpening: '', acOpeningDate: '', acArchived: false, acAliasInput: '',
    });
  }

  editAccount(id: number): void {
    const a = this.accounts().find((x) => x.id === id);
    if (!a) return;
    this.patch({
      acForm: true, acId: a.id, acName: a.name, acKind: a.kind, acMembers: [...a.memberIds],
      acOpening: a.openingBalance ? fmtEuros(a.openingBalance) : '', acOpeningDate: a.openingDate || '',
      acArchived: a.archived, acAliasInput: '',
    });
  }

  async saveAccount(): Promise<void> {
    const u = this.ui();
    if (u.busy) return;
    const name = u.acName.trim();
    if (!name) { this.foyer.toast('Donnez un nom au compte'); return; }
    const opening = u.acOpening.trim();
    if (opening && parseEuros(opening) === null) { this.foyer.toast('Solde d’ouverture invalide'); return; }
    const payload = {
      name, kind: u.acKind, memberIds: u.acMembers,
      openingBalance: opening ? ((parseEuros(opening) as number) / 100).toFixed(2) : '0',
      openingDate: u.acOpeningDate || null, archived: u.acArchived,
    };
    this.patch({ busy: true });
    try {
      if (u.acId) await this.api.updateAccount(u.acId, payload);
      else await this.api.createAccount(payload);
      this.patch({ acForm: false, acId: null, busy: false });
      await this.afterWrite();
      this.foyer.toast(u.acId ? 'Compte modifié' : 'Compte créé');
    } catch (e) {
      this.patch({ busy: false });
      this.foyer.toast((e as Error).message);
    }
  }

  async confirmAccountDel(): Promise<void> {
    const id = this.ui().acDelId;
    if (!id) return;
    try {
      await this.api.deleteAccount(id);
      this.patch({ acDelId: null, acForm: false, acId: null });
      await this.afterWrite();
      this.foyer.toast('Compte supprimé');
    } catch (e) {
      // A populated account cannot be deleted: the message explains how to archive it.
      this.patch({ acDelId: null });
      this.foyer.toast((e as Error).message);
    }
  }

  aliasesOf(accountId: number): FinAlias[] { return this.aliases().filter((a) => a.accountId === accountId); }

  async addAlias(): Promise<void> {
    const u = this.ui();
    const label = u.acAliasInput.trim();
    if (!u.acId || !label) return;
    try {
      this.aliases.set((await this.api.addAlias(u.acId, label)).aliases);
      this.patch({ acAliasInput: '' });
    } catch (e) { this.foyer.toast((e as Error).message); }
  }

  async removeAlias(id: number): Promise<void> {
    try { this.aliases.set((await this.api.deleteAlias(id)).aliases); }
    catch (e) { this.foyer.toast((e as Error).message); }
  }

  // ---- categories --------------------------------------------------------
  newCategory(parentId: number | null = null): void {
    this.patch({
      catForm: true, catId: null, catName: '', catBudget: '',
      catColor: '#7A9B76', catIcon: 'facture', catParent: parentId,
    });
  }

  editCategory(id: number): void {
    const c = this.categories().find((x) => x.id === id);
    if (!c) return;
    this.patch({
      catForm: true, catId: c.id, catName: c.name,
      catBudget: c.monthlyBudget ? fmtEuros(c.monthlyBudget) : '',
      catColor: c.color, catIcon: c.icon, catParent: c.parentId,
    });
  }

  async saveCategory(): Promise<void> {
    const u = this.ui();
    if (u.busy) return;
    const name = u.catName.trim();
    if (!name) { this.foyer.toast('Donnez un nom à la catégorie'); return; }
    const budget = u.catBudget.trim();
    if (budget && parseEuros(budget) === null) { this.foyer.toast('Budget mensuel invalide'); return; }
    const payload = {
      parentId: u.catParent, name,
      monthlyBudget: budget ? (Math.abs(parseEuros(budget) as number) / 100).toFixed(2) : '0',
      color: u.catColor, icon: u.catIcon,
    };
    this.patch({ busy: true });
    try {
      if (u.catId) await this.api.updateCategory(u.catId, payload);
      else await this.api.createCategory(payload);
      this.patch({ catForm: false, catId: null, busy: false });
      await this.afterWrite();
      this.foyer.toast(u.catId ? 'Catégorie modifiée' : 'Catégorie créée');
    } catch (e) {
      this.patch({ busy: false });
      this.foyer.toast((e as Error).message);
    }
  }

  async confirmCategoryDel(): Promise<void> {
    const id = this.ui().catDelId;
    if (!id) return;
    try {
      await this.api.deleteCategory(id);
      this.patch({ catDelId: null, catForm: false, catId: null });
      await this.afterWrite();
      this.foyer.toast('Catégorie supprimée');
    } catch (e) {
      this.patch({ catDelId: null });
      this.foyer.toast((e as Error).message);
    }
  }

  // ---- import ------------------------------------------------------------
  async loadImports(): Promise<void> {
    try {
      const [i, t] = await Promise.all([this.api.imports(), this.api.transfers()]);
      this.imports.set(i.imports);
      this.transfers.set(t.transfers);
    } catch (e) { this.patch({ importError: (e as Error).message }); }
  }

  /** Upload a file and show the report. Nothing is written yet. */
  async upload(file: File): Promise<void> {
    if (this.ui().importBusy) return;
    this.patch({ importBusy: true, importError: '', mapping: {}, picked: {} });
    this.preview.set(null);
    this.candidates.set([]);
    try {
      const { preview } = await this.api.uploadImport(file);
      this.preview.set(preview);
      // A label identical to an account name arrives pre-selected: still one
      // click to confirm, because an alias is remembered for good.
      this.patch({ importBusy: false, mapping: Object.fromEntries(preview.unknownAccounts.map((u) => [u.label, u.suggestedAccountId])) });
    } catch (e) {
      this.patch({ importBusy: false, importError: (e as Error).message });
    }
  }

  /** Attach an unknown export label to an account, then refresh the report. */
  async mapAccount(label: string): Promise<void> {
    const p = this.preview();
    const accountId = this.ui().mapping[label];
    if (!p || !accountId) { this.foyer.toast('Choisissez le compte à rattacher'); return; }
    this.patch({ importBusy: true, importError: '' });
    try {
      const { preview } = await this.api.mapImportAccount(p.importId, label, accountId);
      this.preview.set(preview);
      this.patch({ importBusy: false, mapping: Object.fromEntries(preview.unknownAccounts.map((u) => [u.label, this.ui().mapping[u.label] ?? u.suggestedAccountId])) });
    } catch (e) {
      this.patch({ importBusy: false, importError: (e as Error).message });
    }
  }

  /** Write the import, then offer the internal transfers it made possible. */
  async commitImport(): Promise<void> {
    const p = this.preview();
    if (!p || p.blocked || this.ui().importBusy) return;
    this.patch({ importBusy: true, importError: '' });
    try {
      const r = await this.api.commitImport(p.importId);
      this.preview.set(null);
      this.patch({ importBusy: false });
      // The rules run on the fresh rows straight away: say how many they filed.
      const filed = r.categorised?.changed ?? 0;
      this.foyer.toast(`${r.inserted} opération${r.inserted > 1 ? 's' : ''} importée${r.inserted > 1 ? 's' : ''}`
        + (filed ? `, ${filed} rangée${filed > 1 ? 's' : ''} par vos règles` : ''));
      await Promise.all([this.afterWrite(), this.loadImports()]);
      await this.loadCandidates();
    } catch (e) {
      this.patch({ importBusy: false, importError: (e as Error).message });
    }
  }

  async discardPreview(): Promise<void> {
    const p = this.preview();
    if (!p) return;
    try { await this.api.discardImport(p.importId); } catch { /* le brouillon expirera de lui-même */ }
    this.preview.set(null);
    this.patch({ importError: '', mapping: {} });
    // Uploading a file hides the pending transfers to keep the report in focus;
    // abandoning it must bring them back rather than leave them lost.
    await this.loadCandidates();
  }

  /** Undo a committed import: its rows leave, nothing else moves. */
  async undoImport(): Promise<void> {
    const id = this.ui().undoImportId;
    if (!id) return;
    this.patch({ importBusy: true });
    try {
      const r = await this.api.discardImport(id);
      this.patch({ importBusy: false, undoImportId: null });
      this.foyer.toast(`${r.deleted ?? 0} opération${(r.deleted ?? 0) > 1 ? 's' : ''} retirée${(r.deleted ?? 0) > 1 ? 's' : ''}`);
      await Promise.all([this.afterWrite(), this.loadImports()]);
      await this.loadCandidates();
    } catch (e) {
      this.patch({ importBusy: false, undoImportId: null, importError: (e as Error).message });
    }
  }

  /** Candidate transfers over the whole known history. */
  async loadCandidates(): Promise<void> {
    const months = this.months();
    if (!months.length) { this.candidates.set([]); return; }
    const from = months[months.length - 1] + '-01';
    const to = this.foyer.todayStr();
    try {
      const { candidates } = await this.api.transferCandidates(from, to > from ? to : from);
      this.candidates.set(candidates);
      // Only the strong ones are ticked: a weak pair must be an explicit choice.
      this.patch({ picked: Object.fromEntries(candidates.map((c) => [this.pairKey(c), c.confidence === 'forte'])) });
    } catch (e) { this.patch({ importError: (e as Error).message }); }
  }

  pairKey(c: FinTransferCandidate): string { return `${c.debit.id}-${c.credit.id}`; }
  isPicked(c: FinTransferCandidate): boolean { return !!this.ui().picked[this.pairKey(c)]; }
  togglePick(c: FinTransferCandidate): void {
    const key = this.pairKey(c);
    this.patch({ picked: { ...this.ui().picked, [key]: !this.ui().picked[key] } });
  }
  readonly pickedCount = computed(() => this.candidates().filter((c) => this.isPicked(c)).length);
  readonly strongCandidates = computed(() => this.candidates().filter((c) => c.confidence !== 'faible'));
  readonly weakCandidates = computed(() => this.candidates().filter((c) => c.confidence === 'faible'));

  /** Merge only what the user ticked. Nothing is ever merged on its own. */
  async mergePicked(): Promise<void> {
    const pairs = this.candidates().filter((c) => this.isPicked(c)).map((c) => ({ debitId: c.debit.id, creditId: c.credit.id }));
    if (!pairs.length) { this.foyer.toast('Cochez au moins un rapprochement'); return; }
    this.patch({ importBusy: true });
    try {
      const r = await this.api.mergeTransfers(pairs);
      this.patch({ importBusy: false });
      this.foyer.toast(r.failed.length
        ? `${r.merged} virement(s) validé(s), ${r.failed.length} refusé(s)`
        : `${r.merged} virement${r.merged > 1 ? 's' : ''} interne${r.merged > 1 ? 's' : ''} validé${r.merged > 1 ? 's' : ''}`);
      if (r.failed.length) this.patch({ importError: r.failed[0].error });
      await Promise.all([this.afterWrite(), this.loadCandidates(), this.loadImports()]);
    } catch (e) {
      this.patch({ importBusy: false, importError: (e as Error).message });
    }
  }

  async splitTransfer(group: string): Promise<void> {
    try {
      await this.api.splitTransfer(group);
      this.foyer.toast('Virement séparé en deux opérations');
      await Promise.all([this.afterWrite(), this.loadCandidates(), this.loadImports()]);
    } catch (e) { this.patch({ importError: (e as Error).message }); }
  }

  // ---- categorisation rules ----------------------------------------------
  async loadRules(): Promise<void> {
    try {
      const r = await this.api.rules();
      this.rules.set(r.rules);
      this.tags.set(r.tags);
    } catch (e) { this.patch({ ruleError: (e as Error).message }); }
  }

  private blankCondition(): FinCondition { return { field: 'label', op: 'contains', value: '', value2: '' }; }

  newRule(): void {
    this.patch({
      ruleForm: true, ruleId: null, ruleName: '', ruleEnabled: true, ruleMatch: 'all', ruleStop: false,
      ruleConditions: [this.blankCondition()], ruleActions: [{ kind: 'category', value: '' }],
      ruleError: '',
    });
    this.rulePreview.set(null);
  }

  /**
   * Start a rule from an operation the user is looking at. The label and the
   * amount are pre-filled because that pair is exactly what tells two contracts
   * of the same provider apart.
   */
  ruleFromTx(id: number): void {
    const t = this.transactions().find((x) => x.id === id);
    if (!t) return;
    const euros = Math.abs(t.amount) / 100;
    this.patch({
      tab: 'regles', txForm: false,
      ruleForm: true, ruleId: null, ruleName: t.label.slice(0, 60), ruleEnabled: true,
      ruleMatch: 'all', ruleStop: false, ruleError: '',
      ruleConditions: [
        { field: 'label', op: 'contains', value: t.label, value2: '' },
        // Whole-euro bounds, deliberately loose: a subscription that goes up by
        // a few cents must keep matching without editing the rule.
        { field: 'amount', op: 'between', value: String(Math.floor(euros * 0.95)), value2: String(Math.ceil(euros * 1.05)) },
      ],
      ruleActions: [{ kind: 'category', value: t.categoryId ? String(t.categoryId) : '' }],
    });
    this.rulePreview.set(null);
    void this.loadRules();
  }

  /**
   * Démarrer une règle depuis un contrat. Le libellé bancaire ressemble au
   * fournisseur bien plus qu'au nom que vous avez donné au contrat, et c'est la
   * fourchette de montant qui distingue deux contrats du même assureur : les
   * deux servent de conditions, l'action rattache au contrat.
   */
  ruleFromContract(contractId: number): void {
    const c = this.contracts().find((x) => x.id === contractId);
    if (!c) return;
    const conditions: FinCondition[] = [
      { field: 'label', op: 'contains', value: c.provider || c.name, value2: '' },
    ];
    if (c.amountMin !== null || c.amountMax !== null) {
      const min = c.amountMin ?? c.amountMax!;
      const max = c.amountMax ?? c.amountMin!;
      conditions.push({
        field: 'amount', op: 'between',
        value: String(Math.floor(min / 100)), value2: String(Math.ceil(max / 100)),
      });
    }
    const actions: FinAction[] = [{ kind: 'contract', value: String(c.id) }];
    if (c.categoryId) actions.push({ kind: 'category', value: String(c.categoryId) });

    this.patch({
      tab: 'regles', coForm: false, coId: null,
      ruleForm: true, ruleId: null, ruleName: c.name.slice(0, 60), ruleEnabled: true,
      ruleMatch: 'all', ruleStop: false, ruleError: '',
      ruleConditions: conditions, ruleActions: actions,
    });
    this.rulePreview.set(null);
    void this.loadRules();
  }

  editRule(id: number): void {
    const r = this.rules().find((x) => x.id === id);
    if (!r) return;
    this.patch({
      ruleForm: true, ruleId: r.id, ruleName: r.name, ruleEnabled: r.enabled,
      ruleMatch: r.matchMode, ruleStop: r.stop, ruleError: '',
      ruleConditions: r.conditions.map((c) => ({ ...c })),
      ruleActions: r.actions.map((a) => ({ ...a })),
    });
    this.rulePreview.set(null);
  }

  addCondition(): void { this.patch({ ruleConditions: [...this.ui().ruleConditions, this.blankCondition()] }); }
  removeCondition(i: number): void { this.patch({ ruleConditions: this.ui().ruleConditions.filter((_, k) => k !== i) }); }
  /** Changing the criterion resets the operator: « contient » means nothing on a date. */
  setConditionField(i: number, field: FinConditionField): void {
    this.patchCondition(i, { field, op: OPS_FOR[field][0], value: '', value2: '' });
  }
  patchCondition(i: number, p: Partial<FinCondition>): void {
    this.patch({ ruleConditions: this.ui().ruleConditions.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  }
  opsFor(field: FinConditionField): FinConditionOp[] { return OPS_FOR[field]; }

  addAction(kind: FinActionKind): void { this.patch({ ruleActions: [...this.ui().ruleActions, { kind, value: '' }] }); }
  removeAction(i: number): void { this.patch({ ruleActions: this.ui().ruleActions.filter((_, k) => k !== i) }); }
  patchAction(i: number, value: string): void {
    this.patch({ ruleActions: this.ui().ruleActions.map((a, k) => (k === i ? { ...a, value } : a)) });
  }

  private ruleInput(): FinRuleInput {
    const u = this.ui();
    return {
      name: u.ruleName.trim(), enabled: u.ruleEnabled, matchMode: u.ruleMatch, stop: u.ruleStop,
      conditions: u.ruleConditions, actions: u.ruleActions,
    };
  }

  /** Show what the rule in the editor would change, before saving anything. */
  async previewRule(): Promise<void> {
    if (this.ui().ruleBusy) return;
    this.patch({ ruleBusy: true, ruleError: '' });
    try {
      const { preview } = await this.api.previewRule(this.ruleInput());
      this.rulePreview.set(preview);
      this.patch({ ruleBusy: false });
    } catch (e) {
      this.rulePreview.set(null);
      this.patch({ ruleBusy: false, ruleError: (e as Error).message });
    }
  }

  /** Save, then apply straight away: a rule that changes nothing is a trap. */
  async saveRule(): Promise<void> {
    const u = this.ui();
    if (u.ruleBusy) return;
    this.patch({ ruleBusy: true, ruleError: '' });
    try {
      if (u.ruleId) await this.api.updateRule(u.ruleId, this.ruleInput());
      else await this.api.createRule(this.ruleInput());
      const { report } = await this.api.applyRules({});
      this.applyReport.set(report);
      this.patch({ ruleForm: false, ruleId: null, ruleBusy: false });
      this.rulePreview.set(null);
      await Promise.all([this.loadRules(), this.afterWrite()]);
      this.foyer.toast(report.changed
        ? `${report.changed} opération${report.changed > 1 ? 's' : ''} recatégorisée${report.changed > 1 ? 's' : ''}`
        : 'Règle enregistrée, aucune opération à modifier');
    } catch (e) {
      this.patch({ ruleBusy: false, ruleError: (e as Error).message });
    }
  }

  async confirmRuleDel(): Promise<void> {
    const id = this.ui().ruleDelId;
    if (!id) return;
    try {
      this.rules.set((await this.api.deleteRule(id)).rules);
      this.patch({ ruleDelId: null, ruleForm: false, ruleId: null });
      await this.afterWrite();
      // The rows it had decided keep their category, but nobody owns it any more.
      this.foyer.toast('Règle supprimée, les opérations gardent leur catégorie');
    } catch (e) {
      this.patch({ ruleDelId: null, ruleError: (e as Error).message });
    }
  }

  async moveRule(id: number, delta: 1 | -1): Promise<void> {
    try { this.rules.set((await this.api.moveRule(id, delta)).rules); }
    catch (e) { this.patch({ ruleError: (e as Error).message }); }
  }

  /** Enable or disable without opening the editor. */
  async toggleRule(id: number): Promise<void> {
    const r = this.rules().find((x) => x.id === id);
    if (!r) return;
    try {
      await this.api.updateRule(id, { ...r, enabled: !r.enabled });
      await Promise.all([this.loadRules(), this.afterWrite()]);
    } catch (e) { this.patch({ ruleError: (e as Error).message }); }
  }

  /** Replay every enabled rule over the whole history. */
  async applyAll(): Promise<void> {
    if (this.ui().ruleBusy) return;
    this.patch({ ruleBusy: true, ruleError: '' });
    try {
      const { report } = await this.api.applyRules({ force: this.ui().applyForce });
      this.applyReport.set(report);
      this.patch({ ruleBusy: false });
      await Promise.all([this.loadRules(), this.afterWrite()]);
      this.foyer.toast(`${report.examined} opération${report.examined > 1 ? 's' : ''} passée${report.examined > 1 ? 's' : ''} en revue, ${report.changed} modifiée${report.changed > 1 ? 's' : ''}`);
    } catch (e) {
      this.patch({ ruleBusy: false, ruleError: (e as Error).message });
    }
  }

  /** Filter the operation list on a tag, from the rules tab. */
  filterByTag(name: string): void {
    this.patch({ tab: 'transactions', fltTag: name, fltQuery: '', fltAccount: null, fltCategory: null, fltUncategorised: false, fltContract: null, page: 0 });
    void this.reloadTransactions();
  }

  // ---- assets and contracts ----------------------------------------------
  async loadContracts(): Promise<void> {
    try {
      const b = await this.api.contracts();
      this.assets.set(b.assets);
      this.contracts.set(b.contracts);
      this.deadlines.set(b.deadlines);
      this.costs.set(b.costs);
      this.pieces.set(b.pieces);
      this.savings.set(b.savings);
      this.savingsTotals.set(b.savingsTotals);
      this.error.set('');
    } catch (e) { this.error.set((e as Error).message); }
  }

  contractName(id: number | null): string {
    return (id ? this.contracts().find((c) => c.id === id)?.name : null) || '';
  }
  assetName(id: number | null): string {
    return (id ? this.assets().find((a) => a.id === id)?.name : null) || '';
  }
  costOf(id: number): FinContractCost | undefined { return this.costs()[id]; }
  piecesOf(id: number): number { return this.pieces()[id] ?? 0; }
  readonly activeContracts = computed(() => this.contracts().filter((c) => c.status === 'actif'));
  contractsOfAsset(id: number): FinContract[] { return this.contracts().filter((c) => c.assetId === id); }
  readonly looseContracts = computed(() => this.contracts().filter((c) => !c.assetId));

  newAsset(): void {
    this.patch({
      asForm: true, asId: null, asName: '', asKind: 'immobilier', asStatus: 'actif',
      asAddress: '', asAcquired: '', asSold: '', asNotes: '',
    });
  }

  editAsset(id: number): void {
    const a = this.assets().find((x) => x.id === id);
    if (!a) return;
    this.patch({
      asForm: true, asId: a.id, asName: a.name, asKind: a.kind, asStatus: a.status,
      asAddress: a.address, asAcquired: a.acquiredOn || '', asSold: a.soldOn || '', asNotes: a.notes,
    });
  }

  async saveAsset(): Promise<void> {
    const u = this.ui();
    if (u.busy) return;
    if (!u.asName.trim()) { this.foyer.toast('Donnez un nom au bien'); return; }
    const payload = {
      name: u.asName.trim(), kind: u.asKind, status: u.asStatus, address: u.asAddress.trim(),
      acquiredOn: u.asAcquired || null, soldOn: u.asSold || null, notes: u.asNotes.trim(),
    };
    this.patch({ busy: true });
    try {
      if (u.asId) await this.api.updateAsset(u.asId, payload);
      else await this.api.createAsset(payload);
      this.patch({ asForm: false, asId: null, busy: false });
      await this.loadContracts();
      this.foyer.toast(u.asId ? 'Bien modifié' : 'Bien ajouté');
    } catch (e) {
      this.patch({ busy: false });
      this.foyer.toast((e as Error).message);
    }
  }

  async confirmAssetDel(): Promise<void> {
    const id = this.ui().asDelId;
    if (!id) return;
    try {
      await this.api.deleteAsset(id);
      this.patch({ asDelId: null, asForm: false, asId: null });
      await this.loadContracts();
      this.foyer.toast('Bien supprimé, ses contrats sont conservés');
    } catch (e) {
      this.patch({ asDelId: null });
      this.foyer.toast((e as Error).message);
    }
  }

  newContract(assetId: number | null = null): void {
    this.patch({
      coForm: true, coId: null, coName: '', coProvider: '', coKind: 'assurance',
      coAsset: assetId, coAccount: null, coCategory: null, coMembers: [],
      coMin: '', coMax: '', coPeriodicity: 'mensuelle', coRenewal: '', coNotice: '', coEnds: '',
      coStatus: 'actif', coNotes: '', coRefs: [],
    });
    // A piece needs something to hang on: nothing to show before the first save.
    this.attachments.set([]);
  }

  editContract(id: number): void {
    const c = this.contracts().find((x) => x.id === id);
    if (!c) return;
    this.patch({
      coForm: true, coId: c.id, coName: c.name, coProvider: c.provider, coKind: c.kind,
      coAsset: c.assetId, coAccount: c.accountId, coCategory: c.categoryId, coMembers: [...c.memberIds],
      coMin: c.amountMin !== null ? fmtEuros(c.amountMin) : '',
      coMax: c.amountMax !== null ? fmtEuros(c.amountMax) : '',
      coPeriodicity: c.periodicity, coRenewal: c.renewalOn || '',
      coNotice: c.noticeDays ? String(c.noticeDays) : '', coEnds: c.endsOn || '',
      coStatus: c.status, coNotes: c.notes, coRefs: c.refs.map((r) => ({ ...r })),
    });
    void this.loadAttachments('contract', c.id);
    if (c.kind === 'energie') void this.loadReadings(c.id);
    else { this.readings.set([]); this.periods.set([]); this.energy.set(null); }
  }

  addRef(): void { this.patch({ coRefs: [...this.ui().coRefs, { key: '', value: '' }] }); }
  removeRef(i: number): void { this.patch({ coRefs: this.ui().coRefs.filter((_, k) => k !== i) }); }
  patchRef(i: number, p: Partial<FinContractRef>): void {
    this.patch({ coRefs: this.ui().coRefs.map((r, k) => (k === i ? { ...r, ...p } : r)) });
  }

  async saveContract(): Promise<void> {
    const u = this.ui();
    if (u.busy) return;
    if (!u.coName.trim()) { this.foyer.toast('Donnez un nom au contrat'); return; }
    for (const [v, name] of [[u.coMin, 'minimum'], [u.coMax, 'maximum']] as const) {
      if (v.trim() && parseEuros(v) === null) { this.foyer.toast(`Montant ${name} invalide`); return; }
    }
    const payload = {
      name: u.coName.trim(), provider: u.coProvider.trim(), kind: u.coKind,
      assetId: u.coAsset, accountId: u.coAccount, categoryId: u.coCategory,
      memberIds: u.coMembers,
      amountMin: u.coMin.trim() ? (Math.abs(parseEuros(u.coMin) as number) / 100).toFixed(2) : '',
      amountMax: u.coMax.trim() ? (Math.abs(parseEuros(u.coMax) as number) / 100).toFixed(2) : '',
      periodicity: u.coPeriodicity, renewalOn: u.coRenewal || null,
      noticeDays: parseInt(u.coNotice || '0', 10) || 0, endsOn: u.coEnds || null,
      status: u.coStatus, notes: u.coNotes.trim(),
      refs: u.coRefs.filter((r) => r.key.trim()).map((r) => ({ key: r.key.trim(), value: r.value.trim() })),
    };
    this.patch({ busy: true });
    try {
      if (u.coId) await this.api.updateContract(u.coId, payload);
      else await this.api.createContract(payload);
      this.patch({ coForm: false, coId: null, busy: false });
      await Promise.all([this.loadContracts(), this.reloadTransactions()]);
      this.foyer.toast(u.coId ? 'Contrat modifié' : 'Contrat ajouté');
    } catch (e) {
      this.patch({ busy: false });
      this.foyer.toast((e as Error).message);
    }
  }

  async confirmContractDel(): Promise<void> {
    const id = this.ui().coDelId;
    if (!id) return;
    try {
      const r = await this.api.deleteContract(id);
      this.patch({ coDelId: null, coForm: false, coId: null });
      await Promise.all([this.loadContracts(), this.reloadTransactions()]);
      this.foyer.toast(r.detached
        ? `Contrat supprimé, ${r.detached} opération${r.detached > 1 ? 's' : ''} détachée${r.detached > 1 ? 's' : ''}`
        : 'Contrat supprimé');
    } catch (e) {
      this.patch({ coDelId: null });
      this.foyer.toast((e as Error).message);
    }
  }

  /** Show the operations attached to a contract, over the whole history. */
  openContractOperations(id: number): void {
    this.patch({ tab: 'transactions', fltContract: id, fltQuery: '', fltAccount: null, fltCategory: null, fltUncategorised: false, fltTag: '', page: 0 });
    void this.reloadTransactions();
  }

  // ---- attachments -------------------------------------------------------
  async loadAttachments(owner: FinOwnerKind, id: number): Promise<void> {
    try { this.attachments.set((await this.api.attachments(owner, id)).attachments); }
    catch (e) { this.foyer.toast((e as Error).message); }
  }

  /** Upload a piece and refresh the list. The server judges the type by its bytes. */
  async uploadAttachment(owner: FinOwnerKind, id: number, file: File): Promise<void> {
    if (this.ui().busy) return;
    this.patch({ busy: true });
    try {
      const r = await this.api.uploadAttachment(owner, id, file);
      this.attachments.set(r.attachments);
      this.patch({ busy: false });
      await this.loadContracts();
      this.foyer.toast(r.deduplicated ? 'Pièce ajoutée, identique à une autre déjà stockée' : 'Pièce ajoutée');
    } catch (e) {
      this.patch({ busy: false });
      this.foyer.toast((e as Error).message);
    }
  }

  async deleteAttachment(id: number): Promise<void> {
    try {
      this.attachments.set((await this.api.deleteAttachment(id)).attachments);
      await this.loadContracts();
      this.foyer.toast('Pièce supprimée');
    } catch (e) { this.foyer.toast((e as Error).message); }
  }

  /** Download through the session token rather than a bare link. */
  async openAttachment(a: FinAttachment): Promise<void> {
    try {
      const url = URL.createObjectURL(await this.api.downloadAttachment(a.id));
      const link = document.createElement('a');
      link.href = url;
      link.download = a.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) { this.foyer.toast((e as Error).message); }
  }

  /** Cocher ou décocher une personne, sur un compte ou sur un contrat. */
  toggleMember(field: 'acMembers' | 'coMembers', memberId: string): void {
    const current = this.ui()[field];
    const next = current.includes(memberId) ? current.filter((m) => m !== memberId) : [...current, memberId];
    this.patch({ [field]: next } as Partial<FinancesUi>);
  }

  // ---- savings ideas -----------------------------------------------------
  newSaving(contractId: number | null = null): void {
    this.patch({
      saForm: true, saId: null, saTitle: '', saDesc: '', saGain: '',
      saStatus: 'idee', saContract: contractId, saDate: '',
    });
  }

  editSaving(id: number): void {
    const s = this.savings().find((x) => x.id === id);
    if (!s) return;
    this.patch({
      saForm: true, saId: s.id, saTitle: s.title, saDesc: s.description,
      saGain: s.annualGain ? fmtEuros(s.annualGain) : '', saStatus: s.status,
      saContract: s.contractId, saDate: s.targetDate || '',
    });
  }

  async saveSaving(): Promise<void> {
    const u = this.ui();
    if (u.busy) return;
    if (!u.saTitle.trim()) { this.foyer.toast('Donnez un intitulé à la piste'); return; }
    if (parseEuros(u.saGain) === null) { this.foyer.toast('Indiquez le gain annuel estimé, même approximatif'); return; }
    const existing = u.saId ? this.savings().find((s) => s.id === u.saId) : null;
    const payload = {
      title: u.saTitle.trim(), description: u.saDesc.trim(),
      annualGain: (Math.abs(parseEuros(u.saGain) as number) / 100).toFixed(2),
      contractId: u.saContract, assetId: null, status: u.saStatus,
      targetDate: u.saDate || null, taskId: existing?.taskId ?? null,
    };
    this.patch({ busy: true });
    try {
      if (u.saId) await this.api.updateSaving(u.saId, payload);
      else await this.api.createSaving(payload);
      this.patch({ saForm: false, saId: null, busy: false });
      await this.loadContracts();
      this.foyer.toast(u.saId ? 'Piste modifiée' : 'Piste ajoutée');
    } catch (e) {
      this.patch({ busy: false });
      this.foyer.toast((e as Error).message);
    }
  }

  async confirmSavingDel(): Promise<void> {
    const id = this.ui().saDelId;
    if (!id) return;
    try {
      await this.api.deleteSaving(id);
      this.patch({ saDelId: null, saForm: false, saId: null });
      await this.loadContracts();
      this.foyer.toast('Piste supprimée');
    } catch (e) {
      this.patch({ saDelId: null });
      this.foyer.toast((e as Error).message);
    }
  }

  /** Passer une piste d'un statut à l'autre sans ouvrir le formulaire. */
  async setSavingStatus(id: number, status: FinSavingStatus): Promise<void> {
    const s = this.savings().find((x) => x.id === id);
    if (!s) return;
    try {
      await this.api.updateSaving(id, {
        title: s.title, description: s.description,
        annualGain: (s.annualGain / 100).toFixed(2),
        contractId: s.contractId, assetId: s.assetId, status,
        targetDate: s.targetDate, taskId: s.taskId,
      });
      await this.loadContracts();
    } catch (e) { this.foyer.toast((e as Error).message); }
  }

  /**
   * La tâche liée existe-t-elle encore ? Elle vit dans le document du foyer et
   * peut y être supprimée : promettre une tâche disparue serait pire que rien.
   */
  savingTask(s: FinSaving): boolean {
    return !!s.taskId && (this.foyer.data()?.tasks || []).some((t) => t.id === s.taskId);
  }

  /** Copier une piste dans les tâches, et retenir laquelle. */
  async taskFromSaving(id: number): Promise<void> {
    const s = this.savings().find((x) => x.id === id);
    if (!s) return;
    const taskId = this.foyer.addExternalTask(s.title, s.targetDate || this.foyer.todayStr());
    if (!taskId) return;
    try {
      await this.api.linkSavingTask(id, taskId);
      await this.loadContracts();
    } catch (e) { this.foyer.toast((e as Error).message); }
  }

  // ---- meter readings ----------------------------------------------------
  async loadReadings(contractId: number): Promise<void> {
    try {
      const b = await this.api.readings(contractId);
      this.readings.set(b.readings);
      this.periods.set(b.periods);
      this.energy.set(b.summary);
    } catch (e) { this.foyer.toast((e as Error).message); }
  }

  periodOf(readingId: number): FinPeriod | undefined {
    return this.periods().find((p) => p.readingId === readingId);
  }

  async saveReading(contractId: number): Promise<void> {
    const u = this.ui();
    if (u.busy) return;
    if (!u.reDate) { this.foyer.toast('Choisissez la date du relevé'); return; }
    this.patch({ busy: true });
    try {
      await this.api.createReading({
        contractId, date: u.reDate,
        indexTotal: u.reIndex.trim(), indexHp: u.reIndexHp.trim(), indexHc: u.reIndexHc.trim(),
        kwh: u.reKwh.trim(), kwhHp: '', kwhHc: '',
        cost: u.reCost.trim(), notes: '',
      });
      this.patch({ busy: false, reDate: '', reIndex: '', reIndexHp: '', reIndexHc: '', reKwh: '', reCost: '' });
      await this.loadReadings(contractId);
      this.foyer.toast('Relevé enregistré');
    } catch (e) {
      this.patch({ busy: false });
      this.foyer.toast((e as Error).message);
    }
  }

  async deleteReading(id: number, contractId: number): Promise<void> {
    try {
      await this.api.deleteReading(id);
      await this.loadReadings(contractId);
      this.foyer.toast('Relevé supprimé');
    } catch (e) { this.foyer.toast((e as Error).message); }
  }

  // ---- module backup -----------------------------------------------------
  async exportModule(): Promise<void> {
    try {
      const url = URL.createObjectURL(await this.api.exportModule());
      const a = document.createElement('a');
      a.href = url;
      a.download = `foyer-finances-${this.foyer.todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.foyer.toast('Sauvegarde du module téléchargée');
    } catch (e) { this.foyer.toast((e as Error).message); }
  }

  /** Read the dropped file, without restoring anything yet. */
  async stageRestore(file: File): Promise<void> {
    try {
      const parsed = JSON.parse(await file.text());
      this.patch({ restorePending: parsed, restoreName: file.name });
    } catch {
      this.foyer.toast('Ce fichier n’est pas une sauvegarde lisible');
    }
  }

  /** Replace the module's data. Destructive, hence the explicit confirmation. */
  async confirmRestore(): Promise<void> {
    const pending = this.ui().restorePending;
    if (!pending || this.ui().busy) return;
    this.patch({ busy: true });
    try {
      const { report } = await this.api.restoreModule(pending);
      this.patch({ busy: false, restorePending: null, restoreName: '' });
      const n = report.after['fin_transactions'] ?? 0;
      this.foyer.toast(`Module restauré : ${n} opération${n > 1 ? 's' : ''}`);
      await Promise.all([this.init(true), this.loadContracts(), this.loadRules()]);
      if (report.attachments) this.foyer.toast(`${report.attachments} pièce(s) jointe(s) référencée(s) : vérifiez le répertoire « pieces »`);
    } catch (e) {
      this.patch({ busy: false });
      this.foyer.toast((e as Error).message);
    }
  }

  // ---- export ------------------------------------------------------------
  async exportCsv(): Promise<void> {
    try {
      const blob = await this.api.exportCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `foyer-finances-${this.foyer.todayStr()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this.foyer.toast('Export CSV téléchargé');
    } catch (e) {
      this.foyer.toast((e as Error).message);
    }
  }
}
