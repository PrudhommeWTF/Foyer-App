// Block splitting and intra-file collapsing.
//
// This is where 223 raw lines become 95 real operations. An aggregator export is
// a concatenation of sections, one per (bank connection, account) pair: a block
// is a run of consecutive lines sharing the same account label. When several
// blocks resolve to the same real account they are redundant copies of the same
// statement, produced because the account is synced through more than one
// connection, or because the holder's name changed.
//
// The rule that matters: for each operation signature we keep the MAXIMUM number
// of occurrences seen in a SINGLE block, never the sum. Taking the sum would
// triple the statement; taking a plain set of signatures would swallow the two
// genuine identical cash withdrawals made on the same day. See
// docs/finances-cahier-de-recette.md, anomalie 1.
import { normaliseLabel } from '../money';
import { Block, RawRow } from './types';

/** Split rows into runs of consecutive lines sharing an account label. */
export function splitBlocks(rows: RawRow[]): Block[] {
  const blocks: Block[] = [];
  for (const row of rows) {
    const last = blocks[blocks.length - 1];
    if (last && last.accountLabel === row.accountLabel) {
      last.rows.push(row);
      last.lastLine = row.line;
    } else {
      blocks.push({ accountLabel: row.accountLabel, rows: [row], firstLine: row.line, lastLine: row.line });
    }
  }
  return blocks;
}

/** Identity of an operation inside one account: date, signed amount, raw label. */
export const signatureOf = (row: RawRow): string => `${row.date}|${row.amount}|${normaliseLabel(row.label)}`;

export interface CollapseResult {
  /** One entry per operation kept, in file order. */
  rows: RawRow[];
  /** Lines dropped as redundant copies of another block of the same account. */
  collapsed: number;
}

/**
 * Merge the blocks of a single real account. Occurrence counts are taken as the
 * maximum across blocks, so genuine same-day duplicates survive while redundant
 * syncs do not.
 */
export function collapseBlocks(blocks: Block[]): CollapseResult {
  const total = blocks.reduce((n, b) => n + b.rows.length, 0);
  const maxCount = new Map<string, number>();
  // Every row seen for a signature, in file order: the first ones are the
  // canonical copies, so line numbers and provider categories stay coherent.
  const seen = new Map<string, RawRow[]>();

  for (const block of blocks) {
    const counts = new Map<string, number>();
    for (const row of block.rows) {
      const sig = signatureOf(row);
      counts.set(sig, (counts.get(sig) || 0) + 1);
      const list = seen.get(sig);
      if (list) list.push(row); else seen.set(sig, [row]);
    }
    for (const [sig, n] of counts) maxCount.set(sig, Math.max(maxCount.get(sig) || 0, n));
  }

  const rows: RawRow[] = [];
  for (const [sig, n] of maxCount) {
    const all = seen.get(sig)!;
    for (let i = 0; i < n; i++) rows.push(all[i]);
  }
  rows.sort((a, b) => a.line - b.line);
  return { rows, collapsed: total - rows.length };
}
