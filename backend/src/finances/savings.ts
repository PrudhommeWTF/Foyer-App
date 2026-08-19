// Pistes d'économies.
//
// Une piste n'est ni une opération ni un contrat : c'est une **intention**, avec
// un gain annuel estimé. « Renégocier l'assurance habitation, 240 € par an. »
//
// Le module ne prétend pas mesurer l'économie réellement obtenue : seul le coût
// réel du contrat, une fois la piste appliquée, le dira. Il tient la liste, le
// cumul, et sépare ce qui est fait de ce qui reste à faire. C'est déjà ce qu'on
// oublie le plus.
import type { Database } from 'better-sqlite3';

let database: Database;
export function initSavings(db: Database): void { database = db; }

export type SavingStatus = 'idee' | 'en-cours' | 'faite' | 'abandonnee';
export const SAVING_STATUSES: SavingStatus[] = ['idee', 'en-cours', 'faite', 'abandonnee'];

export interface SavingInput {
  title: string;
  description: string;
  /** Gain annuel estimé, en centimes, toujours positif. */
  annualGain: number;
  contractId: number | null;
  assetId: number | null;
  status: SavingStatus;
  targetDate: string | null;
  /** Tâche créée depuis cette piste, dans le document du foyer. */
  taskId: string | null;
}

export interface Saving extends SavingInput { id: number; position: number; }

interface Row {
  id: number; title: string; description: string; annual_gain: number;
  contract_id: number | null; asset_id: number | null; status: SavingStatus;
  target_date: string | null; task_id: string | null; position: number;
}

const toSaving = (r: Row): Saving => ({
  id: r.id, title: r.title, description: r.description, annualGain: r.annual_gain,
  contractId: r.contract_id, assetId: r.asset_id, status: r.status,
  targetDate: r.target_date, taskId: r.task_id, position: r.position,
});

/** Ce qui reste à faire d'abord : une liste de pistes se lit pour agir. */
const ORDER = "CASE status WHEN 'en-cours' THEN 0 WHEN 'idee' THEN 1 WHEN 'faite' THEN 2 ELSE 3 END, annual_gain DESC, id";

export function listSavings(): Saving[] {
  return (database.prepare(`SELECT * FROM fin_savings ORDER BY ${ORDER}`).all() as Row[]).map(toSaving);
}

export function getSaving(id: number): Saving | null {
  const r = database.prepare('SELECT * FROM fin_savings WHERE id = ?').get(id) as Row | undefined;
  return r ? toSaving(r) : null;
}

const values = (i: SavingInput): unknown[] => [
  i.title, i.description, i.annualGain, i.contractId, i.assetId, i.status, i.targetDate, i.taskId,
];

export function createSaving(input: SavingInput): Saving {
  const pos = (database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM fin_savings').get() as { p: number }).p;
  const info = database.prepare(`
    INSERT INTO fin_savings (title, description, annual_gain, contract_id, asset_id, status, target_date, task_id, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...values(input), pos);
  return getSaving(Number(info.lastInsertRowid))!;
}

export function updateSaving(id: number, input: SavingInput): Saving | null {
  const info = database.prepare(`
    UPDATE fin_savings SET title = ?, description = ?, annual_gain = ?, contract_id = ?, asset_id = ?,
      status = ?, target_date = ?, task_id = ?
    WHERE id = ?
  `).run(...values(input), id);
  return info.changes ? getSaving(id) : null;
}

export function deleteSaving(id: number): void {
  database.prepare('DELETE FROM fin_savings WHERE id = ?').run(id);
}

/** Mémorise la tâche créée depuis une piste, pour ne pas la proposer deux fois. */
export function linkTask(id: number, taskId: string | null): Saving | null {
  database.prepare('UPDATE fin_savings SET task_id = ? WHERE id = ?').run(taskId, id);
  return getSaving(id);
}

export interface SavingsTotals {
  /** Gain annuel des pistes encore ouvertes. */
  pending: number;
  /** Gain annuel des pistes menées à bien. */
  done: number;
  count: number;
  openCount: number;
}

/**
 * Les pistes abandonnées ne comptent nulle part : les garder dans un total
 * gonflerait un chiffre que rien ne viendra jamais réaliser.
 */
export function totals(): SavingsTotals {
  const all = listSavings();
  const open = all.filter((s) => s.status === 'idee' || s.status === 'en-cours');
  return {
    pending: open.reduce((a, s) => a + s.annualGain, 0),
    done: all.filter((s) => s.status === 'faite').reduce((a, s) => a + s.annualGain, 0),
    count: all.length,
    openCount: open.length,
  };
}
