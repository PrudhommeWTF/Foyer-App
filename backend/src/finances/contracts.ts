// Biens, contrats et échéances.
//
// Un contrat n'est pas une opération : c'est ce qui les explique. Le module sert
// deux besoins concrets. Ne pas rater une date limite de résiliation, parce
// qu'un contrat tacitement reconduit coûte une année de plus. Et savoir ce
// qu'un contrat coûte **réellement**, en confrontant le montant annoncé aux
// opérations qui lui sont rattachées.
//
// Aucune table nouvelle : celles-ci ont été posées par la migration 1.
import type { Database } from 'better-sqlite3';
import { removeAllFor } from './attachments';

let database: Database;
export function initContracts(db: Database): void { database = db; }

// ---- biens ----------------------------------------------------------------
export type AssetKind = 'immobilier' | 'vehicule' | 'autre';
export type AssetStatus = 'actif' | 'vendu';

export interface AssetInput {
  name: string; kind: AssetKind; status: AssetStatus; address: string;
  acquiredOn: string | null; soldOn: string | null; notes: string;
}
export interface Asset extends AssetInput { id: number; position: number; contracts: number; }

interface AssetRow {
  id: number; name: string; kind: AssetKind; status: AssetStatus; address: string;
  acquired_on: string | null; sold_on: string | null; notes: string; position: number; contracts: number;
}

const toAsset = (r: AssetRow): Asset => ({
  id: r.id, name: r.name, kind: r.kind, status: r.status, address: r.address,
  acquiredOn: r.acquired_on, soldOn: r.sold_on, notes: r.notes, position: r.position,
  contracts: r.contracts,
});

export function listAssets(): Asset[] {
  return (database.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM fin_contracts c WHERE c.asset_id = a.id) AS contracts
    FROM fin_assets a ORDER BY a.position, a.id
  `).all() as AssetRow[]).map(toAsset);
}

export function getAsset(id: number): Asset | null {
  return listAssets().find((a) => a.id === id) ?? null;
}

export function createAsset(input: AssetInput): Asset {
  const pos = (database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM fin_assets').get() as { p: number }).p;
  const info = database.prepare(`
    INSERT INTO fin_assets (name, kind, status, address, acquired_on, sold_on, notes, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.name, input.kind, input.status, input.address, input.acquiredOn, input.soldOn, input.notes, pos);
  return getAsset(Number(info.lastInsertRowid))!;
}

export function updateAsset(id: number, input: AssetInput): Asset | null {
  const info = database.prepare(`
    UPDATE fin_assets SET name = ?, kind = ?, status = ?, address = ?, acquired_on = ?, sold_on = ?, notes = ?
    WHERE id = ?
  `).run(input.name, input.kind, input.status, input.address, input.acquiredOn, input.soldOn, input.notes, id);
  return info.changes ? getAsset(id) : null;
}

/**
 * Deleting an asset releases its contracts rather than taking them down with it.
 * Its own pieces do go, though: kept, they would be rows nothing can reach.
 */
export function deleteAsset(id: number): number {
  const pieces = removeAllFor('asset', id);
  database.prepare('DELETE FROM fin_assets WHERE id = ?').run(id);
  return pieces;
}

// ---- contrats -------------------------------------------------------------
export type ContractKind = 'assurance' | 'energie' | 'telecom' | 'abonnement' | 'credit' | 'sante' | 'autre';
export type Periodicity = 'mensuelle' | 'trimestrielle' | 'semestrielle' | 'annuelle' | 'ponctuelle';
export type ContractStatus = 'actif' | 'resilie';

export interface ContractRef { key: string; value: string; }

export interface ContractInput {
  name: string; provider: string; kind: ContractKind;
  assetId: number | null; accountId: number | null; categoryId: number | null; memberId: string | null;
  /** Expected amount range, in cents, always positive. */
  amountMin: number | null; amountMax: number | null;
  periodicity: Periodicity;
  /** Anniversary of the tacit renewal. */
  renewalOn: string | null;
  noticeDays: number;
  endsOn: string | null;
  status: ContractStatus;
  notes: string;
  /** Policy number, client reference, meter number… */
  refs: ContractRef[];
}

export interface Contract extends ContractInput { id: number; }

interface ContractRow {
  id: number; name: string; provider: string; kind: ContractKind;
  asset_id: number | null; account_id: number | null; category_id: number | null; member_id: string | null;
  amount_min: number | null; amount_max: number | null; periodicity: Periodicity;
  renewal_on: string | null; notice_days: number; ends_on: string | null;
  status: ContractStatus; notes: string;
}

function refsOf(contractId: number): ContractRef[] {
  return database.prepare('SELECT key, value FROM fin_contract_refs WHERE contract_id = ? ORDER BY position, id')
    .all(contractId) as ContractRef[];
}

const toContract = (r: ContractRow): Contract => ({
  id: r.id, name: r.name, provider: r.provider, kind: r.kind,
  assetId: r.asset_id, accountId: r.account_id, categoryId: r.category_id, memberId: r.member_id,
  amountMin: r.amount_min, amountMax: r.amount_max, periodicity: r.periodicity,
  renewalOn: r.renewal_on, noticeDays: r.notice_days, endsOn: r.ends_on,
  status: r.status, notes: r.notes, refs: refsOf(r.id),
});

export function listContracts(): Contract[] {
  return (database.prepare('SELECT * FROM fin_contracts ORDER BY status, name').all() as ContractRow[]).map(toContract);
}

export function getContract(id: number): Contract | null {
  const r = database.prepare('SELECT * FROM fin_contracts WHERE id = ?').get(id) as ContractRow | undefined;
  return r ? toContract(r) : null;
}

function writeRefs(contractId: number, refs: ContractRef[]): void {
  database.prepare('DELETE FROM fin_contract_refs WHERE contract_id = ?').run(contractId);
  const stmt = database.prepare('INSERT INTO fin_contract_refs (contract_id, key, value, position) VALUES (?, ?, ?, ?)');
  refs.forEach((r, i) => stmt.run(contractId, r.key, r.value, i));
}

const contractValues = (i: ContractInput): unknown[] => [
  i.name, i.provider, i.kind, i.assetId, i.accountId, i.categoryId, i.memberId,
  i.amountMin, i.amountMax, i.periodicity, i.renewalOn, i.noticeDays, i.endsOn, i.status, i.notes,
];

export function createContract(input: ContractInput): Contract {
  return database.transaction(() => {
    const info = database.prepare(`
      INSERT INTO fin_contracts
        (name, provider, kind, asset_id, account_id, category_id, member_id,
         amount_min, amount_max, periodicity, renewal_on, notice_days, ends_on, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...contractValues(input));
    const id = Number(info.lastInsertRowid);
    writeRefs(id, input.refs);
    return getContract(id)!;
  })();
}

export function updateContract(id: number, input: ContractInput): Contract | null {
  return database.transaction(() => {
    const info = database.prepare(`
      UPDATE fin_contracts SET
        name = ?, provider = ?, kind = ?, asset_id = ?, account_id = ?, category_id = ?, member_id = ?,
        amount_min = ?, amount_max = ?, periodicity = ?, renewal_on = ?, notice_days = ?, ends_on = ?,
        status = ?, notes = ?
      WHERE id = ?
    `).run(...contractValues(input), id);
    if (!info.changes) return null;
    writeRefs(id, input.refs);
    return getContract(id);
  })();
}

/**
 * Deleting a contract detaches its operations rather than deleting them: the
 * money was spent, only the explanation goes away.
 */
export function deleteContract(id: number): number {
  // The pieces go outside the transaction because they touch the disk, which no
  // rollback would undo. They are removed first: a failure then leaves a
  // contract without its scans, which is recoverable, rather than rows pointing
  // at a contract that no longer exists, which is not.
  const pieces = removeAllFor('contract', id);
  database.transaction(() => {
    database.prepare('UPDATE fin_transactions SET contract_id = NULL WHERE contract_id = ?').run(id);
    database.prepare('DELETE FROM fin_contracts WHERE id = ?').run(id);
  })();
  return pieces;
}

export function countAttachmentsForContract(id: number): number {
  return (database.prepare("SELECT COUNT(*) AS n FROM fin_attachments WHERE owner_kind = 'contract' AND owner_id = ?").get(id) as { n: number }).n;
}

export function countTransactionsForContract(id: number): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM fin_transactions WHERE contract_id = ?').get(id) as { n: number }).n;
}

// ---- échéances ------------------------------------------------------------
export type DeadlineKind = 'preavis' | 'renouvellement' | 'fin';

export interface Deadline {
  contractId: number;
  contractName: string;
  provider: string;
  kind: DeadlineKind;
  date: string;
  /** Days from today; negative when already past. */
  daysAway: number;
  assetId: number | null;
  memberId: string | null;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

/**
 * Next occurrence of a yearly anniversary, on or after `from`. A renewal date
 * set three years ago is still the renewal date; it is simply due again.
 */
export function nextAnniversary(date: string, from: string): string {
  if (date >= from) return date;
  const [, m, d] = date.split('-');
  let year = Number(from.slice(0, 4));
  // 29 February on a non-leap year lands on 1 March, which is what a bank does.
  const at = (y: number): string => {
    const candidate = `${y}-${m}-${d}`;
    const parsed = new Date(candidate + 'T00:00:00Z');
    return parsed.toISOString().slice(0, 10) === candidate ? candidate : `${y}-03-01`;
  };
  if (at(year) < from) year++;
  return at(year);
}

/**
 * Deadlines derived from the contracts. Nothing is stored: a renewal date that
 * changes changes its deadlines, with no stale copy left behind.
 *
 * Only the notice deadline really costs money, which is why it exists at all:
 * a tacitly renewed contract missed by one day costs a full extra period.
 */
export function deadlines(today = new Date().toISOString().slice(0, 10), horizonDays = 180): Deadline[] {
  const horizon = addDays(today, horizonDays);
  const out: Deadline[] = [];

  for (const c of listContracts()) {
    if (c.status !== 'actif') continue;
    const base = { contractId: c.id, contractName: c.name, provider: c.provider, assetId: c.assetId, memberId: c.memberId };

    if (c.renewalOn) {
      const renewal = nextAnniversary(c.renewalOn, today);
      if (c.noticeDays > 0) {
        const notice = addDays(renewal, -c.noticeDays);
        // A notice window already closed is still worth showing until the renewal
        // itself passes: it explains why nothing can be done this year.
        if (notice <= horizon) out.push({ ...base, kind: 'preavis', date: notice, daysAway: daysBetween(today, notice) });
      }
      if (renewal <= horizon) out.push({ ...base, kind: 'renouvellement', date: renewal, daysAway: daysBetween(today, renewal) });
    }

    if (c.endsOn && c.endsOn >= today && c.endsOn <= horizon) {
      out.push({ ...base, kind: 'fin', date: c.endsOn, daysAway: daysBetween(today, c.endsOn) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.contractName.localeCompare(b.contractName));
}

// ---- coût réel ------------------------------------------------------------
export interface ContractCost {
  contractId: number;
  /** Operations attached to the contract over the window. */
  count: number;
  /** Total spent, positive cents. */
  total: number;
  /** Last operation, the one the range is judged against. */
  lastDate: string | null;
  lastAmount: number | null;
  /** True when the last amount falls outside the declared range. */
  offRange: boolean;
}

/**
 * What each contract actually cost over the last twelve months. This is the
 * point of attaching operations: « ton assurance annonce 75 €, elle en prélève
 * 81,69 » is a fact the transaction list alone never surfaces.
 */
export function contractCosts(today = new Date().toISOString().slice(0, 10)): Map<number, ContractCost> {
  const from = addDays(today, -365);
  const rows = database.prepare(`
    SELECT contract_id AS contractId, COUNT(*) AS count, COALESCE(SUM(-amount), 0) AS total
    FROM fin_transactions
    WHERE contract_id IS NOT NULL AND date >= ? AND date <= ? AND amount < 0
    GROUP BY contract_id
  `).all(from, today) as { contractId: number; count: number; total: number }[];

  const last = database.prepare(`
    SELECT contract_id AS contractId, date, amount FROM fin_transactions t
    WHERE contract_id IS NOT NULL AND amount < 0
      AND date = (SELECT MAX(date) FROM fin_transactions x WHERE x.contract_id = t.contract_id AND x.amount < 0)
    GROUP BY contract_id
  `).all() as { contractId: number; date: string; amount: number }[];
  const lastBy = new Map(last.map((r) => [r.contractId, r]));

  const out = new Map<number, ContractCost>();
  const contracts = new Map(listContracts().map((c) => [c.id, c]));
  for (const r of rows) {
    const c = contracts.get(r.contractId);
    const l = lastBy.get(r.contractId);
    const amount = l ? Math.abs(l.amount) : null;
    const offRange = !!(c && amount !== null && (
      (c.amountMin !== null && amount < c.amountMin) || (c.amountMax !== null && amount > c.amountMax)
    ));
    out.set(r.contractId, {
      contractId: r.contractId, count: r.count, total: r.total,
      lastDate: l?.date ?? null, lastAmount: amount, offRange,
    });
  }
  return out;
}
