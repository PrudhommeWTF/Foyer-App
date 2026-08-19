// Categorisation engine.
//
// The case that shapes the whole design: two contracts from the same provider,
// a bank label that is character-for-character identical, told apart only by the
// amount. Real example, four AXA direct debits on the same account, three of
// them labelled exactly « Prlv Sepa Axa » for -635,46 €, -81,69 € and -40,63 €.
// A rule engine that cannot combine « label contains » AND « amount between »
// is useless here. See docs/finances-cahier-de-recette.md, anomalie 6.
//
// This module is pure: it decides, it never writes. That keeps it testable
// without a database and keeps the preview and the replay strictly identical.
import { normaliseLabel } from './money';

export type MatchMode = 'all' | 'any';

export type ConditionField = 'label' | 'amount' | 'sens' | 'account' | 'dayOfMonth' | 'date';
export type ConditionOp =
  | 'contains' | 'notContains' | 'equals' | 'startsWith' | 'regex'
  | 'gt' | 'lt' | 'between' | 'is' | 'isNot' | 'before' | 'after';

export interface Condition { field: ConditionField; op: ConditionOp; value: string; value2: string; }

export type ActionKind = 'category' | 'label' | 'tag' | 'transfer' | 'contract';
export interface Action { kind: ActionKind; value: string; }

export interface Rule {
  id: number;
  name: string;
  position: number;
  enabled: boolean;
  matchMode: MatchMode;
  /** Stop evaluating later rules for a transaction this one matched. */
  stop: boolean;
  conditions: Condition[];
  actions: Action[];
}

/** The transaction fields a rule can look at. */
export interface Candidate {
  id: number;
  accountId: number;
  date: string;
  amount: number;
  label: string;
  labelRaw: string;
  categoryId: number | null;
  contractId: number | null;
  kind: string;
  /** null when the current state was set by hand rather than by a rule. */
  ruleId: number | null;
}

/** What a rule would change on one transaction. Empty means it changes nothing. */
export interface Effect {
  categoryId?: number | null;
  contractId?: number | null;
  label?: string;
  tags?: string[];
  transfer?: boolean;
}

export interface Outcome { ruleId: number; ruleName: string; effect: Effect; }

const numeric = (v: string): number | null => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const abs = (n: number | null): number | null => (n === null ? null : Math.abs(n));

/**
 * Amounts are compared on their **absolute value**, in euros, on both sides of
 * the comparison. People describe a direct debit as « between 600 and 700 », and
 * the ones who type « between -700 and -600 » mean the same thing. Use the
 * `sens` field to tell an expense from a resource.
 */
function matchAmount(cents: number, c: Condition): boolean {
  const euros = Math.abs(cents) / 100;
  // The bounds are taken in absolute value too. The interface shows « -635,46 € »,
  // so people do type « entre -700 et -600 »; comparing a positive amount to a
  // negative bound would match nothing, silently. Sign belongs to `sens`, and to
  // nothing else.
  const a = abs(numeric(c.value));
  const b = abs(numeric(c.value2));
  switch (c.op) {
    case 'gt': return a !== null && euros > a;
    case 'lt': return a !== null && euros < a;
    case 'between': return a !== null && b !== null && euros >= Math.min(a, b) && euros <= Math.max(a, b);
    case 'equals': return a !== null && Math.abs(euros - a) < 0.005;
    default: return false;
  }
}

function matchLabel(tx: Candidate, c: Condition): boolean {
  // Rules read the label the user sees; the raw one only backs the fingerprint.
  const hay = normaliseLabel(tx.label);
  const needle = normaliseLabel(c.value);
  switch (c.op) {
    case 'contains': return !!needle && hay.includes(needle);
    case 'notContains': return !needle || !hay.includes(needle);
    case 'equals': return hay === needle;
    case 'startsWith': return !!needle && hay.startsWith(needle);
    case 'regex':
      try { return new RegExp(c.value, 'i').test(tx.label); }
      catch { return false; }
    default: return false;
  }
}

function matchDate(tx: Candidate, c: Condition): boolean {
  switch (c.op) {
    case 'between': return !!c.value && !!c.value2 && tx.date >= c.value && tx.date <= c.value2;
    case 'before': return !!c.value && tx.date < c.value;
    case 'after': return !!c.value && tx.date > c.value;
    default: return false;
  }
}

function matchDayOfMonth(tx: Candidate, c: Condition): boolean {
  const day = parseInt(tx.date.slice(8, 10), 10);
  const a = numeric(c.value);
  const b = numeric(c.value2);
  switch (c.op) {
    case 'equals': return a !== null && day === a;
    case 'between': return a !== null && b !== null && day >= Math.min(a, b) && day <= Math.max(a, b);
    case 'gt': return a !== null && day > a;
    case 'lt': return a !== null && day < a;
    default: return false;
  }
}

export function matchCondition(tx: Candidate, c: Condition): boolean {
  switch (c.field) {
    case 'label': return matchLabel(tx, c);
    case 'amount': return matchAmount(tx.amount, c);
    case 'sens': {
      const isExpense = tx.amount < 0;
      const wanted = c.value === 'depense';
      return c.op === 'isNot' ? isExpense !== wanted : isExpense === wanted;
    }
    case 'account': {
      const id = parseInt(c.value, 10);
      const same = tx.accountId === id;
      return c.op === 'isNot' ? !same : same;
    }
    case 'dayOfMonth': return matchDayOfMonth(tx, c);
    case 'date': return matchDate(tx, c);
    default: return false;
  }
}

/** A rule with no condition matches nothing: it would silently repaint everything. */
export function matchRule(tx: Candidate, rule: Rule): boolean {
  if (!rule.conditions.length) return false;
  return rule.matchMode === 'any'
    ? rule.conditions.some((c) => matchCondition(tx, c))
    : rule.conditions.every((c) => matchCondition(tx, c));
}

/** Translate a rule's actions into the changes it wants on this transaction. */
export function effectOf(rule: Rule): Effect {
  const effect: Effect = {};
  for (const a of rule.actions) {
    switch (a.kind) {
      case 'category': {
        const id = parseInt(a.value, 10);
        effect.categoryId = Number.isInteger(id) && id > 0 ? id : null;
        break;
      }
      case 'contract': {
        const id = parseInt(a.value, 10);
        effect.contractId = Number.isInteger(id) && id > 0 ? id : null;
        break;
      }
      case 'label': if (a.value.trim()) effect.label = a.value.trim(); break;
      case 'tag': if (a.value.trim()) (effect.tags ??= []).push(a.value.trim()); break;
      case 'transfer': effect.transfer = true; break;
    }
  }
  return effect;
}

/**
 * Run the ordered rules over one transaction and return what each matching rule
 * decided. Evaluation stops after a matching rule marked « stop ».
 */
export function evaluate(tx: Candidate, rules: Rule[]): Outcome[] {
  const out: Outcome[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!matchRule(tx, rule)) continue;
    out.push({ ruleId: rule.id, ruleName: rule.name, effect: effectOf(rule) });
    if (rule.stop) break;
  }
  return out;
}

export interface Change {
  categoryId?: number | null;
  contractId?: number | null;
  label?: string;
  transfer?: boolean;
  tags: string[];
  /** Rule that decided a stored field, recorded as the row's provenance. Zero
   *  when the change only adds tags, which owns nothing. */
  ruleId: number;
  /** Last matching rule, credited in the replay report. */
  reportId: number;
  ruleName: string;
}

/**
 * Merge the outcomes into the single change to apply. Later rules win on a
 * given field, which is what « ordonnancement » means in practice; tags
 * accumulate rather than replace.
 *
 * `respectManual` protects a category set by hand: replaying rules must not
 * undo a correction the user made deliberately. Passing false is the explicit
 * « tout réappliquer » of the interface.
 */
export function planChange(tx: Candidate, rules: Rule[], respectManual = true): Change | null {
  const outcomes = evaluate(tx, rules);
  if (!outcomes.length) return null;

  const manualCategory = respectManual && tx.categoryId !== null && tx.ruleId === null;
  const change: Change = { tags: [], ruleId: 0, reportId: 0, ruleName: '' };
  let touched = false;

  for (const o of outcomes) {
    // Provenance names the rule that decided a stored field. A rule that only
    // adds a tag stays out of it, so a category set by hand keeps its shield.
    let decides = false;
    if (o.effect.categoryId !== undefined && !manualCategory) { change.categoryId = o.effect.categoryId; decides = true; }
    if (o.effect.contractId !== undefined) { change.contractId = o.effect.contractId; decides = true; }
    if (o.effect.label !== undefined) { change.label = o.effect.label; decides = true; }
    if (o.effect.transfer) { change.transfer = true; decides = true; }
    if (o.effect.tags?.length) { change.tags.push(...o.effect.tags); touched = true; }
    if (decides) { change.ruleId = o.ruleId; touched = true; }
    if (decides || !change.ruleId) { change.reportId = o.ruleId; change.ruleName = o.ruleName; }
  }
  if (!touched) return null;

  change.tags = [...new Set(change.tags)];
  return change;
}

/**
 * Whether the row already carries what the change wants. This looks at values
 * only, never at provenance: a draft rule has no id yet, so the preview and the
 * replay must judge « would this alter anything » the same way.
 */
export function isNoop(tx: Candidate, change: Change, existingTags: string[]): boolean {
  if (change.categoryId !== undefined && change.categoryId !== tx.categoryId) return false;
  if (change.contractId !== undefined && change.contractId !== tx.contractId) return false;
  if (change.label !== undefined && change.label !== tx.label) return false;
  if (change.transfer && tx.kind !== 'virement') return false;
  return !change.tags.some((t) => !existingTags.includes(t));
}

/**
 * Whether the replay must still write, to record that another rule now decides
 * this row. A tag-only change (rule id zero) owns nothing and never restamps.
 */
export function keepsProvenance(tx: Candidate, change: Change): boolean {
  return !change.ruleId || change.ruleId === tx.ruleId;
}
