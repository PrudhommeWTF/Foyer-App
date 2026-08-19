// Database access for imports, transfer merging and coverage.
// Kept apart from repo.ts so the import machinery stays readable on its own.
import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { Existing } from './import/dedupe';
import { StagedRow } from './import/types';
import { TransferSide } from './import/transfers';

let database: Database;
export function initImportRepo(db: Database): void { database = db; }

export type ImportStatus = 'pending' | 'committed' | 'cancelled';

export interface ImportRow {
  id: number;
  filename: string;
  format: string;
  status: ImportStatus;
  startedAt: string;
  finishedAt: string | null;
  inserted: number;
  duplicates: number;
  transfers: number;
  report: string;
  /** Rows currently in the database that this import created. */
  liveRows: number;
  /** Of those, how many were edited by hand afterwards. */
  editedRows: number;
  coverage: { accountId: number; name: string; from: string; to: string }[];
}

const IMPORT_COLS = `i.id, i.filename, i.format, i.status, i.started_at AS startedAt,
  i.finished_at AS finishedAt, i.inserted, i.duplicates, i.transfers, i.report`;

function decorate(row: Record<string, unknown>): ImportRow {
  const id = row['id'] as number;
  const counts = database.prepare(
    `SELECT COUNT(*) AS live, SUM(CASE WHEN updated_at > created_at THEN 1 ELSE 0 END) AS edited
     FROM fin_transactions WHERE import_id = ?`,
  ).get(id) as { live: number; edited: number | null };
  const coverage = database.prepare(
    `SELECT c.account_id AS accountId, a.name AS name, c.from_date AS "from", c.to_date AS "to"
     FROM fin_import_coverage c JOIN fin_accounts a ON a.id = c.account_id
     WHERE c.import_id = ? ORDER BY a.position, a.id`,
  ).all(id) as ImportRow['coverage'];
  return { ...(row as unknown as ImportRow), liveRows: counts.live, editedRows: counts.edited || 0, coverage };
}

export function listImports(limit = 30): ImportRow[] {
  const rows = database.prepare(
    `SELECT ${IMPORT_COLS} FROM fin_imports i WHERE i.status <> 'cancelled' ORDER BY i.id DESC LIMIT ?`,
  ).all(limit) as Record<string, unknown>[];
  return rows.map(decorate);
}

export function getImport(id: number): ImportRow | null {
  const row = database.prepare(`SELECT ${IMPORT_COLS} FROM fin_imports i WHERE i.id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? decorate(row) : null;
}

/** Create the draft that will hold the staged rows until the user validates. */
export function createDraft(filename: string, format: string): number {
  const info = database.prepare(
    "INSERT INTO fin_imports (filename, format, status) VALUES (?, ?, 'pending')",
  ).run(filename, format);
  return Number(info.lastInsertRowid);
}

export function saveDraft(id: number, payload: unknown, report: unknown): void {
  database.prepare('UPDATE fin_imports SET payload = ?, report = ? WHERE id = ?')
    .run(JSON.stringify(payload), JSON.stringify(report), id);
}

export function readDraft(id: number): { payload: unknown; report: unknown; status: ImportStatus; filename: string } | null {
  const row = database.prepare('SELECT payload, report, status, filename FROM fin_imports WHERE id = ?').get(id) as
    | { payload: string; report: string; status: ImportStatus; filename: string } | undefined;
  if (!row) return null;
  return {
    payload: row.payload ? JSON.parse(row.payload) : null,
    report: row.report ? JSON.parse(row.report) : null,
    status: row.status,
    filename: row.filename,
  };
}

export function cancelDraft(id: number): void {
  database.prepare("UPDATE fin_imports SET status = 'cancelled', payload = '', finished_at = datetime('now') WHERE id = ? AND status = 'pending'").run(id);
}

/** Drop drafts left behind by an abandoned upload, so they never pile up. */
export function purgeStaleDrafts(olderThanHours = 24): number {
  const info = database.prepare(
    `DELETE FROM fin_imports WHERE status = 'pending' AND started_at < datetime('now', ?)`,
  ).run(`-${Math.max(1, Math.floor(olderThanHours))} hours`);
  return info.changes;
}

/** How many rows the database already holds for each fingerprint, and the highest rank used. */
export function existingByKey(keys: string[]): Map<string, Existing> {
  const out = new Map<string, Existing>();
  if (!keys.length) return out;
  const stmt = database.prepare(
    'SELECT dedupe_key AS k, COUNT(*) AS count, MAX(dedupe_seq) AS maxSeq FROM fin_transactions WHERE dedupe_key IN (SELECT value FROM json_each(?)) GROUP BY dedupe_key',
  );
  for (const r of stmt.all(JSON.stringify(keys)) as { k: string; count: number; maxSeq: number }[]) {
    out.set(r.k, { count: r.count, maxSeq: r.maxSeq });
  }
  return out;
}

export interface InsertableRow extends StagedRow { dedupeSeq: number }

/**
 * Write the staged rows and the covered window in a single transaction: either
 * the whole import lands, or nothing does.
 */
export function commitImport(id: number, rows: InsertableRow[], coverage: Map<number, { from: string; to: string }>): number {
  const insert = database.prepare(`
    INSERT INTO fin_transactions
      (account_id, date, amount, kind, label_raw, label, category_id, notes, cleared, import_id, dedupe_key, dedupe_seq)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
  `);
  const cover = database.prepare(
    'INSERT INTO fin_import_coverage (import_id, account_id, from_date, to_date) VALUES (?, ?, ?, ?) ON CONFLICT(import_id, account_id) DO UPDATE SET from_date = excluded.from_date, to_date = excluded.to_date',
  );
  const finish = database.prepare(
    "UPDATE fin_imports SET status = 'committed', inserted = ?, payload = '', finished_at = datetime('now') WHERE id = ?",
  );

  return database.transaction(() => {
    for (const r of rows) {
      insert.run(
        r.accountId, r.date, r.amount, r.amount < 0 ? 'depense' : 'recette',
        r.label, r.label, r.notes, r.cleared ? 1 : 0, id, r.dedupeKey, r.dedupeSeq,
      );
    }
    for (const [accountId, window] of coverage) cover.run(id, accountId, window.from, window.to);
    finish.run(rows.length, id);
    return rows.length;
  })();
}

/**
 * Remove everything an import created. Surviving legs of a transfer whose other
 * half disappears lose their grouping, so no half-transfer is left behind.
 */
export function undoImport(id: number): { deleted: number; ungrouped: number } {
  return database.transaction(() => {
    const groups = database.prepare(
      'SELECT DISTINCT transfer_group AS g FROM fin_transactions WHERE import_id = ? AND transfer_group IS NOT NULL',
    ).all(id) as { g: string }[];
    const info = database.prepare('DELETE FROM fin_transactions WHERE import_id = ?').run(id);
    let ungrouped = 0;
    for (const { g } of groups) {
      const left = database.prepare('SELECT COUNT(*) AS n FROM fin_transactions WHERE transfer_group = ?').get(g) as { n: number };
      if (left.n < 2) {
        ungrouped += database.prepare(
          "UPDATE fin_transactions SET transfer_group = NULL, kind = CASE WHEN amount < 0 THEN 'depense' ELSE 'recette' END WHERE transfer_group = ?",
        ).run(g).changes;
      }
    }
    database.prepare("UPDATE fin_imports SET status = 'cancelled', inserted = 0, finished_at = datetime('now') WHERE id = ?").run(id);
    return { deleted: info.changes, ungrouped };
  })();
}

// ---- transfers ------------------------------------------------------------

/** Rows eligible for pairing: not already grouped, inside the window. */
export function transferPool(from: string, to: string): TransferSide[] {
  return database.prepare(`
    SELECT t.id, t.account_id AS accountId, a.name AS accountName, t.date, t.amount, t.label
    FROM fin_transactions t JOIN fin_accounts a ON a.id = t.account_id
    WHERE t.transfer_group IS NULL AND t.kind <> 'virement' AND t.date >= ? AND t.date <= ?
    ORDER BY t.date, t.id
  `).all(from, to) as TransferSide[];
}

/** Mark two rows as the legs of one internal transfer. */
export function mergeTransfer(debitId: number, creditId: number): string {
  const group = 'tg_' + crypto.randomBytes(8).toString('hex');
  database.transaction(() => {
    const rows = database.prepare(
      'SELECT id, amount, account_id AS accountId, transfer_group AS grp FROM fin_transactions WHERE id IN (?, ?)',
    ).all(debitId, creditId) as { id: number; amount: number; accountId: number; grp: string | null }[];
    if (rows.length !== 2) throw new Error('Opération introuvable.');
    if (rows.some((r) => r.grp)) throw new Error('Une des deux opérations fait déjà partie d’un virement.');
    if (rows[0].accountId === rows[1].accountId) throw new Error('Un virement interne relie deux comptes différents.');
    if (rows[0].amount !== -rows[1].amount) throw new Error('Les deux montants ne s’annulent pas.');
    database.prepare(
      "UPDATE fin_transactions SET transfer_group = ?, kind = 'virement', category_id = NULL WHERE id IN (?, ?)",
    ).run(group, debitId, creditId);
  })();
  return group;
}

/** Split a validated transfer back into two ordinary operations. */
export function unmergeTransfer(group: string): number {
  return database.prepare(
    "UPDATE fin_transactions SET transfer_group = NULL, kind = CASE WHEN amount < 0 THEN 'depense' ELSE 'recette' END WHERE transfer_group = ?",
  ).run(group).changes;
}

/** Validated transfers, most recent first, for review and undo. */
export function listTransfers(limit = 200): { group: string; date: string; amount: number; from: string; to: string }[] {
  return database.prepare(`
    SELECT t.transfer_group AS "group",
           MIN(t.date) AS date,
           MAX(t.amount) AS amount,
           MAX(CASE WHEN t.amount < 0 THEN a.name END) AS "from",
           MAX(CASE WHEN t.amount > 0 THEN a.name END) AS "to"
    FROM fin_transactions t JOIN fin_accounts a ON a.id = t.account_id
    WHERE t.transfer_group IS NOT NULL
    GROUP BY t.transfer_group
    ORDER BY MIN(t.date) DESC
    LIMIT ?
  `).all(limit) as { group: string; date: string; amount: number; from: string; to: string }[];
}

// ---- coverage -------------------------------------------------------------

/**
 * Date through which each account's data is known to be complete.
 *
 * Only accounts that have been through an import appear here. An import states
 * « this is everything I have for these accounts over this period », which is a
 * claim about completeness; typing operations by hand is not. Flagging an
 * account nobody ever imported would turn the alert into noise, and the alert is
 * only useful while it stays rare.
 *
 * For an imported account, manual rows entered after the last import still count:
 * you knew about them when you typed them.
 */
export interface Interval { from: string; to: string }

const nextDay = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Covered windows per account, merged. Two imports that touch or overlap become
 * one interval; a hole between them stays a hole, which is the point: it is what
 * lets a month be called incomplete because data is **missing in the middle**,
 * not only because it stops early.
 */
export function coverageIntervals(): Map<number, Interval[]> {
  const rows = database.prepare(
    'SELECT account_id AS id, from_date AS f, to_date AS t FROM fin_import_coverage ORDER BY account_id, from_date',
  ).all() as { id: number; f: string; t: string }[];

  const out = new Map<number, Interval[]>();
  for (const r of rows) {
    const list = out.get(r.id);
    const last = list?.[list.length - 1];
    if (last && r.f <= nextDay(last.to)) { if (r.t > last.to) last.to = r.t; }
    else if (list) list.push({ from: r.f, to: r.t });
    else out.set(r.id, [{ from: r.f, to: r.t }]);
  }

  // An operation dated after the declared window still proves coverage up to it:
  // an import states a period, the rows inside it can only extend the end.
  for (const r of database.prepare(
    'SELECT account_id AS id, MAX(date) AS d FROM fin_transactions WHERE account_id IN (SELECT DISTINCT account_id FROM fin_import_coverage) GROUP BY account_id',
  ).all() as { id: number; d: string }[]) {
    const list = out.get(r.id);
    const last = list?.[list.length - 1];
    if (last && r.d > last.to) last.to = r.d;
  }
  return out;
}

/**
 * Accounts whose data does not cover the whole of `[from, deadline]`.
 *
 * Only accounts already fed by an import are judged: a manually kept account
 * never claims to be exhaustive, so it can never be incomplete. Nothing is
 * claimed either about the period **before** an account's first covered day,
 * which is what keeps a passbook opened last year from flagging every month of
 * the year before.
 */
export function gapsOver(from: string, deadline: string): number[] {
  const intervals = coverageIntervals();
  const out: number[] = [];
  for (const [accountId, list] of intervals) {
    const start = list[0].from > from ? list[0].from : from;
    if (start > deadline) continue;
    // Walk the intervals: everything from `start` to `deadline` must be covered.
    let cursor = start;
    for (const iv of list) {
      if (iv.from > cursor) break;
      if (iv.to >= cursor) cursor = nextDay(iv.to);
      if (cursor > deadline) break;
    }
    if (cursor <= deadline) out.push(accountId);
  }
  return out;
}

export function coveredThrough(): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of database.prepare(
    'SELECT account_id AS id, MAX(to_date) AS d FROM fin_import_coverage GROUP BY account_id',
  ).all() as { id: number; d: string }[]) out.set(r.id, r.d);

  if (!out.size) return out;
  for (const r of database.prepare(
    'SELECT account_id AS id, MAX(date) AS d FROM fin_transactions WHERE account_id IN (SELECT DISTINCT account_id FROM fin_import_coverage) GROUP BY account_id',
  ).all() as { id: number; d: string }[]) {
    const known = out.get(r.id);
    if (known && r.d > known) out.set(r.id, r.d);
  }
  return out;
}
