import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  AccountKind, FinAccount, FinAction, FinActionKind, FinAlias, FinApplyReport, FinCategory,
  FinCondition, FinConditionField, FinConditionOp, FinCoverage, FinImport, FinImportPreview,
  FinMonthSummary, FinRule, FinRuleInput, FinRulePreview, FinTag, FinTransfer,
  FinTransferCandidate, FinTransaction, FinancesApi, TxKind,
} from './finances.api';
import { FoyerStore, SearchHit } from './foyer.store';
import { Notif } from './models';

/**
 * Finances state. Unlike FoyerStore, which holds the whole household as one
 * document and resends it on every change, this store talks to granular
 * endpoints: a new transaction is one INSERT, not a rewrite of everything.
 */

export interface FinancesUi {
  tab: 'transactions' | 'comptes' | 'categories' | 'regles' | 'import';
  month: string;

  // transaction filters
  fltQuery: string; fltAccount: number | null; fltCategory: number | null;
  fltUncategorised: boolean; fltTag: string; page: number;

  // transaction form
  txForm: boolean; txId: number | null;
  txLabel: string; txAmount: string; txSign: 'out' | 'in'; txDate: string;
  txAccount: number | null; txCategory: number | null; txNotes: string; txCleared: boolean;
  txDelId: number | null;

  // account form
  acForm: boolean; acId: number | null;
  acName: string; acKind: AccountKind; acMember: string; acOpening: string; acOpeningDate: string; acArchived: boolean;
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

  // rule editor
  ruleForm: boolean; ruleId: number | null;
  ruleName: string; ruleEnabled: boolean; ruleMatch: 'all' | 'any'; ruleStop: boolean;
  ruleConditions: FinCondition[]; ruleActions: FinAction[];
  ruleDelId: number | null; ruleError: string; ruleBusy: boolean;
  /** « Tout réappliquer » also overwrites the categories corrected by hand. */
  applyForce: boolean;

  busy: boolean;
}

function initialUi(month: string): FinancesUi {
  return {
    tab: 'transactions', month,
    fltQuery: '', fltAccount: null, fltCategory: null, fltUncategorised: false, fltTag: '', page: 0,
    txForm: false, txId: null, txLabel: '', txAmount: '', txSign: 'out', txDate: '',
    txAccount: null, txCategory: null, txNotes: '', txCleared: false, txDelId: null,
    acForm: false, acId: null, acName: '', acKind: 'courant', acMember: '', acOpening: '',
    acOpeningDate: '', acArchived: false, acAliasInput: '', acDelId: null,
    catForm: false, catId: null, catName: '', catBudget: '', catColor: '#7A9B76', catIcon: 'facture',
    catParent: null, catDelId: null,
    importBusy: false, importError: '', mapping: {}, picked: {},
    showWeakCandidates: false, undoImportId: null,
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
    effect(() => this.foyer.externalNotifs.set(this.buildNotifs(this.currentSummary())));
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
      await Promise.all([this.reloadTransactions(), this.reloadSummary(), this.loadRules()]);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  reset(): void {
    this.accounts.set([]); this.categories.set([]); this.balances.set({});
    this.coverage.set([]); this.months.set([]); this.aliases.set([]);
    this.transactions.set([]); this.total.set(0); this.summary.set(null);
    this.currentSummary.set(null); this.searchHits.set([]);
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
    // A search spans the whole history; without one, the list follows the month.
    const bounds = u.fltQuery.trim() ? {} : this.monthBounds(u.month);
    try {
      const r = await this.api.transactions({
        ...bounds,
        accountId: u.fltAccount ?? undefined,
        categoryId: u.fltCategory ?? undefined,
        uncategorised: u.fltUncategorised || undefined,
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
    this.patch({ tab: 'transactions', fltQuery: h.title, fltAccount: null, fltCategory: null, fltUncategorised: false, fltTag: '', page: 0 });
    void this.reloadTransactions();
  }

  setFilter(p: Partial<FinancesUi>): void {
    this.patch({ ...p, page: 0 });
    void this.reloadTransactions();
  }
  clearFilters(): void {
    this.patch({ fltQuery: '', fltAccount: null, fltCategory: null, fltUncategorised: false, fltTag: '', page: 0 });
    void this.reloadTransactions();
  }
  readonly hasFilters = computed(() => {
    const u = this.ui();
    return !!(u.fltQuery.trim() || u.fltAccount || u.fltCategory || u.fltUncategorised || u.fltTag);
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
      txCategory: null, txNotes: '', txCleared: false,
    });
  }

  editTx(id: number): void {
    const t = this.transactions().find((x) => x.id === id);
    if (!t) return;
    this.patch({
      txForm: true, txId: t.id, txLabel: t.label, txAmount: fmtEuros(Math.abs(t.amount)),
      txSign: t.amount < 0 ? 'out' : 'in', txDate: t.date, txAccount: t.accountId,
      txCategory: t.categoryId, txNotes: t.notes, txCleared: t.cleared,
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
    await Promise.all([this.reloadTransactions(), this.reloadSummary(), this.refreshReference()]);
  }

  // ---- accounts ----------------------------------------------------------
  newAccount(): void {
    this.patch({
      acForm: true, acId: null, acName: '', acKind: 'courant', acMember: '',
      acOpening: '', acOpeningDate: '', acArchived: false, acAliasInput: '',
    });
  }

  editAccount(id: number): void {
    const a = this.accounts().find((x) => x.id === id);
    if (!a) return;
    this.patch({
      acForm: true, acId: a.id, acName: a.name, acKind: a.kind, acMember: a.memberId || '',
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
      name, kind: u.acKind, memberId: u.acMember || null,
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
    this.patch({ tab: 'transactions', fltTag: name, fltQuery: '', fltAccount: null, fltCategory: null, fltUncategorised: false, page: 0 });
    void this.reloadTransactions();
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
