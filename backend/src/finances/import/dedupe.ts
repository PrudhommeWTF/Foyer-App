// Deduplication against what the database already holds.
//
// Two exports that overlap must only bring their delta, and re-importing the
// same file must create nothing. The fingerprint is computed on the RAW label
// and frozen in the row at insert time, so renaming or recategorising an
// operation afterwards never resurrects it. See
// docs/finances-cahier-de-recette.md, anomalie 3.
import { dedupeKey } from '../repo';
import { RawRow, StagedRow } from './types';

/** What the database knows about one fingerprint. */
export interface Existing { count: number; maxSeq: number }

/** Injected so the engine stays pure and testable without a database. */
export type ExistingLookup = (keys: string[]) => Map<string, Existing>;

export interface DedupeResult {
  /** Rows that will actually be inserted, each with its fingerprint and rank. */
  toInsert: (StagedRow & { dedupeSeq: number })[];
  /** Rows discarded because the database already holds that many occurrences. */
  duplicates: number;
}

/**
 * Compare the file's occurrence counts with the database's. A fingerprint the
 * file carries twice while the database holds one gets exactly one new row.
 */
export function dedupeAgainst(rows: (RawRow & { accountId: number })[], lookup: ExistingLookup): DedupeResult {
  const staged: StagedRow[] = rows.map((r) => ({ ...r, dedupeKey: dedupeKey(r.accountId, r.date, r.amount, r.label) }));
  const existing = lookup([...new Set(staged.map((s) => s.dedupeKey))]);

  const seenInFile = new Map<string, number>();
  const nextSeq = new Map<string, number>();
  const toInsert: (StagedRow & { dedupeSeq: number })[] = [];
  let duplicates = 0;

  for (const row of staged) {
    const key = row.dedupeKey;
    const inDb = existing.get(key) ?? { count: 0, maxSeq: -1 };
    const rank = seenInFile.get(key) ?? 0;
    seenInFile.set(key, rank + 1);

    if (rank < inDb.count) { duplicates++; continue; }
    // Ranks continue past the highest sequence already stored, so a row deleted
    // by hand never causes a unique-constraint clash on the next import.
    const seq = nextSeq.get(key) ?? inDb.maxSeq + 1;
    nextSeq.set(key, seq + 1);
    toInsert.push({ ...row, dedupeSeq: seq });
  }
  return { toInsert, duplicates };
}
