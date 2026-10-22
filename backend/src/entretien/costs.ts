// Ce que coûtent les gestes d'entretien, pour les adultes : le coût prévu de
// chaque geste (ou le contrat Finances qui le couvre), ce qu'a coûté chaque
// réalisation, et le total sur douze mois glissants face à la prévision.
//
// Une réalisation est notée par le moteur des tâches (history) ; son montant
// est inscrit ici **dans la même transaction** (onTaskCommit), au prix du
// moment : rouvrir le geste retire la ligne, un prix changé ensuite ne
// réécrit pas le passé.
import type { Database } from 'better-sqlite3';
import type { TaskItem } from '../tasks/ops';
import { parisDay } from '../tasks/ops';
import { occurrencesPerYear } from '../tasks/recurrence';
import { contractCosts, listContracts } from '../finances/contracts';
import { ENTRETIEN_LIST_ID } from './list';

let database: Database;
export function initCosts(db: Database): void { database = db; }

/** Au-delà, un montant saisi est une faute de frappe (centimes). */
export const AMOUNT_MAX = 10_000_000;

const isGeste = (t: TaskItem): boolean => t.listId === ENTRETIEN_LIST_ID && !t.parentId;
const addDays = (iso: string, n: number): string => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);

interface CostRow { task_id: string; amount: number | null; contract_id: number | null; }

/** Le coût d'un geste : un montant par réalisation, ou un contrat, ou rien (null efface). */
export function setCost(taskId: string, input: { amount: number | null; contractId: number | null }, by: string | null): void {
  if (input.amount === null && input.contractId === null) { database.prepare('DELETE FROM ent_costs WHERE task_id = ?').run(taskId); return; }
  database.prepare(`
    INSERT INTO ent_costs (task_id, amount, contract_id, updated_by, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(task_id) DO UPDATE SET amount = excluded.amount, contract_id = excluded.contract_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(taskId, input.contractId === null ? input.amount : null, input.contractId, by);
}

/**
 * Branché sur le moteur des tâches (onTaskCommit), dans sa transaction : les
 * réalisations apparues prennent le coût du geste à cet instant, les
 * réalisations retirées (geste rouvert) perdent le leur, un geste supprimé
 * emporte ses montants. Une réalisation sortie de l'historique parce qu'il est
 * plein (les plus anciennes) garde le sien : elle a bien eu lieu.
 */
export function recordSpend(before: TaskItem[], after: TaskItem[]): void {
  const prev = new Map(before.filter(isGeste).map((t) => [t.id, t]));
  const next = new Map(after.filter(isGeste).map((t) => [t.id, t]));
  if (!prev.size && !next.size) return;
  const cost = database.prepare('SELECT amount FROM ent_costs WHERE task_id = ? AND amount IS NOT NULL');
  const ins = database.prepare('INSERT OR IGNORE INTO ent_spend (task_id, done_at, day, amount) VALUES (?, ?, ?, ?)');
  const del = database.prepare('DELETE FROM ent_spend WHERE task_id = ? AND done_at = ?');
  for (const id of prev.keys()) {
    if (!next.has(id)) {
      database.prepare('DELETE FROM ent_spend WHERE task_id = ?').run(id);
      database.prepare('DELETE FROM ent_costs WHERE task_id = ?').run(id);
    }
  }
  for (const [id, t] of next) {
    const was = new Set((prev.get(id)?.history || []).map((h) => h.at));
    const now = t.history || [];
    if (now.length === was.size && now.every((h) => was.has(h.at))) continue;
    const isNow = new Set(now.map((h) => h.at));
    const oldest = now.length ? now[0].at : null;
    for (const at of was) if (!isNow.has(at) && (oldest === null || at > oldest)) del.run(id, at);
    const amount = (cost.get(id) as { amount: number } | undefined)?.amount;
    if (amount) for (const h of now) if (!was.has(h.at)) ins.run(id, h.at, parisDay(h.at), amount);
  }
}

export interface GesteCost {
  taskId: string;
  /** Coût par réalisation, centimes ; null quand un contrat le couvre ou qu'aucun coût n'est saisi. */
  amount: number | null;
  contractId: number | null;
  /** Passages par an, d'après la récurrence (saisons comprises). */
  perYear: number | null;
  /** Coût annuel prévu : montant × passages. */
  forecast: number | null;
  /** Ce qu'ont coûté ses réalisations sur douze mois glissants. */
  real12: number;
}
export interface ContractLine { id: number; name: string; provider: string; status: string; real12: number; }
export interface CostSummary {
  gestes: GesteCost[];
  /** Les contrats Finances, pour le choix « couvert par un contrat » ; vide quand Finances est éteint. */
  contracts: ContractLine[];
  totals: {
    /** Réalisations des douze derniers mois, plus le coût réel des contrats rattachés (chacun une fois). */
    real12: number;
    /** Prévision des gestes chiffrés, plus le coût réel des contrats rattachés (sur douze mois, faute de mieux). */
    forecast: number;
  };
}

/** Le bilan, calculé à la lecture. `finances` : le module Finances est-il allumé (sinon, pas de contrats). */
export function costSummary(tasks: TaskItem[], today: string, finances: boolean): CostSummary {
  const from = addDays(today, -365);
  const costs = new Map((database.prepare('SELECT task_id, amount, contract_id FROM ent_costs').all() as CostRow[]).map((r) => [r.task_id, r]));
  const real = new Map((database.prepare('SELECT task_id, SUM(amount) AS total FROM ent_spend WHERE day > ? AND day <= ? GROUP BY task_id').all(from, today) as { task_id: string; total: number }[]).map((r) => [r.task_id, r.total]));
  const contractReal = finances ? contractCosts(today) : new Map();
  const contracts: ContractLine[] = finances
    ? listContracts().map((c) => ({ id: c.id, name: c.name, provider: c.provider, status: c.status, real12: contractReal.get(c.id)?.total ?? 0 }))
    : [];
  const known = new Map(contracts.map((c) => [c.id, c]));
  const gestes: GesteCost[] = [];
  for (const t of tasks.filter((x) => isGeste(x) && !x.done)) {
    const c = costs.get(t.id);
    const r12 = real.get(t.id) ?? 0;
    if (!c && !r12) continue;
    const contractId = c?.contract_id ?? null;
    const amount = contractId === null ? c?.amount ?? null : null;
    const perYear = t.rec ? Math.round(occurrencesPerYear(t.rec, t.due || today) * 100) / 100 : null;
    gestes.push({ taskId: t.id, amount, contractId, perYear, forecast: amount !== null && perYear !== null ? Math.round(amount * perYear) : null, real12: r12 });
  }
  // Un geste archivé n'a plus de prévision, mais ce qu'il a coûté cette année compte.
  const archived = tasks.filter((x) => isGeste(x) && x.done).reduce((n, t) => n + (real.get(t.id) ?? 0), 0);
  const linked = [...new Set(gestes.map((g) => g.contractId).filter((id): id is number => id !== null && known.has(id)))];
  const contractsTotal = linked.reduce((n, id) => n + known.get(id)!.real12, 0);
  return {
    gestes, contracts,
    totals: {
      real12: gestes.reduce((n, g) => n + g.real12, 0) + archived + contractsTotal,
      forecast: gestes.reduce((n, g) => n + (g.forecast ?? 0), 0) + contractsTotal,
    },
  };
}

/** Le montant noté pour chaque réalisation, clé `<geste>@<instant>` (le carnet d'entretien). */
export function spendByRealisation(): Map<string, number> {
  const rows = database.prepare('SELECT task_id, done_at, amount FROM ent_spend').all() as { task_id: string; done_at: string; amount: number }[];
  return new Map(rows.map((r) => [`${r.task_id}@${r.done_at}`, r.amount]));
}
