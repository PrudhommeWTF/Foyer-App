// Le fil des dépenses d'un mois (rythme des enveloppes) et les charges fixes.
//
// Le fil doit tomber juste avec le résumé du mois : mêmes exclusions, sinon le
// « reste pour finir le mois » et le rythme des enveloppes se contrediraient.
import assert from 'node:assert/strict';
import fsp from 'node:fs';
import os from 'node:os';
import tmpPath from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';
import * as backup from '../src/finances/backup';
import * as contracts from '../src/finances/contracts';
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

const cat = (name: string, parentId: number | null = null, fixed = false): number =>
  repo.createCategory({ parentId, name, monthlyBudget: 10000, color: '#000', icon: 'facture', fixed }).id;

function tx(date: string, amount: number, over: Partial<Parameters<typeof repo.createTransaction>[0]> = {}): number {
  return repo.createTransaction({
    accountId: joint, date, amount, kind: amount < 0 ? 'depense' : 'recette',
    label: 'Op ' + date, categoryId: null, notes: '', cleared: false, ...over,
  }).id;
}

function contract(categoryId: number | null, over: Partial<contracts.ContractInput> = {}): number {
  return contracts.createContract({
    name: 'Contrat', provider: '', kind: 'assurance', assetId: null, accountId: joint,
    categoryId, memberIds: [], amountMin: null, amountMax: null, periodicity: 'mensuelle',
    renewalOn: null, noticeDays: 0, endsOn: null, status: 'actif', notes: '', refs: [], ...over,
  }).id;
}

beforeEach(reset);

describe('fil du mois', () => {
  it('donne les dépenses jour par jour, virements et recettes exclus, comme le résumé', () => {
    const alim = cat('Courses');
    tx('2026-08-03', -4000, { categoryId: alim });
    tx('2026-08-03', -1000, { categoryId: alim });
    tx('2026-08-05', -2500);
    tx('2026-08-06', 300000);
    tx('2026-08-07', -50000, { kind: 'virement' });
    tx('2026-08-07', 50000, { kind: 'virement', accountId: livret });
    const f = repo.monthFlow('2026-08', '2026-08-19');
    assert.equal(f.days, 31);
    assert.equal(f.day, 19);
    assert.deepEqual(f.daily, [
      { day: 3, categoryId: alim, spent: 5000 },
      { day: 5, categoryId: null, spent: 2500 },
    ]);
    const total = f.daily.reduce((a, d) => a + d.spent, 0);
    assert.equal(total, repo.monthSummary('2026-08', '2026-08-19').expense);
  });

  it('ramène une sous-catégorie à sa racine, sauf si elle est une charge fixe', () => {
    const logement = cat('Logement');
    const travaux = cat('Travaux', logement);
    const loyer = cat('Loyer', logement, true);
    tx('2026-08-02', -3000, { categoryId: travaux });
    tx('2026-08-02', -90000, { categoryId: loyer });
    const f = repo.monthFlow('2026-08', '2026-08-19');
    assert.deepEqual(f.daily, [
      { day: 2, categoryId: logement, spent: 3000 },
      { day: 2, categoryId: loyer, spent: 90000 },
    ]);
  });

  it('compare aux trois mois précédents arrêtés au même jour', () => {
    const alim = cat('Courses');
    tx('2026-07-10', -1000, { categoryId: alim });
    tx('2026-07-25', -9999, { categoryId: alim }); // après le 19 : hors comparaison
    tx('2026-06-19', -2000, { categoryId: alim });
    tx('2026-05-01', -3000, { categoryId: alim });
    tx('2026-04-01', -7777, { categoryId: alim }); // quatre mois avant : hors fenêtre
    const f = repo.monthFlow('2026-08', '2026-08-19');
    assert.deepEqual(f.previous, [
      { month: '2026-07', categoryId: alim, spentToDay: 1000 },
      { month: '2026-06', categoryId: alim, spentToDay: 2000 },
      { month: '2026-05', categoryId: alim, spentToDay: 3000 },
    ]);
  });

  it('un mois passé se compare en entier, borné au dernier jour des mois plus courts', () => {
    tx('2026-02-28', -1000);
    const f = repo.monthFlow('2026-03', '2026-08-19');
    assert.equal(f.day, 31);
    assert.deepEqual(f.previous, [{ month: '2026-02', categoryId: null, spentToDay: 1000 }]);
  });

  it('dit ce que chaque contrat a débité dans le mois', () => {
    const c = contract(null);
    tx('2026-08-05', -7294, { contractId: c });
    tx('2026-07-05', -7294, { contractId: c });
    assert.deepEqual(repo.monthFlow('2026-08', '2026-08-19').contracts, [{ contractId: c, amount: 7294, date: '2026-08-05' }]);
  });
});

describe('courbe des soldes', () => {
  it('donne le solde à la fin des six derniers mois, rien avant la date d’ouverture', () => {
    const compte = repo.createAccount({ name: 'Courant', kind: 'courant', memberIds: [], openingBalance: 100000, openingDate: '2026-05-31', archived: false }).id;
    repo.createAccount({ name: 'Prêt', kind: 'credit', memberIds: [], openingBalance: 0, openingDate: null, archived: false });
    tx('2026-05-10', -5000, { accountId: compte }); // avant l'ouverture : déjà dans le solde saisi
    tx('2026-06-03', -2000, { accountId: compte });
    tx('2026-08-12', 30000, { accountId: compte });
    tx('2026-08-25', -1000, { accountId: compte }); // après aujourd'hui
    const h = repo.balanceHistory('2026-08-19');
    assert.deepEqual(h[compte], [100000, 100000, 100000, 98000, 98000, 128000]);
    assert.equal(Object.keys(h).length, 3, 'le crédit n’a pas de courbe');
  });
});

describe('charges fixes', () => {
  it('une catégorie garde son drapeau quand un client ne l’envoie pas', () => {
    const id = cat('Loyer', null, true);
    const c = repo.updateCategory(id, { parentId: null, name: 'Loyer', monthlyBudget: 0, color: '#000', icon: 'facture' })!;
    assert.equal(c.fixed, true);
    assert.equal(repo.updateCategory(id, { parentId: null, name: 'Loyer', monthlyBudget: 0, color: '#000', icon: 'facture', fixed: false })!.fixed, false);
  });

  it('migration 6 : marque les catégories des contrats actifs et récurrents', () => {
    const assurance = cat('Assurance');
    const vacances = cat('Vacances');
    const ancien = cat('Ancien');
    contract(assurance);
    contract(vacances, { periodicity: 'ponctuelle' });
    contract(ancien, { status: 'resilie' });
    // On rejoue une base arrêtée à la migration 5.
    db.exec('ALTER TABLE fin_categories DROP COLUMN fixed');
    db.prepare("UPDATE fin_meta SET value = '5' WHERE key = 'schema_version'").run();
    migrateFinances(db);
    const fixed = repo.listCategories().filter((c) => c.fixed).map((c) => c.id);
    assert.deepEqual(fixed, [assurance]);
  });

  it('une sauvegarde d’avant la migration 6 se restaure avec ses charges fixes déduites', () => {
    const assurance = cat('Assurance');
    contract(assurance);
    const dump = backup.exportModule();
    for (const row of dump.tables['fin_categories'] as Record<string, unknown>[]) delete row['fixed'];
    dump.schemaVersion = 5;
    backup.restoreModule(dump);
    assert.equal(repo.getCategory(assurance)!.fixed, true);
    assert.equal(repo.listCategories().filter((c) => c.fixed).length, 1);
  });
});
