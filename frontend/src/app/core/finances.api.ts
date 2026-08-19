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
  /** Rule that decided the current category; null when set by hand. */
  ruleId: number | null;
  tags: string[];
}

export interface FinAlias { id: number; accountId: number; labelNorm: string; labelRaw: string; }

export interface FinCoverage { accountId: number; name: string; firstDate: string | null; lastDate: string | null; count: number; }

export interface FinCategorySummary {
  categoryId: number | null; name: string; color: string; icon: string; budget: number; spent: number;
}

export interface FinMonthSummary {
  month: string; income: number; expense: number; balance: number; budgetTotal: number;
  categories: FinCategorySummary[];
  missing: { accountId: number; name: string; coveredThrough: string | null }[];
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
  uncategorised?: boolean; contractId?: number; tag?: string; q?: string; limit?: number; offset?: number;
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
    if (q.contractId) p.set('contractId', String(q.contractId));
    if (q.tag) p.set('tag', q.tag);
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

  // ---- attachments ----
  attachments(owner: FinOwnerKind, id: number): Promise<{ attachments: FinAttachment[] }> {
    return this.api.request(`finances/attachments?owner=${owner}&id=${id}`);
  }
  /** Raw body upload, like the statement import: no multipart, no base64 bloat. */
  uploadAttachment(owner: FinOwnerKind, id: number, file: File): Promise<{ attachment: FinAttachment; deduplicated: boolean; attachments: FinAttachment[] }> {
    return this.api.upload(`finances/attachments?owner=${owner}&id=${id}&filename=${encodeURIComponent(file.name)}`, file);
  }
  deleteAttachment(id: number): Promise<{ attachments: FinAttachment[] }> {
    return this.api.request(`finances/attachments/${id}`, { method: 'DELETE' });
  }
  /** Fetched with the session token, so a piece is never reachable by URL alone. */
  downloadAttachment(id: number): Promise<Blob> { return this.api.download(`finances/attachments/${id}?download=1`); }

  // ---- assets, contracts, deadlines ----
  contracts(): Promise<FinContractsBundle> { return this.api.request('finances/contracts'); }
  createAsset(p: FinAssetPayload): Promise<{ asset: FinAsset }> {
    return this.api.request('finances/assets', { method: 'POST', body: JSON.stringify(p) });
  }
  updateAsset(id: number, p: FinAssetPayload): Promise<{ asset: FinAsset }> {
    return this.api.request(`finances/assets/${id}`, { method: 'PUT', body: JSON.stringify(p) });
  }
  deleteAsset(id: number): Promise<{ assets: FinAsset[]; contracts: FinContract[] }> {
    return this.api.request(`finances/assets/${id}`, { method: 'DELETE' });
  }
  createContract(p: FinContractPayload): Promise<{ contract: FinContract }> {
    return this.api.request('finances/contracts', { method: 'POST', body: JSON.stringify(p) });
  }
  updateContract(id: number, p: FinContractPayload): Promise<{ contract: FinContract }> {
    return this.api.request(`finances/contracts/${id}`, { method: 'PUT', body: JSON.stringify(p) });
  }
  deleteContract(id: number): Promise<{ contracts: FinContract[]; detached: number }> {
    return this.api.request(`finances/contracts/${id}`, { method: 'DELETE' });
  }

  /** Everything the dashboard shows, in one call. */
  dashboard(month: string): Promise<{ dashboard: FinDashboard }> {
    return this.api.request('finances/dashboard?month=' + encodeURIComponent(month));
  }

  /** CSV export as a blob (fetched with the session token, not a bare link). */
  exportCsv(): Promise<Blob> { return this.api.download('finances/export.csv'); }

  // ---- import ----
  /** Upload a file as a raw body: no multipart dependency, no base64 inflation. */
  uploadImport(file: File): Promise<{ preview: FinImportPreview }> {
    return this.api.upload('finances/imports?filename=' + encodeURIComponent(file.name), file);
  }
  importPreview(id: number): Promise<{ preview: FinImportPreview }> {
    return this.api.request(`finances/imports/${id}/preview`);
  }
  mapImportAccount(id: number, label: string, accountId: number): Promise<{ preview: FinImportPreview }> {
    return this.api.request(`finances/imports/${id}/accounts`, { method: 'POST', body: JSON.stringify({ label, accountId }) });
  }
  commitImport(id: number): Promise<{ imported: FinImport; inserted: number; duplicates: number; categorised: FinApplyReport | null }> {
    return this.api.request(`finances/imports/${id}/commit`, { method: 'POST' });
  }
  discardImport(id: number): Promise<{ cancelled?: boolean; deleted?: number; ungrouped?: number }> {
    return this.api.request(`finances/imports/${id}`, { method: 'DELETE' });
  }
  imports(): Promise<{ imports: FinImport[] }> { return this.api.request('finances/imports'); }

  // ---- internal transfers ----
  transferCandidates(from: string, to: string): Promise<{ candidates: FinTransferCandidate[] }> {
    return this.api.request(`finances/transfers/candidates?from=${from}&to=${to}`);
  }
  mergeTransfers(pairs: { debitId: number; creditId: number }[]): Promise<{ merged: number; failed: { error: string }[] }> {
    return this.api.request('finances/transfers', { method: 'POST', body: JSON.stringify({ pairs }) });
  }
  transfers(): Promise<{ transfers: FinTransfer[] }> { return this.api.request('finances/transfers'); }
  splitTransfer(group: string): Promise<{ split: number }> {
    return this.api.request(`finances/transfers/${group}`, { method: 'DELETE' });
  }

  // ---- categorisation rules ----
  rules(): Promise<{ rules: FinRule[]; tags: FinTag[] }> { return this.api.request('finances/rules'); }
  createRule(p: FinRuleInput): Promise<{ rule: FinRule }> {
    return this.api.request('finances/rules', { method: 'POST', body: JSON.stringify(p) });
  }
  updateRule(id: number, p: FinRuleInput): Promise<{ rule: FinRule }> {
    return this.api.request(`finances/rules/${id}`, { method: 'PUT', body: JSON.stringify(p) });
  }
  deleteRule(id: number): Promise<{ rules: FinRule[] }> {
    return this.api.request(`finances/rules/${id}`, { method: 'DELETE' });
  }
  moveRule(id: number, delta: 1 | -1): Promise<{ rules: FinRule[] }> {
    return this.api.request(`finances/rules/${id}/move`, { method: 'POST', body: JSON.stringify({ delta }) });
  }
  /** What an unsaved rule would do. Writes nothing. */
  previewRule(p: FinRuleInput): Promise<{ preview: FinRulePreview }> {
    return this.api.request('finances/rules/preview', { method: 'POST', body: JSON.stringify(p) });
  }
  applyRules(p: { from?: string; to?: string; accountId?: number; force?: boolean }): Promise<{ report: FinApplyReport }> {
    return this.api.request('finances/rules/apply', { method: 'POST', body: JSON.stringify(p) });
  }
}

// ---- import ---------------------------------------------------------------

export interface FinRejectedRow { line: number; reason: string; raw: string; }
export interface FinUnknownAccount {
  label: string; rows: number; firstDate: string; lastDate: string; sample: string[];
  /** Account of the same name, pre-selected in the report. */
  suggestedAccountId: number | null;
}

export interface FinImportPreview {
  importId: number;
  filename: string;
  format: string;
  encoding: string;
  totalRows: number;
  uniqueRows: number;
  collapsed: number;
  duplicates: number;
  toInsert: number;
  perAccount: { accountId: number; name: string; total: number; toInsert: number; duplicates: number; from: string; to: string }[];
  unknownAccounts: FinUnknownAccount[];
  rejected: FinRejectedRow[];
  transferCandidates: number;
  blocked: boolean;
}

export interface FinImport {
  id: number;
  filename: string;
  format: string;
  status: 'pending' | 'committed' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  inserted: number;
  duplicates: number;
  liveRows: number;
  editedRows: number;
  coverage: { accountId: number; name: string; from: string; to: string }[];
}

export type FinConfidence = 'forte' | 'moyenne' | 'faible';
export interface FinTransferSide { id: number; accountId: number; accountName: string; date: string; amount: number; label: string; }
export interface FinTransferCandidate {
  debit: FinTransferSide; credit: FinTransferSide;
  daysApart: number; confidence: FinConfidence; reason: string;
}
export interface FinTransfer { group: string; date: string; amount: number; from: string; to: string; }

// ---- categorisation rules --------------------------------------------------

export type FinConditionField = 'label' | 'amount' | 'sens' | 'account' | 'dayOfMonth' | 'date';
export type FinConditionOp =
  | 'contains' | 'notContains' | 'equals' | 'startsWith' | 'regex'
  | 'gt' | 'lt' | 'between' | 'is' | 'isNot' | 'before' | 'after';
export type FinActionKind = 'category' | 'contract' | 'label' | 'tag' | 'transfer';

export interface FinCondition { field: FinConditionField; op: FinConditionOp; value: string; value2: string; }
export interface FinAction { kind: FinActionKind; value: string; }

export interface FinRuleInput {
  name: string; enabled: boolean; matchMode: 'all' | 'any'; stop: boolean;
  conditions: FinCondition[]; actions: FinAction[];
}
export interface FinRule extends FinRuleInput { id: number; position: number; }

export interface FinTag { id: number; name: string; count: number; }

export interface FinPreviewRow {
  id: number; date: string; amount: number; accountId: number; label: string;
  categoryId: number | null; contractId: number | null;
  newLabel: string | null; newCategoryId: number | null; newContractId: number | null;
  newTags: string[]; newTransfer: boolean;
  /** Category set by hand: the rule would leave it alone. */
  manual: boolean;
  /** False when the row already carries what the rule wants. */
  changes: boolean;
}
export interface FinRulePreview { matched: number; wouldChange: number; manualKept: number; rows: FinPreviewRow[]; }

export interface FinApplyReport {
  examined: number; changed: number; manualKept: number;
  perRule: { ruleId: number; name: string; changed: number }[];
}

// ---- dashboard -------------------------------------------------------------

export interface FinMonthPoint {
  month: string; income: number; expense: number; balance: number;
  /** An account's data does not cover the whole month. */
  incomplete: boolean;
}

export interface FinYearCategory {
  categoryId: number | null; name: string; color: string; icon: string;
  spent: number;
  /** Monthly budget of reference multiplied by the months elapsed. */
  budget: number;
}

export interface FinTopExpense {
  id: number; date: string; label: string; amount: number;
  accountId: number; categoryId: number | null;
}

export interface FinDashboard {
  month: FinMonthSummary;
  previous: { month: string; income: number; expense: number; balance: number } | null;
  series: FinMonthPoint[];
  averageExpense: number;
  completeMonths: number;
  year: {
    year: number; income: number; expense: number; balance: number;
    months: number; incompleteMonths: string[]; categories: FinYearCategory[];
  };
  topExpenses: FinTopExpense[];
}

// ---- assets, contracts, deadlines -------------------------------------------

export type FinAssetKind = 'immobilier' | 'vehicule' | 'autre';
export type FinAssetStatus = 'actif' | 'vendu';
export type FinContractKind = 'assurance' | 'energie' | 'telecom' | 'abonnement' | 'credit' | 'sante' | 'autre';
export type FinPeriodicity = 'mensuelle' | 'trimestrielle' | 'semestrielle' | 'annuelle' | 'ponctuelle';
export type FinContractStatus = 'actif' | 'resilie';
export type FinDeadlineKind = 'preavis' | 'renouvellement' | 'fin';

export interface FinAssetPayload {
  name: string; kind: FinAssetKind; status: FinAssetStatus; address: string;
  acquiredOn: string | null; soldOn: string | null; notes: string;
}
export interface FinAsset extends FinAssetPayload { id: number; position: number; contracts: number; }

export interface FinContractRef { key: string; value: string; }

export interface FinContractPayload {
  name: string; provider: string; kind: FinContractKind;
  assetId: number | null; accountId: number | null; categoryId: number | null; memberId: string | null;
  /** Sent as decimal strings; the server parses them once, into cents. */
  amountMin: string; amountMax: string;
  periodicity: FinPeriodicity;
  renewalOn: string | null; noticeDays: number; endsOn: string | null;
  status: FinContractStatus; notes: string; refs: FinContractRef[];
}

export interface FinContract {
  id: number; name: string; provider: string; kind: FinContractKind;
  assetId: number | null; accountId: number | null; categoryId: number | null; memberId: string | null;
  amountMin: number | null; amountMax: number | null;
  periodicity: FinPeriodicity;
  renewalOn: string | null; noticeDays: number; endsOn: string | null;
  status: FinContractStatus; notes: string; refs: FinContractRef[];
}

export interface FinDeadline {
  contractId: number; contractName: string; provider: string;
  kind: FinDeadlineKind; date: string;
  /** Days from today; negative when the window has closed. */
  daysAway: number;
  assetId: number | null; memberId: string | null;
}

export interface FinContractCost {
  contractId: number; count: number; total: number;
  lastDate: string | null; lastAmount: number | null;
  /** The last operation fell outside the declared range. */
  offRange: boolean;
}

export interface FinContractsBundle {
  assets: FinAsset[]; contracts: FinContract[]; deadlines: FinDeadline[];
  costs: Record<number, FinContractCost>;
  /** Attachment count per contract. */
  pieces: Record<number, number>;
}

export type FinOwnerKind = 'contract' | 'asset' | 'transaction';

export interface FinAttachment {
  id: number; ownerKind: FinOwnerKind; ownerId: number;
  name: string; mime: string; size: number; sha256: string; createdAt: string;
}
