import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

// Wire shapes of /api/finances. Amounts are signed integer cents everywhere:
// the euro value only exists at display time.

export type AccountKind = 'courant' | 'pro' | 'epargne';
export type TxKind = 'depense' | 'recette' | 'virement';

export interface FinAccount {
  id: number; name: string; kind: AccountKind; memberId: string | null;
  openingBalance: number; openingDate: string | null; archived: boolean; position: number;
}

export interface FinCategory {
  id: number; parentId: number | null; name: string; monthlyBudget: number;
  color: string; icon: string; position: number;
}

export interface FinTransaction {
  id: number; accountId: number; date: string; amount: number; kind: TxKind;
  labelRaw: string; label: string; categoryId: number | null; contractId: number | null;
  notes: string; cleared: boolean; transferGroup: string | null; importId: number | null;
}

export interface FinAlias { id: number; accountId: number; labelNorm: string; labelRaw: string; }

export interface FinCoverage { accountId: number; name: string; firstDate: string | null; lastDate: string | null; count: number; }

export interface FinCategorySummary {
  categoryId: number | null; name: string; color: string; icon: string; budget: number; spent: number;
}

export interface FinMonthSummary {
  month: string; income: number; expense: number; balance: number; budgetTotal: number;
  categories: FinCategorySummary[];
  missing: { accountId: number; name: string; lastDate: string | null }[];
  incomplete: boolean;
}

export interface FinBootstrap {
  accounts: FinAccount[]; categories: FinCategory[]; balances: Record<number, number>;
  coverage: FinCoverage[]; months: string[]; aliases: FinAlias[];
}

export interface AccountPayload {
  name: string; kind: AccountKind; memberId: string | null;
  openingBalance: string; openingDate: string | null; archived: boolean;
}

export interface CategoryPayload {
  parentId: number | null; name: string; monthlyBudget: string; color: string; icon: string;
}

export interface TxPayload {
  accountId: number; date: string; amount: string; kind: TxKind;
  label: string; categoryId: number | null; notes: string; cleared: boolean;
}

export interface TxQuery {
  from?: string; to?: string; accountId?: number; categoryId?: number;
  uncategorised?: boolean; q?: string; limit?: number; offset?: number;
}

/** Thin client over /api/finances, reusing ApiService's token and error handling. */
@Injectable({ providedIn: 'root' })
export class FinancesApi {
  private api = inject(ApiService);

  bootstrap(): Promise<FinBootstrap> { return this.api.request('finances/bootstrap'); }

  createAccount(p: AccountPayload): Promise<{ account: FinAccount }> {
    return this.api.request('finances/accounts', { method: 'POST', body: JSON.stringify(p) });
  }
  updateAccount(id: number, p: AccountPayload): Promise<{ account: FinAccount }> {
    return this.api.request(`finances/accounts/${id}`, { method: 'PUT', body: JSON.stringify(p) });
  }
  deleteAccount(id: number): Promise<{ ok: boolean }> {
    return this.api.request(`finances/accounts/${id}`, { method: 'DELETE' });
  }
  addAlias(accountId: number, label: string): Promise<{ aliases: FinAlias[] }> {
    return this.api.request(`finances/accounts/${accountId}/aliases`, { method: 'POST', body: JSON.stringify({ label }) });
  }
  deleteAlias(id: number): Promise<{ aliases: FinAlias[] }> {
    return this.api.request(`finances/aliases/${id}`, { method: 'DELETE' });
  }

  createCategory(p: CategoryPayload): Promise<{ category: FinCategory }> {
    return this.api.request('finances/categories', { method: 'POST', body: JSON.stringify(p) });
  }
  updateCategory(id: number, p: CategoryPayload): Promise<{ category: FinCategory }> {
    return this.api.request(`finances/categories/${id}`, { method: 'PUT', body: JSON.stringify(p) });
  }
  deleteCategory(id: number): Promise<{ categories: FinCategory[] }> {
    return this.api.request(`finances/categories/${id}`, { method: 'DELETE' });
  }

  transactions(q: TxQuery): Promise<{ rows: FinTransaction[]; total: number }> {
    const p = new URLSearchParams();
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    if (q.accountId) p.set('accountId', String(q.accountId));
    if (q.categoryId) p.set('categoryId', String(q.categoryId));
    if (q.uncategorised) p.set('uncategorised', '1');
    if (q.q) p.set('q', q.q);
    if (q.limit !== undefined) p.set('limit', String(q.limit));
    if (q.offset !== undefined) p.set('offset', String(q.offset));
    return this.api.request('finances/transactions?' + p.toString());
  }
  createTransaction(p: TxPayload): Promise<{ transaction: FinTransaction }> {
    return this.api.request('finances/transactions', { method: 'POST', body: JSON.stringify(p) });
  }
  updateTransaction(id: number, p: TxPayload): Promise<{ transaction: FinTransaction }> {
    return this.api.request(`finances/transactions/${id}`, { method: 'PUT', body: JSON.stringify(p) });
  }
  deleteTransaction(id: number): Promise<{ ok: boolean }> {
    return this.api.request(`finances/transactions/${id}`, { method: 'DELETE' });
  }

  summary(month: string): Promise<{ summary: FinMonthSummary }> {
    return this.api.request('finances/summary?month=' + encodeURIComponent(month));
  }

  /** CSV export as a blob (fetched with the session token, not a bare link). */
  exportCsv(): Promise<Blob> { return this.api.download('finances/export.csv'); }
}
