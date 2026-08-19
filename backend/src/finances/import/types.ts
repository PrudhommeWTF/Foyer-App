// Shapes exchanged between the parsers, the deduplication engine and the API.

/** One line as read from a file, before any account resolution. */
export interface RawRow {
  /** 1-based line (CSV) or record index, quoted verbatim in error reports. */
  line: number;
  date: string;          // ISO YYYY-MM-DD
  amount: number;        // signed cents
  label: string;         // raw label, never rewritten (the fingerprint depends on it)
  accountLabel: string;  // label as printed by the bank, resolved later via aliases
  category: string;      // provider's guess, imported as a suggestion only
  subCategory: string;
  notes: string;
  cleared: boolean;
}

/** A line the parser could not use, kept so the report can explain why. */
export interface RejectedRow { line: number; reason: string; raw: string; }

export interface ParseResult {
  format: string;
  rows: RawRow[];
  rejected: RejectedRow[];
  /** Encoding actually used to decode the bytes, surfaced in the report. */
  encoding: string;
}

/** A contiguous run of lines sharing the same account label. */
export interface Block { accountLabel: string; rows: RawRow[]; firstLine: number; lastLine: number; }

export interface UnknownAccount {
  label: string; rows: number; firstDate: string; lastDate: string; sample: string[];
  /** Active account bearing the same name, pre-selected in the report. Null when
   *  nothing matches, or when several accounts share the name. */
  suggestedAccountId: number | null;
}

/** One operation that survived collapsing, ready to be checked against the database. */
export interface StagedRow extends RawRow { accountId: number; dedupeKey: string; }

export interface ImportPreview {
  importId: number;
  filename: string;
  format: string;
  encoding: string;
  /** Lines read from the file, before any deduplication. */
  totalRows: number;
  /** Operations left after collapsing redundant blocks of the same account. */
  uniqueRows: number;
  /** Redundant copies removed inside the file (same account synced twice). */
  collapsed: number;
  /** Operations already present in the database (overlapping export). */
  duplicates: number;
  /** Operations that will actually be created. */
  toInsert: number;
  perAccount: { accountId: number; name: string; total: number; toInsert: number; duplicates: number; from: string; to: string }[];
  unknownAccounts: UnknownAccount[];
  rejected: RejectedRow[];
  transferCandidates: number;
  /** True when nothing can be written yet (an account label is unmapped). */
  blocked: boolean;
}
