// Transferts entre enveloppes, et filtres de la liste des opérations.
//
// Un transfert déplace du budget pour un mois : il doit se voir partout où le
// budget du mois se lit (résumé, notifications, cumul de l'année), sinon une
// enveloppe renflouée resterait signalée « dépassée ».
import assert from 'node:assert/strict';
import fsp from 'node:fs';
import os from 'node:os';
import tmpPath from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';
import * as backup from '../src/finances/backup';
import * as imports from '../src/finances/import-repo';
import { dashboard } from '../src/finances/dashboard';
import { initBlobs } from '../src/storage/blobs';

const tmpDir = (): string => fsp.mkdtempSync(tmpPath.join(os.tmpdir(), 'foyer-test-'));

let db: Database.Database;
let joint: number;
let livret: number;

function reset(): void {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFinances(db);
  initBlobs(tmpDir());
  repo.initFinancesRepo(db);
  joint = repo.createAccount({ name: 'Compte joint', kind: 'courant', memberIds: [], openingBalance: 0, openingDate: null, archived: false }).id;
  livret = repo.createAccount({ name: 'Livret', kind: 'epargne', memberIds: [], openingBalance: 0, openingDate: null, archived: false }).id;
}

const cat = (name: string, budget: number): number =>
  repo.createCategory({ parentId: null, name, monthlyBudget: budget, color: '#000', icon: 'facture' }).id;

function tx(date: string, amount: number, over: Partial<Parameters<typeof repo.createTransaction>[0]> = {}): number {
  return repo.createTransaction({
    accountId: joint, date, amount, kind: amount < 0 ? 'depense' : 'recette',
    label: 'Op ' + date, categoryId: null, notes: '', cleared: false, ...over,
  }).id;
}

const budgetOf = (month: string, id: number): number =>
  repo.monthSummary(month, '2026-10-17').categories.find((c) => c.categoryId === id)!.budget;

beforeEach(reset);

describe('transferts entre enveloppes', () => {
  it('le budget du mois vaut référence + entrants − sortants, pour ce mois seulement', () => {
    const alim = cat('Courses', 90000);
    const achats = cat('Achats', 20000);
    repo.createBudgetMove('2026-10', alim, achats, 5000);
    assert.equal(budgetOf('2026-10', alim), 85000);
    assert.equal(budgetOf('2026-10', achats), 25000);
    assert.equal(budgetOf('2026-09', achats), 20000, 'le mois précédent ne bouge pas');
    assert.equal(repo.monthSummary('2026-10', '2026-10-17').budgetTotal, 110000, 'le total ne change pas');
    assert.deepEqual(repo.monthFlow('2026-10', '2026-10-17').moves.map((m) => [m.fromCategoryId, m.toCategoryId, m.amount]), [[alim, achats, 5000]]);
  });

  it('s’annule, et le cumul de l’année en tient compte', () => {
    const alim = cat('Courses', 90000);
    const achats = cat('Achats', 20000);
    tx('2026-10-05', -21000, { categoryId: achats });
    const m = repo.createBudgetMove('2026-10', alim, achats, 5000);
    const year = dashboard('2026-10', '2026-10-17').year.categories;
    assert.equal(year.find((c) => c.categoryId === achats)!.budget, 20000 * 10 + 5000);
    assert.equal(year.find((c) => c.categoryId === alim)!.budget, 90000 * 10 - 5000);
    assert.ok(repo.deleteBudgetMove(m.id));
    assert.equal(budgetOf('2026-10', achats), 20000);
    assert.equal(repo.deleteBudgetMove(m.id), false);
  });

  it('voyage dans la sauvegarde du module', () => {
    const alim = cat('Courses', 90000);
    const achats = cat('Achats', 20000);
    repo.createBudgetMove('2026-10', alim, achats, 5000);
    const dump = backup.exportModule();
    assert.equal((dump.tables['fin_budget_moves'] as unknown[]).length, 1);
    repo.deleteBudgetMove(repo.listBudgetMoves('2026-10')[0].id);
    backup.restoreModule(dump);
    assert.equal(repo.listBudgetMoves('2026-10').length, 1);
  });

  it('disparaît avec une de ses enveloppes', () => {
    const alim = cat('Courses', 90000);
    const achats = cat('Achats', 20000);
    repo.createBudgetMove('2026-10', alim, achats, 5000);
    repo.deleteCategory(achats);
    assert.deepEqual(repo.listBudgetMoves('2026-10'), []);
  });
});

describe('filtres des opérations', () => {
  it('« sans catégorie » ne garde que les dépenses', () => {
    tx('2026-10-01', 300000);
    tx('2026-10-02', -4000);
    tx('2026-10-03', -5000, { categoryId: cat('Courses', 0) });
    const r = repo.listTransactions({ from: '2026-10-01', to: '2026-10-31', uncategorised: true });
    assert.deepEqual(r.rows.map((t) => t.amount), [-4000]);
  });

  it('« non pointées » écarte ce qui est pointé', () => {
    tx('2026-10-02', -4000, { cleared: true });
    tx('2026-10-03', -5000);
    assert.deepEqual(repo.listTransactions({ uncleared: true }).rows.map((t) => t.amount), [-5000]);
  });

  it('la recherche trouve aussi un montant, exact ou à l’euro près', () => {
    tx('2026-10-02', -24130, { label: 'AMAZON EU' });
    tx('2026-10-03', -24199, { label: 'FNAC' });
    tx('2026-10-04', -2413, { label: 'BOULANGERIE' });
    const labels = (q: string): string[] => repo.listTransactions({ q }).rows.map((t) => t.label).sort();
    assert.deepEqual(labels('241,30'), ['AMAZON EU']);
    assert.deepEqual(labels('241.3'), ['AMAZON EU']);
    assert.deepEqual(labels('241'), ['AMAZON EU', 'FNAC']);
    assert.deepEqual(labels('amazon'), ['AMAZON EU']);
    assert.equal(repo.amountQuery('carrefour 12'), null);
  });

  it('un virement interne dit vers quel compte il va', () => {
    const debit = tx('2026-10-12', -30000);
    const credit = tx('2026-10-12', 30000, { accountId: livret });
    imports.mergeTransfer(debit, credit);
    const rows = repo.listTransactions({}).rows;
    assert.equal(rows.find((t) => t.id === debit)!.transferAccountId, livret);
    assert.equal(rows.find((t) => t.id === credit)!.transferAccountId, joint);
    assert.equal(repo.getTransaction(debit)!.transferAccountId, livret);
  });

  it('un virement modifié reste un virement', () => {
    const debit = tx('2026-10-12', -30000);
    const credit = tx('2026-10-12', 30000, { accountId: livret });
    imports.mergeTransfer(debit, credit);
    const t = repo.updateTransaction(debit, {
      accountId: joint, date: '2026-10-12', amount: -30000, kind: 'virement', label: 'Vers Livret A',
      categoryId: null, contractId: null, notes: 'épargne', cleared: true,
    })!;
    assert.equal(t.kind, 'virement');
    assert.ok(t.transferGroup);
    assert.equal(repo.monthSummary('2026-10', '2026-10-17').expense, 0);
  });
});
