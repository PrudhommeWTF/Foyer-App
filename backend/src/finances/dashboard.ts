// Monthly and yearly aggregates, computed in SQL.
//
// The whole point of keeping the finances in real tables is that a sum over
// three thousand rows is a query, not a loop in the browser. Everything here
// returns figures ready to display, and says when a figure is understated.
import type { Database } from 'better-sqlite3';
import { MonthSummary } from './types';
import { monthRange, shiftMonth } from './money';
import { gapsOver } from './import-repo';
import { listCategories, monthSummary } from './repo';

let database: Database;
export function initDashboard(db: Database): void { database = db; }

/** How many months the yearly and rolling views look back. */
export const SERIES_LENGTH = 12;

export interface MonthPoint {
  month: string;
  income: number;
  expense: number;
  balance: number;
  /** True when an account's data does not cover the whole month. */
  incomplete: boolean;
}

export interface YearCategory {
  categoryId: number | null;
  name: string;
  color: string;
  icon: string;
  spent: number;
  /** Monthly budget of reference multiplied by the months actually elapsed. */
  budget: number;
}

export interface TopExpense {
  id: number; date: string; label: string; amount: number;
  accountId: number; categoryId: number | null;
}

export interface Dashboard {
  month: MonthSummary;
  /** The month before, for the comparison line. Null when nothing precedes it. */
  previous: { month: string; income: number; expense: number; balance: number } | null;
  /** The last SERIES_LENGTH months, oldest first, holes included as zeros. */
  series: MonthPoint[];
  /** Mean expense over the complete months of the series; 0 when there are none. */
  averageExpense: number;
  completeMonths: number;
  year: {
    year: number;
    income: number;
    expense: number;
    balance: number;
    /** Months of that year already begun, up to the month being viewed. */
    months: number;
    incompleteMonths: string[];
    categories: YearCategory[];
  };
  topExpenses: TopExpense[];
}

interface Totals { income: number; expense: number }

/** Income and expense between two dates, internal transfers excluded. */
function totals(from: string, to: string): Totals {
  return database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS expense
    FROM fin_transactions WHERE date >= ? AND date <= ? AND kind <> 'virement'
  `).get(from, to) as Totals;
}

/** Whether the month is fully covered, stopping at today for the month in progress. */
function isIncomplete(month: string, today: string): boolean {
  const { from, to } = monthRange(month);
  if (from > today) return false;
  return gapsOver(from, today < to ? today : to).length > 0;
}

function series(lastMonth: string, today: string): MonthPoint[] {
  const first = shiftMonth(lastMonth, -(SERIES_LENGTH - 1));
  const rows = database.prepare(`
    SELECT substr(date, 1, 7) AS month,
           COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS expense
    FROM fin_transactions
    WHERE date >= ? AND date <= ? AND kind <> 'virement'
    GROUP BY month
  `).all(monthRange(first).from, monthRange(lastMonth).to) as { month: string; income: number; expense: number }[];
  const byMonth = new Map(rows.map((r) => [r.month, r]));

  // Every month of the window is emitted, empty ones included: a gap drawn as a
  // gap is honest, a gap silently skipped makes the chart lie about the period.
  const out: MonthPoint[] = [];
  for (let i = 0; i < SERIES_LENGTH; i++) {
    const month = shiftMonth(first, i);
    const t = byMonth.get(month);
    const income = t?.income ?? 0;
    const expense = t?.expense ?? 0;
    out.push({ month, income, expense, balance: income - expense, incomplete: isIncomplete(month, today) });
  }
  return out;
}

/** Yearly spending per top-level category; a sub-category rolls up to its parent. */
function yearCategories(from: string, to: string, months: number): YearCategory[] {
  const spentRows = database.prepare(`
    SELECT COALESCE(c.parent_id, c.id) AS catId, COALESCE(SUM(-t.amount), 0) AS spent
    FROM fin_transactions t JOIN fin_categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ? AND t.kind <> 'virement' AND t.amount < 0
    GROUP BY COALESCE(c.parent_id, c.id)
  `).all(from, to) as { catId: number; spent: number }[];
  const spentBy = new Map(spentRows.map((r) => [r.catId, r.spent]));

  const out: YearCategory[] = listCategories().filter((c) => c.parentId === null).map((c) => ({
    categoryId: c.id, name: c.name, color: c.color, icon: c.icon,
    spent: spentBy.get(c.id) || 0, budget: c.monthlyBudget * months,
  }));

  const uncategorised = (database.prepare(`
    SELECT COALESCE(SUM(-amount), 0) AS spent FROM fin_transactions
    WHERE date >= ? AND date <= ? AND kind <> 'virement' AND amount < 0 AND category_id IS NULL
  `).get(from, to) as { spent: number }).spent;
  if (uncategorised > 0) {
    out.push({ categoryId: null, name: 'Sans catégorie', color: '#8A7E74', icon: 'facture', spent: uncategorised, budget: 0 });
  }
  return out.filter((c) => c.spent > 0 || c.budget > 0).sort((a, b) => b.spent - a.spent);
}

function topExpenses(from: string, to: string, limit = 8): TopExpense[] {
  return database.prepare(`
    SELECT id, date, label, amount, account_id AS accountId, category_id AS categoryId
    FROM fin_transactions
    WHERE date >= ? AND date <= ? AND kind <> 'virement' AND amount < 0
    ORDER BY amount ASC, id LIMIT ?
  `).all(from, to, limit) as TopExpense[];
}

export function dashboard(month: string, today = new Date().toISOString().slice(0, 10)): Dashboard {
  const { from, to } = monthRange(month);
  const points = series(month, today);

  const prevMonth = shiftMonth(month, -1);
  const prev = points.find((p) => p.month === prevMonth);
  const previous = prev && (prev.income || prev.expense)
    ? { month: prevMonth, income: prev.income, expense: prev.expense, balance: prev.balance }
    : null;

  // The average deliberately ignores incomplete and empty months: including them
  // would drag the reference down and make every normal month look extravagant.
  const usable = points.filter((p) => !p.incomplete && (p.income || p.expense));
  const averageExpense = usable.length ? Math.round(usable.reduce((a, p) => a + p.expense, 0) / usable.length) : 0;

  const year = Number(month.slice(0, 4));
  const yearFrom = `${year}-01-01`;
  const yearTo = to < `${year}-12-31` ? to : `${year}-12-31`;
  const monthsElapsed = Number(month.slice(5, 7));
  const yearTotals = totals(yearFrom, yearTo);
  const incompleteMonths: string[] = [];
  for (let m = 1; m <= monthsElapsed; m++) {
    const label = `${year}-${String(m).padStart(2, '0')}`;
    if (isIncomplete(label, today)) incompleteMonths.push(label);
  }

  return {
    month: monthSummary(month, today),
    previous,
    series: points,
    averageExpense,
    completeMonths: usable.length,
    year: {
      year,
      income: yearTotals.income,
      expense: yearTotals.expense,
      balance: yearTotals.income - yearTotals.expense,
      months: monthsElapsed,
      incompleteMonths,
      categories: yearCategories(yearFrom, yearTo, monthsElapsed),
    },
    topExpenses: topExpenses(from, to),
  };
}
