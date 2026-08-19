// Data access for the finances module. Everything goes through prepared
// statements; aggregates are computed by SQLite rather than in JavaScript, which
// is the whole point of moving finances out of the JSON document.
import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { coveredThrough, initImportRepo } from './import-repo';
import { initRulesRepo, tagsFor } from './rules-repo';
import { centsToDecimal, monthRange, normaliseLabel } from './money';
import {
  Account, AccountCoverage, Category, CategorySummary, MonthSummary, Transaction, TxKind,
} from './types';

let database: Database;

/** Wire the repository to the app database and register helper SQL functions. */
export function initFinancesRepo(db: Database): void {
  database = db;
  // The import layer shares the same connection; wiring it here means a caller
  // cannot forget it and discover the omission only when a summary is computed.
  initImportRepo(db);
  initRulesRepo(db);
  // Accent/case-insensitive matching for search, computed in SQLite. No index is
  // needed: a full scan over a few thousand rows is sub-millisecond.
  db.function('fnorm', { deterministic: true }, (s: unknown) => normaliseLabel(String(s ?? '')));
}

// ---- row mappers ---------------------------------------------------------
interface AccountRow { id: number; name: string; kind: string; member_id: string | null; opening_balance: number; opening_date: string | null; archived: number; position: number; }
const toAccount = (r: AccountRow): Account => ({
  id: r.id, name: r.name, kind: r.kind as Account['kind'], memberId: r.member_id,
  openingBalance: r.opening_balance, openingDate: r.opening_date, archived: !!r.archived, position: r.position,
});

interface CategoryRow { id: number; parent_id: number | null; name: string; monthly_budget: number; color: string; icon: string; position: number; }
const toCategory = (r: CategoryRow): Category => ({
  id: r.id, parentId: r.parent_id, name: r.name, monthlyBudget: r.monthly_budget,
  color: r.color, icon: r.icon, position: r.position,
});

interface TxRow {
  id: number; account_id: number; date: string; amount: number; kind: string;
  label_raw: string; label: string; category_id: number | null; contract_id: number | null;
  notes: string; cleared: number; transfer_group: string | null; import_id: number | null;
  rule_id: number | null;
}
const toTransaction = (r: TxRow, tags: string[] = []): Transaction => ({
  id: r.id, accountId: r.account_id, date: r.date, amount: r.amount, kind: r.kind as TxKind,
  labelRaw: r.label_raw, label: r.label, categoryId: r.category_id, contractId: r.contract_id,
  notes: r.notes, cleared: !!r.cleared, transferGroup: r.transfer_group, importId: r.import_id,
  ruleId: r.rule_id, tags,
});

// ---- accounts ------------------------------------------------------------
export function listAccounts(): Account[] {
  return (database.prepare('SELECT * FROM fin_accounts ORDER BY archived, position, id').all() as AccountRow[]).map(toAccount);
}

export function getAccount(id: number): Account | null {
  const r = database.prepare('SELECT * FROM fin_accounts WHERE id = ?').get(id) as AccountRow | undefined;
  return r ? toAccount(r) : null;
}

export interface AccountInput { name: string; kind: string; memberId: string | null; openingBalance: number; openingDate: string | null; archived: boolean; }

export function createAccount(input: AccountInput): Account {
  const pos = (database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM fin_accounts').get() as { p: number }).p;
  const info = database.prepare(
    'INSERT INTO fin_accounts (name, kind, member_id, opening_balance, opening_date, archived, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(input.name, input.kind, input.memberId, input.openingBalance, input.openingDate, input.archived ? 1 : 0, pos);
  return getAccount(Number(info.lastInsertRowid))!;
}

export function updateAccount(id: number, input: AccountInput): Account | null {
  const info = database.prepare(
    'UPDATE fin_accounts SET name = ?, kind = ?, member_id = ?, opening_balance = ?, opening_date = ?, archived = ? WHERE id = ?',
  ).run(input.name, input.kind, input.memberId, input.openingBalance, input.openingDate, input.archived ? 1 : 0, id);
  return info.changes ? getAccount(id) : null;
}

export function countTransactionsForAccount(id: number): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM fin_transactions WHERE account_id = ?').get(id) as { n: number }).n;
}

export function deleteAccount(id: number): void {
  database.prepare('DELETE FROM fin_accounts WHERE id = ?').run(id);
}

/** Opening balance plus every operation, per account. */
export function accountBalances(): Record<number, number> {
  const rows = database.prepare(`
    SELECT a.id AS id, a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
    FROM fin_accounts a LEFT JOIN fin_transactions t ON t.account_id = a.id
    GROUP BY a.id
  `).all() as { id: number; balance: number }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.balance]));
}

export function accountCoverage(): AccountCoverage[] {
  return database.prepare(`
    SELECT a.id AS accountId, a.name AS name,
           MIN(t.date) AS firstDate, MAX(t.date) AS lastDate, COUNT(t.id) AS count
    FROM fin_accounts a LEFT JOIN fin_transactions t ON t.account_id = a.id
    GROUP BY a.id ORDER BY a.position, a.id
  `).all() as AccountCoverage[];
}

// ---- account aliases -----------------------------------------------------
export interface AccountAlias { id: number; accountId: number; labelNorm: string; labelRaw: string; }

export function listAliases(): AccountAlias[] {
  return (database.prepare('SELECT id, account_id AS accountId, label_norm AS labelNorm, label_raw AS labelRaw FROM fin_account_aliases ORDER BY id').all() as AccountAlias[]);
}

export function findAccountByAlias(label: string): number | null {
  const r = database.prepare('SELECT account_id AS id FROM fin_account_aliases WHERE label_norm = ?').get(normaliseLabel(label)) as { id: number } | undefined;
  return r ? r.id : null;
}

export function addAlias(accountId: number, label: string): void {
  database.prepare(
    'INSERT INTO fin_account_aliases (account_id, label_norm, label_raw) VALUES (?, ?, ?) ON CONFLICT(label_norm) DO UPDATE SET account_id = excluded.account_id',
  ).run(accountId, normaliseLabel(label), label);
}

export function deleteAlias(id: number): void {
  database.prepare('DELETE FROM fin_account_aliases WHERE id = ?').run(id);
}

// ---- categories ----------------------------------------------------------
export function listCategories(): Category[] {
  return (database.prepare('SELECT * FROM fin_categories ORDER BY position, id').all() as CategoryRow[]).map(toCategory);
}

export function getCategory(id: number): Category | null {
  const r = database.prepare('SELECT * FROM fin_categories WHERE id = ?').get(id) as CategoryRow | undefined;
  return r ? toCategory(r) : null;
}

export interface CategoryInput { parentId: number | null; name: string; monthlyBudget: number; color: string; icon: string; }

export function createCategory(input: CategoryInput): Category {
  const pos = (database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM fin_categories').get() as { p: number }).p;
  const info = database.prepare(
    'INSERT INTO fin_categories (parent_id, name, monthly_budget, color, icon, position) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(input.parentId, input.name, input.monthlyBudget, input.color, input.icon, pos);
  return getCategory(Number(info.lastInsertRowid))!;
}

export function updateCategory(id: number, input: CategoryInput): Category | null {
  const info = database.prepare(
    'UPDATE fin_categories SET parent_id = ?, name = ?, monthly_budget = ?, color = ?, icon = ? WHERE id = ?',
  ).run(input.parentId, input.name, input.monthlyBudget, input.color, input.icon, id);
  return info.changes ? getCategory(id) : null;
}

/** Deleting a parent cascades onto its children; affected transactions lose their category. */
export function deleteCategory(id: number): void {
  database.prepare('DELETE FROM fin_categories WHERE id = ?').run(id);
}

export function countChildren(id: number): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM fin_categories WHERE parent_id = ?').get(id) as { n: number }).n;
}

// ---- transactions --------------------------------------------------------
export interface TxFilter {
  from?: string; to?: string; accountId?: number; categoryId?: number;
  uncategorised?: boolean; q?: string; tag?: string; limit?: number; offset?: number;
}

function whereClause(f: TxFilter): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (f.from) { parts.push('t.date >= ?'); params.push(f.from); }
  if (f.to) { parts.push('t.date <= ?'); params.push(f.to); }
  if (f.accountId) { parts.push('t.account_id = ?'); params.push(f.accountId); }
  if (f.categoryId) { parts.push('t.category_id = ?'); params.push(f.categoryId); }
  if (f.uncategorised) parts.push('t.category_id IS NULL');
  if (f.tag) { parts.push('t.id IN (SELECT tt.transaction_id FROM fin_transaction_tags tt JOIN fin_tags g ON g.id = tt.tag_id WHERE g.name = ?)'); params.push(f.tag); }
  if (f.q) { parts.push("(fnorm(t.label) LIKE ? OR fnorm(t.label_raw) LIKE ? OR fnorm(t.notes) LIKE ?)"); const like = `%${normaliseLabel(f.q)}%`; params.push(like, like, like); }
  return { sql: parts.length ? 'WHERE ' + parts.join(' AND ') : '', params };
}

export function listTransactions(f: TxFilter): { rows: Transaction[]; total: number } {
  const { sql, params } = whereClause(f);
  const total = (database.prepare(`SELECT COUNT(*) AS n FROM fin_transactions t ${sql}`).get(...params) as { n: number }).n;
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 1000);
  const offset = Math.max(f.offset ?? 0, 0);
  const rows = database.prepare(
    `SELECT t.* FROM fin_transactions t ${sql} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as TxRow[];
  const tags = tagsFor(rows.map((r) => r.id));
  return { rows: rows.map((r) => toTransaction(r, tags.get(r.id) ?? [])), total };
}

export function getTransaction(id: number): Transaction | null {
  const r = database.prepare('SELECT * FROM fin_transactions WHERE id = ?').get(id) as TxRow | undefined;
  return r ? toTransaction(r, tagsFor([id]).get(id) ?? []) : null;
}

export interface TxInput {
  accountId: number; date: string; amount: number; kind: TxKind;
  label: string; labelRaw?: string; categoryId: number | null;
  contractId?: number | null; notes: string; cleared: boolean;
}

/**
 * Fingerprint used by the importer to recognise an operation already present.
 * Manual entries get a random key so they are never mistaken for an imported row
 * and never deduplicated away.
 */
export function dedupeKey(accountId: number, date: string, amount: number, labelRaw: string): string {
  return crypto.createHash('sha1').update(`${accountId}|${date}|${amount}|${normaliseLabel(labelRaw)}`).digest('hex');
}

export function createTransaction(input: TxInput): Transaction {
  const info = database.prepare(`
    INSERT INTO fin_transactions
      (account_id, date, amount, kind, label_raw, label, category_id, contract_id, notes, cleared, dedupe_key, dedupe_seq)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    input.accountId, input.date, input.amount, input.kind,
    input.labelRaw ?? input.label, input.label, input.categoryId, input.contractId ?? null,
    input.notes, input.cleared ? 1 : 0, 'm:' + crypto.randomUUID(),
  );
  return getTransaction(Number(info.lastInsertRowid))!;
}

/**
 * A manual edit takes ownership of the row: `rule_id` is cleared, so replaying
 * the rules will not undo the correction the user just made.
 */
export function updateTransaction(id: number, input: TxInput): Transaction | null {
  const info = database.prepare(`
    UPDATE fin_transactions
    SET account_id = ?, date = ?, amount = ?, kind = ?, label = ?, category_id = ?, contract_id = ?,
        notes = ?, cleared = ?, rule_id = NULL, updated_at = strftime('%Y-%m-%d %H:%M:%f','now')
    WHERE id = ?
  `).run(
    input.accountId, input.date, input.amount, input.kind, input.label,
    input.categoryId, input.contractId ?? null, input.notes, input.cleared ? 1 : 0, id,
  );
  return info.changes ? getTransaction(id) : null;
}

export function deleteTransaction(id: number): void {
  database.prepare('DELETE FROM fin_transactions WHERE id = ?').run(id);
}

// ---- aggregates ----------------------------------------------------------

/**
 * Monthly figures against the reference budgets. Internal transfers are excluded
 * from income and expense: they move money inside the household, they are not
 * resources or spending.
 */
export function monthSummary(month: string, today = new Date().toISOString().slice(0, 10)): MonthSummary {
  const { from, to } = monthRange(month);
  const totals = database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS expense
    FROM fin_transactions WHERE date >= ? AND date <= ? AND kind <> 'virement'
  `).get(from, to) as { income: number; expense: number };

  // Spending per top-level category: a sub-category's spending rolls up to its parent.
  const spentRows = database.prepare(`
    SELECT COALESCE(c.parent_id, c.id) AS catId, COALESCE(SUM(-t.amount), 0) AS spent
    FROM fin_transactions t JOIN fin_categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ? AND t.kind <> 'virement' AND t.amount < 0
    GROUP BY COALESCE(c.parent_id, c.id)
  `).all(from, to) as { catId: number; spent: number }[];
  const spentBy = new Map(spentRows.map((r) => [r.catId, r.spent]));

  const roots = (database.prepare('SELECT * FROM fin_categories WHERE parent_id IS NULL ORDER BY position, id').all() as CategoryRow[]).map(toCategory);
  const categories: CategorySummary[] = roots.map((c) => ({
    categoryId: c.id, name: c.name, color: c.color, icon: c.icon,
    budget: c.monthlyBudget, spent: spentBy.get(c.id) || 0,
  }));

  const uncategorised = (database.prepare(`
    SELECT COALESCE(SUM(-amount), 0) AS spent FROM fin_transactions
    WHERE date >= ? AND date <= ? AND kind <> 'virement' AND amount < 0 AND category_id IS NULL
  `).get(from, to) as { spent: number }).spent;
  if (uncategorised > 0) {
    categories.push({ categoryId: null, name: 'Sans catégorie', color: '#8A7E74', icon: 'facture', budget: 0, spent: uncategorised });
  }

  // An active account whose data does not reach the end of the month means the
  // figures above understate reality. Coverage comes from the window each import
  // declared, not from the last operation: a passbook that moves twice a year is
  // covered, a bank connection that died is not.
  const covered = coveredThrough();
  const deadline = today < to ? today : to;
  const missing = (database.prepare(
    'SELECT id AS accountId, name FROM fin_accounts WHERE archived = 0 ORDER BY position, id',
  ).all() as { accountId: number; name: string }[])
    .map((a) => ({ ...a, coveredThrough: covered.get(a.accountId) ?? null }))
    .filter((a) => a.coveredThrough !== null && a.coveredThrough < deadline)
    .sort((a, b) => String(a.coveredThrough).localeCompare(String(b.coveredThrough)));

  return {
    month,
    income: totals.income,
    expense: totals.expense,
    balance: totals.income - totals.expense,
    budgetTotal: roots.reduce((a, c) => a + c.monthlyBudget, 0),
    categories,
    missing,
    incomplete: missing.length > 0,
  };
}

/** Months that hold at least one operation, most recent first. */
export function availableMonths(): string[] {
  return (database.prepare("SELECT DISTINCT substr(date, 1, 7) AS m FROM fin_transactions ORDER BY m DESC").all() as { m: string }[]).map((r) => r.m);
}

// ---- CSV export ----------------------------------------------------------
const csvCell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * Every transaction as semicolon-separated CSV, UTF-8 with a BOM so French
 * Excel and LibreOffice open it correctly without an import dialog.
 */
export function exportCsv(): string {
  const rows = database.prepare(`
    SELECT t.date, t.label, t.label_raw, a.name AS account, t.amount, t.kind,
           p.name AS parent_name, c.name AS cat_name, t.notes, t.cleared, t.transfer_group
    FROM fin_transactions t
    JOIN fin_accounts a ON a.id = t.account_id
    LEFT JOIN fin_categories c ON c.id = t.category_id
    LEFT JOIN fin_categories p ON p.id = c.parent_id
    ORDER BY t.date DESC, t.id DESC
  `).all() as {
    date: string; label: string; label_raw: string; account: string; amount: number; kind: string;
    parent_name: string | null; cat_name: string | null; notes: string; cleared: number; transfer_group: string | null;
  }[];

  const head = ['Date', 'Libellé', 'Libellé d\'origine', 'Compte', 'Montant', 'Type', 'Catégorie', 'Sous-catégorie', 'Notes', 'Pointée', 'Groupe de virement'];
  const lines = [head.map(csvCell).join(';')];
  for (const r of rows) {
    // A sub-category prints as (parent, child); a top-level one leaves the child column empty.
    const parent = r.parent_name ?? r.cat_name ?? '';
    const child = r.parent_name ? (r.cat_name ?? '') : '';
    lines.push([
      r.date, r.label, r.label_raw, r.account, centsToDecimal(r.amount), r.kind,
      parent, child, r.notes, r.cleared ? 'Oui' : 'Non', r.transfer_group ?? '',
    ].map(csvCell).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
