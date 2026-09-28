// Accès aux données du module « Employé à domicile ». Écritures granulaires
// (une présence = une ligne), pas d'opérations journalisées comme les courses :
// deux téléphones qui saisissent deux présences insèrent deux lignes, sans
// conflit. Le calcul du net d'un mois est isolé et pur (voir `netOfBucket` et
// `computeMonth`) pour être testable sans base.
import type { Database } from 'better-sqlite3';
import { initBackup } from './backup';

let database: Database;
export function initEmployesRepo(db: Database): void {
  database = db;
  initBackup(db);
}

// Les catégories d'emploi, calquées sur les activités déclarables au CESU. Le
// stockage est une chaîne libre (pas de contrainte SQL) : ajouter une catégorie
// ne demande aucune migration, et les employés existants gardent la leur.
export type EmpRole = 'menage' | 'garde' | 'soutien' | 'jardin' | 'bricolage' | 'repas' | 'seniors' | 'informatique' | 'autre';
export const EMP_ROLES: readonly EmpRole[] = ['menage', 'garde', 'soutien', 'jardin', 'bricolage', 'repas', 'seniors', 'informatique', 'autre'];
export type MonthStatus = 'ouvert' | 'declare' | 'paye' | 'sans-presence';
export const MONTH_STATUSES: readonly MonthStatus[] = ['ouvert', 'declare', 'paye', 'sans-presence'];
/** Un mois figé : ses présences ne se modifient plus, ses totaux ne se recalculent plus. */
export const isFrozen = (s: MonthStatus): boolean => s === 'declare' || s === 'paye';

export interface Employee { id: number; name: string; role: EmpRole; active: boolean; createdAt: string; archivedAt: string | null; }
export interface Rate { id: number; employeeId: number; netHourlyCents: number; effectiveFrom: string; createdAt: string; createdBy: string | null; }
export interface Shift { id: number; employeeId: number; day: string; minutes: number; note: string; createdAt: string; createdBy: string | null; createdVia: string | null; updatedAt: string | null; updatedBy: string | null; updatedVia: string | null; }
export interface MonthRow {
  employeeId: number; month: string; status: MonthStatus;
  declaredAt: string | null; declaredHoursMinutes: number | null; declaredNetCents: number | null;
  congesInclus: boolean | null; paidAt: string | null; urssafTotalCents: number | null;
  attachmentId: number | null; note: string;
}

const empRow = (r: Record<string, unknown>): Employee => ({
  id: r['id'] as number, name: r['name'] as string, role: r['role'] as EmpRole,
  active: !!r['active'], createdAt: r['created_at'] as string, archivedAt: (r['archived_at'] as string) ?? null,
});
const rateRow = (r: Record<string, unknown>): Rate => ({
  id: r['id'] as number, employeeId: r['employee_id'] as number, netHourlyCents: r['net_hourly_cents'] as number,
  effectiveFrom: r['effective_from'] as string, createdAt: r['created_at'] as string, createdBy: (r['created_by'] as string) ?? null,
});
const shiftRow = (r: Record<string, unknown>): Shift => ({
  id: r['id'] as number, employeeId: r['employee_id'] as number, day: r['day'] as string, minutes: r['minutes'] as number,
  note: (r['note'] as string) ?? '', createdAt: r['created_at'] as string, createdBy: (r['created_by'] as string) ?? null,
  createdVia: (r['created_via'] as string) ?? null,
  updatedAt: (r['updated_at'] as string) ?? null, updatedBy: (r['updated_by'] as string) ?? null, updatedVia: (r['updated_via'] as string) ?? null,
});
const monthRowOf = (r: Record<string, unknown>): MonthRow => ({
  employeeId: r['employee_id'] as number, month: r['month'] as string, status: r['status'] as MonthStatus,
  declaredAt: (r['declared_at'] as string) ?? null, declaredHoursMinutes: (r['declared_hours_minutes'] as number) ?? null,
  declaredNetCents: (r['declared_net_cents'] as number) ?? null, congesInclus: r['conges_inclus'] == null ? null : !!r['conges_inclus'],
  paidAt: (r['paid_at'] as string) ?? null, urssafTotalCents: (r['urssaf_total_cents'] as number) ?? null,
  attachmentId: (r['attachment_id'] as number) ?? null, note: (r['note'] as string) ?? '',
});

// ---- Employés -------------------------------------------------------------

export function listEmployees(includeArchived = false): Employee[] {
  const sql = 'SELECT * FROM emp_employees' + (includeArchived ? '' : ' WHERE archived_at IS NULL') + ' ORDER BY id';
  return (database.prepare(sql).all() as Record<string, unknown>[]).map(empRow);
}
export function getEmployee(id: number): Employee | null {
  const r = database.prepare('SELECT * FROM emp_employees WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? empRow(r) : null;
}
/** L'employé « ménage » actif, sinon le premier employé actif : le défaut quand l'appelant n'en précise aucun. */
export function primaryEmployee(): Employee | null {
  const active = listEmployees(false);
  return active.find((e) => e.role === 'menage') || active[0] || null;
}
export function createEmployee(name: string, role: EmpRole): Employee {
  const info = database.prepare('INSERT INTO emp_employees (name, role) VALUES (?, ?)').run(name, role);
  return getEmployee(Number(info.lastInsertRowid))!;
}
export function editEmployee(id: number, patch: { name?: string; role?: EmpRole; active?: boolean }): Employee | null {
  const e = getEmployee(id); if (!e) return null;
  database.prepare('UPDATE emp_employees SET name = ?, role = ?, active = ? WHERE id = ?')
    .run(patch.name ?? e.name, patch.role ?? e.role, (patch.active ?? e.active) ? 1 : 0, id);
  return getEmployee(id);
}
export function archiveEmployee(id: number): boolean {
  const info = database.prepare("UPDATE emp_employees SET archived_at = datetime('now'), active = 0 WHERE id = ? AND archived_at IS NULL").run(id);
  return info.changes > 0;
}

// ---- Taux -----------------------------------------------------------------

export function addRate(employeeId: number, netHourlyCents: number, effectiveFrom: string, by: string | null): Rate {
  const info = database.prepare('INSERT INTO emp_rates (employee_id, net_hourly_cents, effective_from, created_by) VALUES (?, ?, ?, ?)')
    .run(employeeId, netHourlyCents, effectiveFrom, by);
  return rateRow(database.prepare('SELECT * FROM emp_rates WHERE id = ?').get(Number(info.lastInsertRowid)) as Record<string, unknown>);
}
export function ratesOf(employeeId: number): Rate[] {
  return (database.prepare('SELECT * FROM emp_rates WHERE employee_id = ? ORDER BY effective_from DESC, id DESC').all(employeeId) as Record<string, unknown>[]).map(rateRow);
}
/** Le taux en vigueur un jour donné : la ligne la plus récente dont la date d'effet est &le; ce jour. */
export function rateOn(employeeId: number, day: string): Rate | null {
  const r = database.prepare('SELECT * FROM emp_rates WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1')
    .get(employeeId, day) as Record<string, unknown> | undefined;
  return r ? rateRow(r) : null;
}
/** Le taux courant : celui en vigueur aujourd'hui, sinon le plus récent connu. */
export function currentRate(employeeId: number, today: string): Rate | null {
  return rateOn(employeeId, today) || (ratesOf(employeeId)[0] ?? null);
}

// ---- Présences ------------------------------------------------------------

/** La présence non archivée d'un jour, s'il en existe une (détection de doublon). */
export function shiftOn(employeeId: number, day: string): Shift | null {
  const r = database.prepare('SELECT * FROM emp_shifts WHERE employee_id = ? AND day = ? AND archived_at IS NULL ORDER BY id LIMIT 1')
    .get(employeeId, day) as Record<string, unknown> | undefined;
  return r ? shiftRow(r) : null;
}
export function getShift(id: number): Shift | null {
  const r = database.prepare('SELECT * FROM emp_shifts WHERE id = ? AND archived_at IS NULL').get(id) as Record<string, unknown> | undefined;
  return r ? shiftRow(r) : null;
}
export function addShift(employeeId: number, day: string, minutes: number, note: string, by: string | null, via: string | null = null): Shift {
  const info = database.prepare('INSERT INTO emp_shifts (employee_id, day, minutes, note, created_by, created_via) VALUES (?, ?, ?, ?, ?, ?)')
    .run(employeeId, day, minutes, note, by, via);
  return getShift(Number(info.lastInsertRowid))!;
}
export function editShift(id: number, patch: { day?: string; minutes?: number; note?: string }, by: string | null, via: string | null = null): Shift | null {
  const s = getShift(id); if (!s) return null;
  database.prepare("UPDATE emp_shifts SET day = ?, minutes = ?, note = ?, updated_at = datetime('now'), updated_by = ?, updated_via = ? WHERE id = ?")
    .run(patch.day ?? s.day, patch.minutes ?? s.minutes, patch.note ?? s.note, by, via, id);
  return getShift(id);
}
export function archiveShift(id: number, by: string | null): boolean {
  const info = database.prepare("UPDATE emp_shifts SET archived_at = datetime('now'), updated_by = ? WHERE id = ? AND archived_at IS NULL").run(by, id);
  return info.changes > 0;
}
export function shiftsOfMonth(employeeId: number, month: string): Shift[] {
  return (database.prepare('SELECT * FROM emp_shifts WHERE employee_id = ? AND day LIKE ? AND archived_at IS NULL ORDER BY day, id')
    .all(employeeId, month + '-%') as Record<string, unknown>[]).map(shiftRow);
}
export function shiftsBetween(employeeId: number, from: string, to: string): Shift[] {
  return (database.prepare('SELECT * FROM emp_shifts WHERE employee_id = ? AND day >= ? AND day <= ? AND archived_at IS NULL ORDER BY day DESC, id DESC')
    .all(employeeId, from, to) as Record<string, unknown>[]).map(shiftRow);
}
/**
 * Les mois qui ont au moins une présence et restent à déclarer (statut « ouvert »,
 * ou pas encore de ligne de mois). Sert au repère d'agenda et au rappel : un mois
 * déclaré, payé ou marqué sans présence n'y figure pas.
 */
export function openMonthsWithPresence(employeeId: number): string[] {
  return (database.prepare(
    `SELECT DISTINCT substr(s.day, 1, 7) AS month
     FROM emp_shifts s
     LEFT JOIN emp_months m ON m.employee_id = s.employee_id AND m.month = substr(s.day, 1, 7)
     WHERE s.employee_id = ? AND s.archived_at IS NULL AND (m.status IS NULL OR m.status = 'ouvert')
     ORDER BY month`,
  ).all(employeeId) as { month: string }[]).map((r) => r.month);
}

// ---- Mois : état et calcul ------------------------------------------------

export function monthRow(employeeId: number, month: string): MonthRow {
  const r = database.prepare('SELECT * FROM emp_months WHERE employee_id = ? AND month = ?').get(employeeId, month) as Record<string, unknown> | undefined;
  return r ? monthRowOf(r) : { employeeId, month, status: 'ouvert', declaredAt: null, declaredHoursMinutes: null, declaredNetCents: null, congesInclus: null, paidAt: null, urssafTotalCents: null, attachmentId: null, note: '' };
}
export function monthStatus(employeeId: number, month: string): MonthStatus {
  return monthRow(employeeId, month).status;
}

/** Net d'un lot d'heures à un taux : heures décimales &times; taux, arrondi au centime. Pur. */
export function netOfBucket(minutes: number, netHourlyCents: number): number {
  return Math.round((minutes / 60) * netHourlyCents);
}

export interface RateBucket { netHourlyCents: number | null; minutes: number; netCents: number | null; }
export interface MonthRecap {
  employeeId: number; month: string; status: MonthStatus; frozen: boolean;
  minutes: number; netCents: number | null;
  /** Sous-totaux par taux applicable (le récapitulatif les montre quand le taux a changé en cours de mois). Un taux `null` marque des heures sans taux connu. */
  buckets: RateBucket[];
  declaredAt: string | null; paidAt: string | null; urssafTotalCents: number | null;
  shifts: Shift[];
}

/**
 * Le récapitulatif d'un mois. Un mois figé (declare/paye) rend ses totaux
 * **stockés** (jamais recalculés) ; un mois ouvert les calcule à partir des
 * présences, chaque présence valorisée au taux en vigueur **le jour** où elle a
 * eu lieu. Des heures sans taux connu laissent le net à `null` (jamais un faux 0).
 */
export function computeMonth(employeeId: number, month: string): MonthRecap {
  const row = monthRow(employeeId, month);
  const shifts = shiftsOfMonth(employeeId, month);
  const byRate = new Map<number | null, number>();
  for (const s of shifts) {
    const rate = rateOn(employeeId, s.day);
    const key = rate ? rate.netHourlyCents : null;
    byRate.set(key, (byRate.get(key) ?? 0) + s.minutes);
  }
  const buckets: RateBucket[] = [...byRate.entries()]
    .map(([cents, minutes]) => ({ netHourlyCents: cents, minutes, netCents: cents == null ? null : netOfBucket(minutes, cents) }))
    .sort((a, b) => (a.netHourlyCents ?? -1) - (b.netHourlyCents ?? -1));
  const liveMinutes = shifts.reduce((n, s) => n + s.minutes, 0);
  const liveNet = buckets.some((b) => b.netHourlyCents == null) ? null : buckets.reduce((n, b) => n + (b.netCents ?? 0), 0);
  const frozen = isFrozen(row.status);
  return {
    employeeId, month, status: row.status, frozen,
    minutes: frozen ? (row.declaredHoursMinutes ?? liveMinutes) : liveMinutes,
    netCents: frozen ? row.declaredNetCents : liveNet,
    buckets,
    declaredAt: row.declaredAt, paidAt: row.paidAt, urssafTotalCents: row.urssafTotalCents,
    shifts,
  };
}

function upsertMonth(employeeId: number, month: string, fields: Partial<Record<string, unknown>>): void {
  const existing = database.prepare('SELECT 1 FROM emp_months WHERE employee_id = ? AND month = ?').get(employeeId, month);
  if (!existing) database.prepare('INSERT INTO emp_months (employee_id, month) VALUES (?, ?)').run(employeeId, month);
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(', ');
  database.prepare(`UPDATE emp_months SET ${set}, updated_at = datetime('now') WHERE employee_id = ? AND month = ?`)
    .run(...keys.map((k) => fields[k] ?? null), employeeId, month);
}

export class MonthError extends Error {}

/** Fige le mois : ses totaux du moment sont stockés et ne seront plus recalculés. */
export function declareMonth(employeeId: number, month: string, date: string, congesInclus: boolean, note: string, by: string | null): MonthRecap {
  const row = monthRow(employeeId, month);
  if (isFrozen(row.status)) throw new MonthError(`Le mois ${month} est déjà ${row.status === 'paye' ? 'payé' : 'déclaré'} : rouvrez-le d'abord pour le redéclarer.`);
  const recap = computeMonth(employeeId, month);
  if (recap.netCents == null) throw new MonthError('Certaines présences n’ont pas de taux applicable : réglez le taux (avec sa date d’effet) avant de déclarer.');
  upsertMonth(employeeId, month, {
    status: 'declare', declared_at: date, declared_hours_minutes: recap.minutes, declared_net_cents: recap.netCents,
    conges_inclus: congesInclus ? 1 : 0, note, updated_by: by,
  });
  return computeMonth(employeeId, month);
}
export function payMonth(employeeId: number, month: string, date: string, urssafTotalCents: number | null, by: string | null): MonthRecap {
  const row = monthRow(employeeId, month);
  if (row.status !== 'declare') throw new MonthError(`Seul un mois déclaré peut être marqué payé (le mois ${month} est « ${row.status} »).`);
  upsertMonth(employeeId, month, { status: 'paye', paid_at: date, urssaf_total_cents: urssafTotalCents, updated_by: by });
  return computeMonth(employeeId, month);
}
export function reopenMonth(employeeId: number, month: string, by: string | null): MonthRecap {
  const row = monthRow(employeeId, month);
  if (row.status === 'ouvert') return computeMonth(employeeId, month);
  upsertMonth(employeeId, month, {
    status: 'ouvert', declared_at: null, declared_hours_minutes: null, declared_net_cents: null,
    conges_inclus: null, paid_at: null, urssaf_total_cents: null, updated_by: by,
  });
  return computeMonth(employeeId, month);
}
/** Marque un mois « sans présence » pour faire taire le rappel (aucune venue ce mois-là). */
export function markNoPresence(employeeId: number, month: string, by: string | null): MonthRecap {
  const row = monthRow(employeeId, month);
  if (isFrozen(row.status)) throw new MonthError(`Le mois ${month} est figé.`);
  if (shiftsOfMonth(employeeId, month).length) throw new MonthError(`Le mois ${month} porte des présences : il se déclare, il ne se marque pas « sans présence ».`);
  upsertMonth(employeeId, month, { status: 'sans-presence', updated_by: by });
  return computeMonth(employeeId, month);
}
