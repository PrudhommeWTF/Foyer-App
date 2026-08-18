// Orchestration of an import: parse, resolve, collapse, deduplicate, report.
//
// Nothing is written to the transactions table until the user validates. The
// parsed rows are stored in the draft so mapping an unknown account label and
// asking for a new report does not require uploading the file again.
import { findAccountByAlias, getAccount, listAccounts } from '../repo';
import { collapseBlocks, splitBlocks } from './blocks';
import { dedupeAgainst } from './dedupe';
import { findTransferCandidates } from './transfers';
import { ImportPreview, RawRow, StagedRow, UnknownAccount } from './types';
import { ExistingLookup } from './dedupe';
import { TransferSide } from './transfers';

/** Label shown for rows whose file carried no account column at all. */
export const NO_ACCOUNT_LABEL = '(aucun libellé de compte dans le fichier)';

export interface Resolution {
  /** Rows grouped by resolved account, already collapsed. */
  byAccount: Map<number, RawRow[]>;
  unknown: UnknownAccount[];
  collapsed: number;
}

/**
 * Split into blocks, resolve each block's label to a real account and collapse
 * the redundant blocks of a same account.
 */
export function resolveAndCollapse(rows: RawRow[]): Resolution {
  const blocks = splitBlocks(rows);
  const byAccount = new Map<number, ReturnType<typeof splitBlocks>>();
  const unknownRows = new Map<string, RawRow[]>();

  for (const block of blocks) {
    const accountId = block.accountLabel.trim() ? findAccountByAlias(block.accountLabel) : null;
    if (accountId === null) {
      const key = block.accountLabel.trim() || NO_ACCOUNT_LABEL;
      const list = unknownRows.get(key);
      if (list) list.push(...block.rows); else unknownRows.set(key, [...block.rows]);
      continue;
    }
    const list = byAccount.get(accountId);
    if (list) list.push(block); else byAccount.set(accountId, [block]);
  }

  const collapsedByAccount = new Map<number, RawRow[]>();
  let collapsed = 0;
  for (const [accountId, accountBlocks] of byAccount) {
    const result = collapseBlocks(accountBlocks);
    collapsedByAccount.set(accountId, result.rows);
    collapsed += result.collapsed;
  }

  const unknown: UnknownAccount[] = [...unknownRows.entries()].map(([label, rs]) => {
    const dates = rs.map((r) => r.date).sort();
    return {
      label,
      rows: rs.length,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      sample: rs.slice(0, 3).map((r) => r.label),
    };
  }).sort((a, b) => b.rows - a.rows);

  return { byAccount: collapsedByAccount, unknown, collapsed };
}

export interface StageResult {
  rows: (StagedRow & { dedupeSeq: number })[];
  duplicates: number;
  perAccount: ImportPreview['perAccount'];
  /** Window the file covers, recorded per account on commit. */
  coverage: Map<number, { from: string; to: string }>;
}

/**
 * Turn a resolution into the exact set of rows to insert.
 *
 * The covered window is the file's whole date range, applied to every account
 * the file mentions: an export states « here is everything I have for these
 * accounts over this period ». An account whose bank connection died drops out
 * of later exports entirely, so it keeps its older coverage and still raises the
 * incomplete-month alert.
 */
export function stage(resolution: Resolution, lookup: ExistingLookup): StageResult {
  const flat: (RawRow & { accountId: number })[] = [];
  for (const [accountId, rows] of resolution.byAccount) {
    for (const r of rows) flat.push({ ...r, accountId });
  }
  flat.sort((a, b) => a.line - b.line);

  const { toInsert, duplicates } = dedupeAgainst(flat, lookup);

  const allDates = flat.map((r) => r.date).sort();
  const window = allDates.length ? { from: allDates[0], to: allDates[allDates.length - 1] } : null;
  const coverage = new Map<number, { from: string; to: string }>();
  if (window) for (const accountId of resolution.byAccount.keys()) coverage.set(accountId, window);

  const names = new Map(listAccounts().map((a) => [a.id, a.name]));
  const perAccount: ImportPreview['perAccount'] = [];
  for (const [accountId, rows] of resolution.byAccount) {
    const dates = rows.map((r) => r.date).sort();
    const inserted = toInsert.filter((r) => r.accountId === accountId).length;
    perAccount.push({
      accountId,
      name: names.get(accountId) || getAccount(accountId)?.name || `Compte ${accountId}`,
      total: rows.length,
      toInsert: inserted,
      duplicates: rows.length - inserted,
      from: dates[0] || '',
      to: dates[dates.length - 1] || '',
    });
  }
  perAccount.sort((a, b) => b.total - a.total);

  return { rows: toInsert, duplicates, perAccount, coverage };
}

/** Candidate internal transfers among the rows about to be created. */
export function previewTransfers(rows: (StagedRow & { dedupeSeq: number })[], pool: TransferSide[]): number {
  const names = new Map(listAccounts().map((a) => [a.id, a.name]));
  // Staged rows have no id yet: negative placeholders keep them distinguishable
  // from the database rows they may pair with.
  const staged: TransferSide[] = rows.map((r, i) => ({
    id: -(i + 1), accountId: r.accountId, accountName: names.get(r.accountId) || '',
    date: r.date, amount: r.amount, label: r.label,
  }));
  return findTransferCandidates([...pool, ...staged]).length;
}
