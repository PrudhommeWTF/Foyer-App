import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  AccountKind, FinAccount, FinAlias, FinCategory, FinCoverage, FinMonthSummary,
  FinTransaction, FinancesApi, TxKind,
} from './finances.api';
import { FoyerStore, SearchHit } from './foyer.store';
import { Notif } from './models';

/**
 * Finances state. Unlike FoyerStore, which holds the whole household as one
 * document and resends it on every change, this store talks to granular
 * endpoints: a new transaction is one INSERT, not a rewrite of everything.
 */

export interface FinancesUi {
  tab: 'transactions' | 'comptes' | 'categories';
  month: string;

  // transaction filters
  fltQuery: string; fltAccount: number | null; fltCategory: number | null;
  fltUncategorised: boolean; page: number;

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

  busy: boolean;
}

function initialUi(month: string): FinancesUi {
  return {
    tab: 'transactions', month,
    fltQuery: '', fltAccount: null, fltCategory: null, fltUncategorised: false, page: 0,
    txForm: false, txId: null, txLabel: '', txAmount: '', txSign: 'out', txDate: '',
    txAccount: null, txCategory: null, txNotes: '', txCleared: false, txDelId: null,
    acForm: false, acId: null, acName: '', acKind: 'courant', acMember: '', acOpening: '',
    acOpeningDate: '', acArchived: false, acAliasInput: '', acDelId: null,
    catForm: false, catId: null, catName: '', catBudget: '', catColor: '#7A9B76', catIcon: 'facture',
    catParent: null, catDelId: null,
    busy: false,
  };
}

const PAGE_SIZE = 50;

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
        desc: s.missing.map((m) => `${m.name} s'arrête au ${this.foyer.fmtNumDate(m.lastDate || '')}`).join(', '),
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
      await Promise.all([this.reloadTransactions(), this.reloadSummary()]);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  reset(): void {
    this.accounts.set([]); this.categories.set([]); this.balances.set({});
    this.coverage.set([]); this.months.set([]); this.aliases.set([]);
    this.transactions.set([]); this.total.set(0); this.summary.set(null);
    this.currentSummary.set(null); this.searchHits.set([]);
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
    this.patch({ tab: 'transactions', fltQuery: h.title, fltAccount: null, fltCategory: null, fltUncategorised: false, page: 0 });
    void this.reloadTransactions();
  }

  setFilter(p: Partial<FinancesUi>): void {
    this.patch({ ...p, page: 0 });
    void this.reloadTransactions();
  }
  clearFilters(): void {
    this.patch({ fltQuery: '', fltAccount: null, fltCategory: null, fltUncategorised: false, page: 0 });
    void this.reloadTransactions();
  }
  readonly hasFilters = computed(() => {
    const u = this.ui();
    return !!(u.fltQuery.trim() || u.fltAccount || u.fltCategory || u.fltUncategorised);
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
