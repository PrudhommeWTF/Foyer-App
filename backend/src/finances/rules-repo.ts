// Storage and application of the categorisation rules.
// The decision logic lives in rules.ts and never touches the database; this
// file only reads, writes and reports.
import type { Database } from 'better-sqlite3';
import { Action, Candidate, Condition, MatchMode, Rule, isNoop, keepsProvenance, matchRule, planChange } from './rules';

let database: Database;
export function initRulesRepo(db: Database): void { database = db; }

// ---- rules ----------------------------------------------------------------
export interface RuleInput {
  name: string;
  enabled: boolean;
  matchMode: MatchMode;
  stop: boolean;
  conditions: Condition[];
  actions: Action[];
}

function loadParts(ruleId: number): { conditions: Condition[]; actions: Action[] } {
  return {
    conditions: database.prepare('SELECT field, op, value, value2 FROM fin_rule_conditions WHERE rule_id = ? ORDER BY id').all(ruleId) as Condition[],
    actions: database.prepare('SELECT kind, value FROM fin_rule_actions WHERE rule_id = ? ORDER BY id').all(ruleId) as Action[],
  };
}

export function listRules(): Rule[] {
  const rows = database.prepare(
    'SELECT id, name, position, enabled, match_mode AS matchMode, stop FROM fin_rules ORDER BY position, id',
  ).all() as { id: number; name: string; position: number; enabled: number; matchMode: MatchMode; stop: number }[];
  return rows.map((r) => ({ ...r, enabled: !!r.enabled, stop: !!r.stop, ...loadParts(r.id) }));
}

export function getRule(id: number): Rule | null {
  return listRules().find((r) => r.id === id) ?? null;
}

function writeParts(ruleId: number, input: RuleInput): void {
  database.prepare('DELETE FROM fin_rule_conditions WHERE rule_id = ?').run(ruleId);
  database.prepare('DELETE FROM fin_rule_actions WHERE rule_id = ?').run(ruleId);
  const cond = database.prepare('INSERT INTO fin_rule_conditions (rule_id, field, op, value, value2) VALUES (?, ?, ?, ?, ?)');
  for (const c of input.conditions) cond.run(ruleId, c.field, c.op, c.value, c.value2);
  const act = database.prepare('INSERT INTO fin_rule_actions (rule_id, kind, value) VALUES (?, ?, ?)');
  for (const a of input.actions) act.run(ruleId, a.kind, a.value);
}

export function createRule(input: RuleInput): Rule {
  return database.transaction(() => {
    const pos = (database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM fin_rules').get() as { p: number }).p;
    const info = database.prepare(
      'INSERT INTO fin_rules (name, position, enabled, match_mode, stop) VALUES (?, ?, ?, ?, ?)',
    ).run(input.name, pos, input.enabled ? 1 : 0, input.matchMode, input.stop ? 1 : 0);
    const id = Number(info.lastInsertRowid);
    writeParts(id, input);
    return getRule(id)!;
  })();
}

export function updateRule(id: number, input: RuleInput): Rule | null {
  return database.transaction(() => {
    const info = database.prepare(
      'UPDATE fin_rules SET name = ?, enabled = ?, match_mode = ?, stop = ? WHERE id = ?',
    ).run(input.name, input.enabled ? 1 : 0, input.matchMode, input.stop ? 1 : 0, id);
    if (!info.changes) return null;
    writeParts(id, input);
    return getRule(id);
  })();
}

/**
 * Deleting a rule releases the rows it had decided: their category stays, but
 * they become manually owned rather than pointing at a rule that no longer
 * exists. Without this, a later replay would treat them as untouched.
 */
export function deleteRule(id: number): void {
  database.prepare('DELETE FROM fin_rules WHERE id = ?').run(id);
}

/** Move a rule up or down; order is what « ordonnancement » means at run time. */
export function moveRule(id: number, delta: number): void {
  const rules = listRules();
  const at = rules.findIndex((r) => r.id === id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= rules.length) return;
  const reordered = [...rules];
  const [moved] = reordered.splice(at, 1);
  reordered.splice(to, 0, moved);
  const stmt = database.prepare('UPDATE fin_rules SET position = ? WHERE id = ?');
  database.transaction(() => reordered.forEach((r, i) => stmt.run(i, r.id)))();
}

// ---- tags -----------------------------------------------------------------
export function listTags(): { id: number; name: string; count: number }[] {
  return database.prepare(`
    SELECT t.id, t.name, COUNT(tt.transaction_id) AS count
    FROM fin_tags t LEFT JOIN fin_transaction_tags tt ON tt.tag_id = t.id
    GROUP BY t.id ORDER BY t.name
  `).all() as { id: number; name: string; count: number }[];
}

function tagId(name: string): number {
  database.prepare('INSERT INTO fin_tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name);
  return (database.prepare('SELECT id FROM fin_tags WHERE name = ?').get(name) as { id: number }).id;
}

/** Tags of the given transactions, keyed by transaction id. */
export function tagsFor(ids: number[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  if (!ids.length) return out;
  const rows = database.prepare(`
    SELECT tt.transaction_id AS id, t.name FROM fin_transaction_tags tt
    JOIN fin_tags t ON t.id = tt.tag_id
    WHERE tt.transaction_id IN (SELECT value FROM json_each(?))
    ORDER BY t.name
  `).all(JSON.stringify(ids)) as { id: number; name: string }[];
  for (const r of rows) {
    const list = out.get(r.id);
    if (list) list.push(r.name); else out.set(r.id, [r.name]);
  }
  return out;
}

// ---- application ----------------------------------------------------------
export interface ApplyFilter { from?: string; to?: string; accountId?: number; importId?: number; ids?: number[]; }

function candidates(f: ApplyFilter): Candidate[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from) { where.push('date >= ?'); params.push(f.from); }
  if (f.to) { where.push('date <= ?'); params.push(f.to); }
  if (f.accountId) { where.push('account_id = ?'); params.push(f.accountId); }
  if (f.importId) { where.push('import_id = ?'); params.push(f.importId); }
  if (f.ids?.length) { where.push('id IN (SELECT value FROM json_each(?))'); params.push(JSON.stringify(f.ids)); }
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return database.prepare(`
    SELECT id, account_id AS accountId, date, amount, label, label_raw AS labelRaw,
           category_id AS categoryId, contract_id AS contractId, kind, rule_id AS ruleId
    FROM fin_transactions ${sql} ORDER BY date, id
  `).all(...params) as Candidate[];
}

export interface ApplyReport {
  /** Transactions examined. */
  examined: number;
  /** Transactions actually modified. */
  changed: number;
  /** Per rule, how many rows it decided something on. */
  perRule: { ruleId: number; name: string; changed: number }[];
  /** Rows left alone because their category was set by hand. */
  manualKept: number;
}

/**
 * Apply the enabled rules. `respectManual` protects categories set by hand,
 * which is the default: replaying must never undo a deliberate correction.
 */
export function applyRules(f: ApplyFilter = {}, respectManual = true): ApplyReport {
  const rules = listRules().filter((r) => r.enabled);
  const rows = candidates(f);
  const existingTags = tagsFor(rows.map((r) => r.id));
  const perRule = new Map<number, { name: string; changed: number }>();
  let changed = 0;
  let manualKept = 0;

  const setCategory = database.prepare("UPDATE fin_transactions SET category_id = ?, rule_id = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?");
  const setContract = database.prepare("UPDATE fin_transactions SET contract_id = ?, rule_id = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?");
  const setLabel = database.prepare("UPDATE fin_transactions SET label = ?, rule_id = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?");
  const setTransfer = database.prepare("UPDATE fin_transactions SET kind = 'virement', rule_id = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?");
  const addTag = database.prepare('INSERT INTO fin_transaction_tags (transaction_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING');

  database.transaction(() => {
    for (const tx of rows) {
      // Report the protection even when the rule would have changed nothing else.
      if (respectManual && tx.categoryId !== null && tx.ruleId === null && rules.some((r) => matchRule(tx, r))) manualKept++;

      const change = planChange(tx, rules, respectManual);
      if (!change) continue;
      const tags = existingTags.get(tx.id) ?? [];
      if (isNoop(tx, change, tags) && keepsProvenance(tx, change)) continue;

      if (change.categoryId !== undefined) setCategory.run(change.categoryId, change.ruleId, tx.id);
      if (change.contractId !== undefined) setContract.run(change.contractId, change.ruleId, tx.id);
      if (change.label !== undefined) setLabel.run(change.label, change.ruleId, tx.id);
      if (change.transfer) setTransfer.run(change.ruleId, tx.id);
      for (const name of change.tags) addTag.run(tx.id, tagId(name));

      changed++;
      const entry = perRule.get(change.reportId) ?? { name: change.ruleName, changed: 0 };
      entry.changed++;
      perRule.set(change.reportId, entry);
    }
  })();

  return {
    examined: rows.length,
    changed,
    manualKept,
    perRule: [...perRule.entries()].map(([ruleId, v]) => ({ ruleId, name: v.name, changed: v.changed }))
      .sort((a, b) => b.changed - a.changed),
  };
}

export interface PreviewRow {
  id: number;
  date: string;
  amount: number;
  accountId: number;
  label: string;
  categoryId: number | null;
  contractId: number | null;
  /** What the rule would put there instead. */
  newLabel: string | null;
  newCategoryId: number | null;
  newContractId: number | null;
  newTags: string[];
  newTransfer: boolean;
  /** True when the current value was set by hand and would be protected. */
  manual: boolean;
  /** False when the row already carries what the rule wants. */
  changes: boolean;
}

export interface PreviewReport { matched: number; wouldChange: number; manualKept: number; rows: PreviewRow[]; }

/**
 * What an unsaved rule would do, without writing anything. This is the same
 * decision path as applyRules, so what you see is what you get.
 */
export function previewRule(draft: RuleInput, limit = 40): PreviewReport {
  // A draft has no id yet; -1 stands in so its actions read as owned rather
  // than as the « decides nothing » case that id zero means.
  const rule: Rule = { id: -1, position: 0, ...draft };
  const rows = candidates({});
  // Tags already on the rows, so a rule that has run stops claiming it would
  // change them again.
  const existingTags = tagsFor(rows.map((r) => r.id));
  const out: PreviewRow[] = [];
  let matched = 0;
  let wouldChange = 0;
  let manualKept = 0;

  for (const tx of rows) {
    if (!matchRule(tx, rule)) continue;
    matched++;
    const manual = tx.categoryId !== null && tx.ruleId === null;
    const change = planChange(tx, [rule], true);
    const changes = !!change && !isNoop(tx, change, existingTags.get(tx.id) ?? []);
    if (changes) wouldChange++;
    if (manual && rule.actions.some((a) => a.kind === 'category')) manualKept++;
    if (out.length < limit) {
      out.push({
        id: tx.id, date: tx.date, amount: tx.amount, accountId: tx.accountId,
        label: tx.label, categoryId: tx.categoryId, contractId: tx.contractId,
        newLabel: change?.label ?? null,
        newCategoryId: change?.categoryId ?? null,
        newContractId: change?.contractId ?? null,
        newTags: change?.tags ?? [],
        newTransfer: !!change?.transfer,
        manual, changes,
      });
    }
  }
  return { matched, wouldChange, manualKept, rows: out };
}
