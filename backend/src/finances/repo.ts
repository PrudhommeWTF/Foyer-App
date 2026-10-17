// Data access for the finances module. Everything goes through prepared
// statements; aggregates are computed by SQLite rather than in JavaScript, which
// is the whole point of moving finances out of the JSON document.
import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { readMembers, writeMembers } from './members';
import { coveredThrough, gapsOver, initImportRepo } from './import-repo';
import { initAttachments, removeAllFor } from './attachments';
import { initContracts } from './contracts';
import { initDashboard } from './dashboard';
import { initBackup } from './backup';
import { initEnergy } from './energy';
import { initSavings } from './savings';
import { initRulesRepo, tagsFor } from './rules-repo';
import { initSuggestRepo } from './suggest-repo';
import { centsToDecimal, monthRange, normaliseLabel, shiftMonth } from './money';
import {
  Account, AccountCoverage, BudgetMove, Category, CategorySummary, LoanTerms, MonthFlow, MonthSummary, Transaction, TxKind,
} from './types';

let database: Database;

/**
 * Single entry point of the whole module. The bytes of the attachments live in
 * the household blob store, initialised once in db.ts: this module only holds
 * their metadata.
 */
export function initFinancesRepo(db: Database): void {
  database = db;
  // The import layer shares the same connection; wiring it here means a caller
  // cannot forget it and discover the omission only when a summary is computed.
  initImportRepo(db);
  initRulesRepo(db);
  initSuggestRepo(db);
  initContracts(db);
  initDashboard(db);
  initEnergy(db);
  initSavings(db);
  initBackup(db);
  initAttachments(db);
  // Accent/case-insensitive matching for search, computed in SQLite. No index is
  // needed: a full scan over a few thousand rows is sub-millisecond.
  db.function('fnorm', { deterministic: true }, (s: unknown) => normaliseLabel(String(s ?? '')));
}

// ---- row mappers ---------------------------------------------------------
interface AccountRow {
  id: number; name: string; kind: string; opening_balance: number; opening_date: string | null;
  archived: number; position: number;
  loan_principal: number | null; loan_rate_bp: number | null; loan_payment: number | null;
  loan_insurance: number | null; loan_first_on: string | null;
}
/**
 * Les termes du prêt ne remontent que s'ils sont complets : un prêt à moitié
 * saisi ne peut rien calculer, et un objet à trous ferait croire le contraire.
 */
const toLoan = (r: AccountRow): LoanTerms | null => (
  r.loan_principal != null && r.loan_payment != null && r.loan_first_on
    ? {
      principal: r.loan_principal, rateBp: r.loan_rate_bp ?? 0, payment: r.loan_payment,
      insurance: r.loan_insurance ?? 0, firstOn: r.loan_first_on,
    }
    : null
);
const toAccount = (r: AccountRow, memberIds: string[] = []): Account => ({
  id: r.id, name: r.name, kind: r.kind as Account['kind'], memberIds,
  openingBalance: r.opening_balance, openingDate: r.opening_date, archived: !!r.archived, position: r.position,
  loan: r.kind === 'credit' ? toLoan(r) : null,
});

/**
 * Titulaires, indexés par compte. Un compte joint en a deux, une assurance
 * famille peut en avoir quatre : la question « à qui est-ce » n'a pas de réponse
 * unique dans un foyer.
 */
const accountMembers = (): Map<number, string[]> => readMembers(database, 'fin_account_members', 'account_id');
const writeAccountMembers = (accountId: number, memberIds: string[]): void =>
  writeMembers(database, 'fin_account_members', 'account_id', accountId, memberIds);

interface CategoryRow { id: number; parent_id: number | null; name: string; monthly_budget: number; color: string; icon: string; position: number; fixed: number; }
const toCategory = (r: CategoryRow): Category => ({
  id: r.id, parentId: r.parent_id, name: r.name, monthlyBudget: r.monthly_budget,
  color: r.color, icon: r.icon, position: r.position, fixed: !!r.fixed,
});

interface TxRow {
  id: number; account_id: number; date: string; amount: number; kind: string;
  label_raw: string; label: string; category_id: number | null; contract_id: number | null;
  notes: string; cleared: number; transfer_group: string | null; import_id: number | null;
  rule_id: number | null;
  /** Présent quand la requête l'a demandé (voir TX_SELECT). */
  transfer_account_id?: number | null;
}
const toTransaction = (r: TxRow, tags: string[] = []): Transaction => ({
  id: r.id, accountId: r.account_id, date: r.date, amount: r.amount, kind: r.kind as TxKind,
  labelRaw: r.label_raw, label: r.label, categoryId: r.category_id, contractId: r.contract_id,
  notes: r.notes, cleared: !!r.cleared, transferGroup: r.transfer_group, importId: r.import_id,
  ruleId: r.rule_id, tags, transferAccountId: r.transfer_account_id ?? null,
});

/** Une opération et, pour un virement, le compte de l'autre côté. */
const TX_SELECT = `SELECT t.*, (SELECT x.account_id FROM fin_transactions x
  WHERE t.transfer_group IS NOT NULL AND x.transfer_group = t.transfer_group AND x.id <> t.id LIMIT 1) AS transfer_account_id
  FROM fin_transactions t`;

// ---- accounts ------------------------------------------------------------
export function listAccounts(): Account[] {
  const members = accountMembers();
  return (database.prepare('SELECT * FROM fin_accounts ORDER BY archived, position, id').all() as AccountRow[])
    .map((r) => toAccount(r, members.get(r.id) ?? []));
}

export function getAccount(id: number): Account | null {
  const r = database.prepare('SELECT * FROM fin_accounts WHERE id = ?').get(id) as AccountRow | undefined;
  return r ? toAccount(r, accountMembers().get(id) ?? []) : null;
}

export interface AccountInput {
  name: string; kind: string; memberIds: string[]; openingBalance: number; openingDate: string | null;
  archived: boolean; loan?: LoanTerms | null;
}

/** Les cinq colonnes du prêt, dans l'ordre des requêtes. Null partout hors crédit. */
const loanCols = (input: AccountInput): (number | string | null)[] => {
  const l = input.kind === 'credit' ? (input.loan ?? null) : null;
  return l ? [l.principal, l.rateBp, l.payment, l.insurance, l.firstOn] : [null, null, null, null, null];
};

export function createAccount(input: AccountInput): Account {
  return database.transaction(() => {
    const pos = (database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM fin_accounts').get() as { p: number }).p;
    const info = database.prepare(
      `INSERT INTO fin_accounts
         (name, kind, opening_balance, opening_date, archived, position,
          loan_principal, loan_rate_bp, loan_payment, loan_insurance, loan_first_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(input.name, input.kind, input.openingBalance, input.openingDate, input.archived ? 1 : 0, pos, ...loanCols(input));
    const id = Number(info.lastInsertRowid);
    writeAccountMembers(id, input.memberIds);
    return getAccount(id)!;
  })();
}

export function updateAccount(id: number, input: AccountInput): Account | null {
  return database.transaction(() => {
    const info = database.prepare(
      `UPDATE fin_accounts SET name = ?, kind = ?, opening_balance = ?, opening_date = ?, archived = ?,
         loan_principal = ?, loan_rate_bp = ?, loan_payment = ?, loan_insurance = ?, loan_first_on = ?
       WHERE id = ?`,
    ).run(input.name, input.kind, input.openingBalance, input.openingDate, input.archived ? 1 : 0, ...loanCols(input), id);
    if (!info.changes) return null;
    writeAccountMembers(id, input.memberIds);
    return getAccount(id);
  })();
}

export function countTransactionsForAccount(id: number): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM fin_transactions WHERE account_id = ?').get(id) as { n: number }).n;
}

export function deleteAccount(id: number): void {
  database.prepare('DELETE FROM fin_accounts WHERE id = ?').run(id);
}

/**
 * Solde d'un compte : le solde d'ouverture, plus les opérations **postérieures**
 * à sa date d'ouverture. Sans date, tout l'historique compte.
 *
 * La date est inclusive côté solde : « solde au 20/08 » est le solde de fin de
 * journée, comme sur un relevé bancaire, donc les opérations du 20/08 sont déjà
 * dedans et seules celles d'après le font bouger.
 */
export function accountBalances(): Record<number, number> {
  const rows = database.prepare(`
    SELECT a.id AS id, a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
    FROM fin_accounts a
    LEFT JOIN fin_transactions t
      ON t.account_id = a.id AND (a.opening_date IS NULL OR t.date > a.opening_date)
    GROUP BY a.id
  `).all() as { id: number; balance: number }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.balance]));
}

/**
 * Le solde de chaque compte à la fin des six derniers mois (le dernier arrêté à
 * aujourd'hui), du plus ancien au plus récent : la petite courbe des comptes.
 * Même règle que le solde : rien avant la date d'ouverture. Un crédit n'a pas
 * de registre, il n'y est pas.
 */
export function balanceHistory(today = new Date().toISOString().slice(0, 10)): Record<number, number[]> {
  const stmt = database.prepare(`
    SELECT a.id AS id, a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
    FROM fin_accounts a
    LEFT JOIN fin_transactions t
      ON t.account_id = a.id AND t.date <= ? AND (a.opening_date IS NULL OR t.date > a.opening_date)
    WHERE a.kind <> 'credit'
    GROUP BY a.id
  `);
  const out: Record<number, number[]> = {};
  for (let k = 5; k >= 0; k--) {
    const { to } = monthRange(shiftMonth(today.slice(0, 7), -k));
    for (const r of stmt.all(k ? to : today) as { id: number; balance: number }[]) (out[r.id] ??= []).push(r.balance);
  }
  return out;
}

/**
 * Opérations qu'une date d'ouverture écarte du solde, par compte. Elles restent
 * dans l'historique et dans le bilan : seul le solde les ignore, puisque le
 * solde saisi est censé les contenir déjà. Sans ce compteur, de l'argent
 * semblerait disparaître sans explication.
 */
export function opsBeforeOpening(): Record<number, number> {
  const rows = database.prepare(`
    SELECT a.id AS id, COUNT(t.id) AS n
    FROM fin_accounts a
    JOIN fin_transactions t ON t.account_id = a.id AND t.date <= a.opening_date
    WHERE a.opening_date IS NOT NULL
    GROUP BY a.id
  `).all() as { id: number; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.n]));
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

/** `fixed` absent (un client qui ne le connaît pas) laisse la valeur en place. */
export interface CategoryInput { parentId: number | null; name: string; monthlyBudget: number; color: string; icon: string; fixed?: boolean; }

export function createCategory(input: CategoryInput): Category {
  const pos = (database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM fin_categories').get() as { p: number }).p;
  const info = database.prepare(
    'INSERT INTO fin_categories (parent_id, name, monthly_budget, color, icon, position, fixed) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(input.parentId, input.name, input.monthlyBudget, input.color, input.icon, pos, input.fixed ? 1 : 0);
  return getCategory(Number(info.lastInsertRowid))!;
}

export function updateCategory(id: number, input: CategoryInput): Category | null {
  const info = database.prepare(
    'UPDATE fin_categories SET parent_id = ?, name = ?, monthly_budget = ?, color = ?, icon = ?, fixed = COALESCE(?, fixed) WHERE id = ?',
  ).run(input.parentId, input.name, input.monthlyBudget, input.color, input.icon, input.fixed === undefined ? null : input.fixed ? 1 : 0, id);
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
  uncategorised?: boolean; uncleared?: boolean; contractId?: number; q?: string; tag?: string; limit?: number; offset?: number;
}

/**
 * Une recherche qui ressemble à un montant : « 241,30 » vise ce montant exact,
 * « 241 » les montants de 241,00 à 241,99. Centimes, en valeur absolue ;
 * null quand la saisie n'est pas un montant.
 */
export function amountQuery(q: string): { min: number; max: number } | null {
  const m = /^[-−+]?\s*(\d{1,3}(?:[\s  ]?\d{3})*|\d+)(?:[.,](\d{1,2}))?\s*€?$/.exec(q.trim());
  if (!m) return null;
  const euros = Number(m[1].replace(/[\s  ]/g, ''));
  if (m[2] === undefined) return { min: euros * 100, max: euros * 100 + 99 };
  const cents = euros * 100 + Number(m[2].padEnd(2, '0'));
  return { min: cents, max: cents };
}

function whereClause(f: TxFilter): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (f.from) { parts.push('t.date >= ?'); params.push(f.from); }
  if (f.to) { parts.push('t.date <= ?'); params.push(f.to); }
  if (f.accountId) { parts.push('t.account_id = ?'); params.push(f.accountId); }
  if (f.categoryId) { parts.push('t.category_id = ?'); params.push(f.categoryId); }
  // « Sans catégorie » vise les dépenses : une recette ou un virement n'en ont jamais.
  if (f.uncategorised) parts.push("t.category_id IS NULL AND t.kind = 'depense'");
  if (f.uncleared) parts.push('t.cleared = 0');
  if (f.contractId) { parts.push('t.contract_id = ?'); params.push(f.contractId); }
  if (f.tag) { parts.push('t.id IN (SELECT tt.transaction_id FROM fin_transaction_tags tt JOIN fin_tags g ON g.id = tt.tag_id WHERE g.name = ?)'); params.push(f.tag); }
  if (f.q) {
    const like = `%${normaliseLabel(f.q)}%`;
    const amt = amountQuery(f.q);
    parts.push(`(fnorm(t.label) LIKE ? OR fnorm(t.label_raw) LIKE ? OR fnorm(t.notes) LIKE ?${amt ? ' OR ABS(t.amount) BETWEEN ? AND ?' : ''})`);
    params.push(like, like, like, ...(amt ? [amt.min, amt.max] : []));
  }
  return { sql: parts.length ? 'WHERE ' + parts.join(' AND ') : '', params };
}

export function listTransactions(f: TxFilter): { rows: Transaction[]; total: number } {
  const { sql, params } = whereClause(f);
  const total = (database.prepare(`SELECT COUNT(*) AS n FROM fin_transactions t ${sql}`).get(...params) as { n: number }).n;
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 1000);
  const offset = Math.max(f.offset ?? 0, 0);
  const rows = database.prepare(
    `${TX_SELECT} ${sql} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as TxRow[];
  const tags = tagsFor(rows.map((r) => r.id));
  return { rows: rows.map((r) => toTransaction(r, tags.get(r.id) ?? [])), total };
}

export function getTransaction(id: number): Transaction | null {
  const r = database.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id) as TxRow | undefined;
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

/**
 * Range plusieurs opérations dans leur catégorie, en lot. Comme une correction à
 * la main, chaque ligne prend possession d'elle-même (`rule_id` remis à nul) :
 * c'est ce qui rend une suggestion acceptée durable et réutilisable comme mémoire.
 */
export function setCategoriesManual(items: { id: number; categoryId: number }[]): number {
  const stmt = database.prepare(
    "UPDATE fin_transactions SET category_id = ?, rule_id = NULL, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
  );
  const run = database.transaction((rows: { id: number; categoryId: number }[]): number => {
    let n = 0;
    for (const it of rows) n += stmt.run(it.categoryId, it.id).changes;
    return n;
  });
  return run(items);
}

export function deleteTransaction(id: number): void {
  // Its receipts go with it: kept, they would be rows nothing can reach.
  removeAllFor('transaction', id);
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
  // Le budget du mois : la référence, plus ce que les transferts y ont ajouté ou retiré.
  const net = movesNet(month, month);
  const categories: CategorySummary[] = roots.map((c) => ({
    categoryId: c.id, name: c.name, color: c.color, icon: c.icon,
    budget: c.monthlyBudget + (net.get(c.id) ?? 0), spent: spentBy.get(c.id) || 0,
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
  const gaps = new Set(gapsOver(from, deadline));
  const missing = (database.prepare(
    'SELECT id AS accountId, name FROM fin_accounts WHERE archived = 0 ORDER BY position, id',
  ).all() as { accountId: number; name: string }[])
    .filter((a) => gaps.has(a.accountId))
    .map((a) => ({ ...a, coveredThrough: covered.get(a.accountId) ?? null }))
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

/**
 * Daily spending of a month, with the same exclusions as the summary (internal
 * transfers out, expenses only), and the three months before cut at the same day.
 */
export function monthFlow(month: string, today = new Date().toISOString().slice(0, 10)): MonthFlow {
  const { from, to } = monthRange(month);
  const days = Number(to.slice(8));
  const day = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : days;
  // Root category, unless the category itself is a fixed charge.
  const CAT = 'CASE WHEN t.category_id IS NULL THEN NULL WHEN c.fixed = 1 OR c.parent_id IS NULL THEN c.id ELSE c.parent_id END';
  const SPENT = `FROM fin_transactions t LEFT JOIN fin_categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ? AND t.kind <> 'virement' AND t.amount < 0`;
  const daily = database.prepare(`
    SELECT CAST(substr(t.date, 9, 2) AS INTEGER) AS day, ${CAT} AS categoryId, SUM(-t.amount) AS spent
    ${SPENT} GROUP BY day, categoryId ORDER BY day
  `).all(from, to) as MonthFlow['daily'];
  const previous: MonthFlow['previous'] = [];
  for (let k = 1; k <= 3; k++) {
    const m = shiftMonth(month, -k);
    const r = monthRange(m);
    const end = `${m}-${String(Math.min(day, Number(r.to.slice(8)))).padStart(2, '0')}`;
    const rows = database.prepare(`SELECT ${CAT} AS categoryId, SUM(-t.amount) AS spentToDay ${SPENT} GROUP BY categoryId`)
      .all(r.from, end) as { categoryId: number | null; spentToDay: number }[];
    for (const row of rows) previous.push({ month: m, ...row });
  }
  const contracts = database.prepare(`
    SELECT contract_id AS contractId, SUM(-amount) AS amount, MAX(date) AS date FROM fin_transactions
    WHERE contract_id IS NOT NULL AND date >= ? AND date <= ? GROUP BY contract_id
  `).all(from, to) as MonthFlow['contracts'];
  return { month, days, day, daily, previous, contracts, moves: listBudgetMoves(month) };
}

// ---- budget moves ----------------------------------------------------------
interface MoveRow { id: number; month: string; from_category_id: number; to_category_id: number; amount: number; created_at: string; }
const toMove = (r: MoveRow): BudgetMove => ({
  id: r.id, month: r.month, fromCategoryId: r.from_category_id, toCategoryId: r.to_category_id, amount: r.amount, createdAt: r.created_at,
});

export function listBudgetMoves(month: string): BudgetMove[] {
  return (database.prepare('SELECT * FROM fin_budget_moves WHERE month = ? ORDER BY id').all(month) as MoveRow[]).map(toMove);
}

export function createBudgetMove(month: string, fromCategoryId: number, toCategoryId: number, amount: number): BudgetMove {
  const info = database.prepare('INSERT INTO fin_budget_moves (month, from_category_id, to_category_id, amount) VALUES (?, ?, ?, ?)')
    .run(month, fromCategoryId, toCategoryId, amount);
  return toMove(database.prepare('SELECT * FROM fin_budget_moves WHERE id = ?').get(info.lastInsertRowid) as MoveRow);
}

export function deleteBudgetMove(id: number): boolean {
  return database.prepare('DELETE FROM fin_budget_moves WHERE id = ?').run(id).changes > 0;
}

/** Solde des transferts par catégorie, de `from` à `to` (mois inclus) : entrants moins sortants. */
export function movesNet(from: string, to: string): Map<number, number> {
  const rows = database.prepare(`
    SELECT cat, SUM(delta) AS net FROM (
      SELECT to_category_id AS cat, amount AS delta FROM fin_budget_moves WHERE month >= ? AND month <= ?
      UNION ALL
      SELECT from_category_id AS cat, -amount AS delta FROM fin_budget_moves WHERE month >= ? AND month <= ?
    ) GROUP BY cat
  `).all(from, to, from, to) as { cat: number; net: number }[];
  return new Map(rows.map((r) => [r.cat, r.net]));
}

/** Months that hold at least one operation, most recent first. */
export function availableMonths(): string[] {
  return (database.prepare("SELECT DISTINCT substr(date, 1, 7) AS m FROM fin_transactions ORDER BY m DESC").all() as { m: string }[]).map((r) => r.m);
}

// ---- CSV export ----------------------------------------------------------
/**
 * Une cellule CSV, désarmée.
 *
 * Les guillemets ne protègent de rien ici : Excel et LibreOffice lisent le
 * **contenu** de la cellule, et une valeur commençant par `=`, `+`, `-`, `@`,
 * une tabulation ou un retour chariot y est interprétée comme une formule.
 * `=cmd|'/C calc'!A1` s'exécute à l'ouverture du fichier.
 *
 * Ce n'est pas théorique dans ce module : le libellé d'une opération vient
 * souvent d'un relevé bancaire importé, donc d'une source qu'on ne maîtrise pas.
 * Une apostrophe en tête suffit à faire lire la cellule comme du texte ; elle
 * n'apparaît pas dans le tableur.
 */
const FORMULE = /^[=+\-@\t\r]/;
/**
 * Un nombre écrit tel quel, signe compris. Il commence par « - » ou « + » sans
 * être une formule pour autant : un montant négatif est le cas ordinaire d'un
 * relevé, et le désarmer le ferait lire comme du texte, ce qui casse toutes les
 * sommes du fichier. La protection doit gêner l'attaque, pas l'usage.
 */
const NOMBRE = /^[+-]?\d+(?:[.,]\d+)?$/;

/** Vrai quand la valeur serait interprétée comme une formule à l'ouverture. */
const estFormule = (s: string): boolean => FORMULE.test(s) && !NOMBRE.test(s);
const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  return `"${(estFormule(s) ? "'" + s : s).replace(/"/g, '""')}"`;
};

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
