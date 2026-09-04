// Relevés de compteur et consommation.
//
// Le module ne cherche pas à facturer : le fournisseur le fait déjà, et mieux.
// Il répond à une seule question, celle qu'aucune facture ne répond :
// « est-ce que je consomme plus qu'avant, et depuis quand ? »
//
// D'où le parti pris : tout est ramené à une **consommation par jour**. C'est la
// seule grandeur comparable entre deux relevés espacés de trois semaines et deux
// relevés espacés de deux mois, et la seule qui rende une dérive visible.
import type { Database } from 'better-sqlite3';

let database: Database;
export function initEnergy(db: Database): void { database = db; }

export interface ReadingInput {
  contractId: number;
  date: string;
  /** Compteur simple, ou total quand le compteur distingue les heures. */
  indexTotal: number | null;
  indexHp: number | null;
  indexHc: number | null;
  /** Consommation lue directement sur une facture, quand l'index est inconnu. */
  kwh: number | null;
  kwhHp: number | null;
  kwhHc: number | null;
  /** Montant de la période, en centimes. */
  cost: number | null;
  notes: string;
}

export interface Reading extends ReadingInput { id: number; }

interface Row {
  id: number; contract_id: number; date: string;
  index_total: number | null; index_hp: number | null; index_hc: number | null;
  kwh: number | null; kwh_hp: number | null; kwh_hc: number | null;
  cost: number | null; notes: string;
}

const toReading = (r: Row): Reading => ({
  id: r.id, contractId: r.contract_id, date: r.date,
  indexTotal: r.index_total, indexHp: r.index_hp, indexHc: r.index_hc,
  kwh: r.kwh, kwhHp: r.kwh_hp, kwhHc: r.kwh_hc, cost: r.cost, notes: r.notes,
});

/**
 * Au-delà de ce délai, un relevé est attendu.
 *
 * Un mois, et non la périodicité de facturation du contrat : celle-ci dit quand
 * le fournisseur prélève, pas quand il est utile de lire le compteur. Sur un
 * contrat facturé une fois l'an, attendre un an entre deux relevés reviendrait à
 * découvrir la dérive quand il est trop tard pour agir, ce qui est exactement ce
 * que ce module existe pour éviter.
 */
export const READING_DUE_DAYS = 30;

/** Un compteur qu'il est temps de relire. */
export interface ReadingDue {
  contractId: number;
  name: string;
  provider: string;
  /** Date du dernier relevé, ou null quand le compteur n'a jamais été lu. */
  lastOn: string | null;
  /** Jours écoulés depuis. Null quand il n'y a aucun relevé. */
  daysSince: number | null;
}

/** Date du dernier relevé, par contrat. */
export function lastReadingDates(): Map<number, string> {
  return new Map((database.prepare(
    'SELECT contract_id AS id, MAX(date) AS last FROM fin_readings GROUP BY contract_id',
  ).all() as { id: number; last: string }[]).map((r) => [r.id, r.last]));
}

/**
 * Les compteurs dont le relevé est attendu, du plus ancien au plus récent.
 *
 * Fonction pure : les contrats et les dates lui sont donnés, ce qui la rend
 * vérifiable sans base de données. Un contrat résilié ne réclame rien.
 */
export function readingsDue(
  contracts: { id: number; name: string; provider: string; kind: string; status: string }[],
  last: Map<number, string>,
  today: string,
  dueDays = READING_DUE_DAYS,
): ReadingDue[] {
  const jours = (from: string): number =>
    Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000));
  return contracts
    .filter((c) => c.kind === 'energie' && c.status === 'actif')
    .map((c) => {
      const lastOn = last.get(c.id) ?? null;
      return { contractId: c.id, name: c.name, provider: c.provider, lastOn, daysSince: lastOn ? jours(lastOn) : null };
    })
    // Jamais relevé, ou relevé il y a trop longtemps. Un compteur posé hier
    // n'est pas en retard : il n'a simplement pas encore d'histoire.
    .filter((d) => d.daysSince === null || d.daysSince >= dueDays)
    .sort((a, b) => (b.daysSince ?? Number.MAX_SAFE_INTEGER) - (a.daysSince ?? Number.MAX_SAFE_INTEGER));
}

export function listReadings(contractId: number): Reading[] {
  return (database.prepare('SELECT * FROM fin_readings WHERE contract_id = ? ORDER BY date, id')
    .all(contractId) as Row[]).map(toReading);
}

export function getReading(id: number): Reading | null {
  const r = database.prepare('SELECT * FROM fin_readings WHERE id = ?').get(id) as Row | undefined;
  return r ? toReading(r) : null;
}

const values = (i: ReadingInput): unknown[] => [
  i.contractId, i.date, i.indexTotal, i.indexHp, i.indexHc, i.kwh, i.kwhHp, i.kwhHc, i.cost, i.notes,
];

export function createReading(input: ReadingInput): Reading {
  const info = database.prepare(`
    INSERT INTO fin_readings (contract_id, date, index_total, index_hp, index_hc, kwh, kwh_hp, kwh_hc, cost, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...values(input));
  return getReading(Number(info.lastInsertRowid))!;
}

export function updateReading(id: number, input: ReadingInput): Reading | null {
  const info = database.prepare(`
    UPDATE fin_readings SET contract_id = ?, date = ?, index_total = ?, index_hp = ?, index_hc = ?,
      kwh = ?, kwh_hp = ?, kwh_hc = ?, cost = ?, notes = ?
    WHERE id = ?
  `).run(...values(input), id);
  return info.changes ? getReading(id) : null;
}

export function deleteReading(id: number): void {
  database.prepare('DELETE FROM fin_readings WHERE id = ?').run(id);
}

// ---- consommation ---------------------------------------------------------
/** Why a period could not be measured. Saying it beats showing a wrong figure. */
export type GapReason = 'premier' | 'index-recule' | 'meme-jour' | 'inconnu';

export interface Period {
  /** Reading that closes the period. */
  readingId: number;
  from: string;
  to: string;
  days: number;
  /** Consumption over the period, or null when it cannot be established. */
  kwh: number | null;
  kwhHp: number | null;
  kwhHc: number | null;
  kwhPerDay: number | null;
  cost: number | null;
  /** Cents per kWh, only when both are known. */
  costPerKwh: number | null;
  /** Same calendar span a year earlier, when the history reaches that far. */
  lastYearKwhPerDay: number | null;
  /** Set when the period holds no usable consumption. */
  gap: GapReason | null;
}

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

const shiftYear = (iso: string, years: number): string => {
  const [y, m, d] = iso.split('-');
  return `${Number(y) + years}-${m}-${d}`;
};

/** Consumption between two readings: an explicit kWh wins, an index difference otherwise. */
function consumedBetween(previous: Reading, current: Reading): { total: number | null; hp: number | null; hc: number | null; gap: GapReason | null } {
  // A bill states its consumption outright: no arithmetic to get wrong.
  if (current.kwh !== null) return { total: current.kwh, hp: current.kwhHp, hc: current.kwhHc, gap: null };

  const diff = (a: number | null, b: number | null): number | null =>
    a !== null && b !== null ? a - b : null;
  const total = diff(current.indexTotal, previous.indexTotal);
  const hp = diff(current.indexHp, previous.indexHp);
  const hc = diff(current.indexHc, previous.indexHc);

  // A meter that goes backwards means it was replaced or reset. Reporting the
  // negative figure as a consumption would be worse than reporting nothing.
  const negative = [total, hp, hc].some((v) => v !== null && v < 0);
  if (negative) return { total: null, hp: null, hc: null, gap: 'index-recule' };

  if (total !== null) return { total, hp, hc, gap: null };
  // Split meter without a total: the two halves add up.
  if (hp !== null && hc !== null) return { total: hp + hc, hp, hc, gap: null };
  return { total: null, hp, hc, gap: 'inconnu' };
}

/**
 * Every period of a contract, oldest first. The first reading opens the history
 * without measuring anything: there is nothing before it to subtract.
 */
export function periods(contractId: number): Period[] {
  const readings = listReadings(contractId);
  const out: Period[] = [];

  for (let i = 0; i < readings.length; i++) {
    const current = readings[i];
    const previous = readings[i - 1];
    if (!previous) {
      out.push({
        readingId: current.id, from: current.date, to: current.date, days: 0,
        kwh: null, kwhHp: null, kwhHc: null, kwhPerDay: null,
        cost: current.cost, costPerKwh: null, lastYearKwhPerDay: null, gap: 'premier',
      });
      continue;
    }

    const days = daysBetween(previous.date, current.date);
    const { total, hp, hc, gap } = consumedBetween(previous, current);
    const kwhPerDay = total !== null && days > 0 ? total / days : null;
    out.push({
      readingId: current.id, from: previous.date, to: current.date, days,
      kwh: total, kwhHp: hp, kwhHc: hc, kwhPerDay,
      cost: current.cost,
      costPerKwh: current.cost !== null && total !== null && total > 0 ? current.cost / total : null,
      lastYearKwhPerDay: null,
      gap: days <= 0 ? 'meme-jour' : gap,
    });
  }

  // Second pass: each period looks for what the same calendar window consumed a
  // year earlier. Comparing to the period just before would compare January to
  // April, which says nothing about a household that heats in winter.
  for (const p of out) {
    if (p.kwhPerDay === null) continue;
    p.lastYearKwhPerDay = rateAround(out, shiftYear(p.to, -1));
  }
  return out;
}

/**
 * Daily rate in force on a given day, taken from the period that contains it.
 * Null when the history does not reach that far.
 */
function rateAround(all: Period[], day: string): number | null {
  const hit = all.find((p) => p.kwhPerDay !== null && p.from <= day && day <= p.to);
  return hit ? hit.kwhPerDay : null;
}

export interface EnergySummary {
  contractId: number;
  readings: number;
  /** Most recent measured period. */
  latest: Period | null;
  /** Rolling consumption over the last 365 days, when covered. */
  yearKwh: number | null;
  yearCost: number | null;
  /** Percentage change of the latest daily rate against a year earlier. */
  trend: number | null;
}

export function summary(contractId: number): EnergySummary {
  const all = periods(contractId);
  const measured = all.filter((p) => p.kwhPerDay !== null);
  const latest = measured.length ? measured[measured.length - 1] : null;

  const from = shiftYear(latest?.to ?? new Date().toISOString().slice(0, 10), -1);
  const inYear = measured.filter((p) => p.from >= from);
  const yearKwh = inYear.length ? inYear.reduce((a, p) => a + (p.kwh || 0), 0) : null;
  const costs = inYear.filter((p) => p.cost !== null);
  const yearCost = costs.length ? costs.reduce((a, p) => a + (p.cost || 0), 0) : null;

  const trend = latest && latest.lastYearKwhPerDay
    ? ((latest.kwhPerDay as number) - latest.lastYearKwhPerDay) / latest.lastYearKwhPerDay * 100
    : null;

  return { contractId, readings: all.length, latest, yearKwh, yearCost, trend };
}
