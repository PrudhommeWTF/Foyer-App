// Sauvegarde et restauration du seul module Finances.
//
// La restauration écrase. Ces tests portent donc autant sur ce qu'elle refuse
// que sur ce qu'elle rétablit : une restauration à moitié faite serait pire que
// pas de restauration du tout.
import assert from 'node:assert/strict';
import fsp from 'node:fs';
import os from 'node:os';
import tmpPath from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { FIN_SCHEMA_VERSION, migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';
import * as backup from '../src/finances/backup';
import * as contracts from '../src/finances/contracts';
import * as rules from '../src/finances/rules-repo';

const tmpDir = (): string => fsp.mkdtempSync(tmpPath.join(os.tmpdir(), 'foyer-test-'));

let db: Database.Database;
let compte: number;

function reset(): void {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFinances(db);
  repo.initFinancesRepo(db, tmpDir());
  compte = repo.createAccount({ name: 'Compte joint', kind: 'courant', memberIds: [], openingBalance: 0, openingDate: null, archived: false }).id;
}

/** A small but representative household: accounts, contract, rule, operations. */
function populate(): void {
  repo.addAlias(compte, 'Compte Courant Mme N Dupont');
  const contrat = contracts.createContract({
    name: 'Assurance', provider: 'AXA', kind: 'assurance', assetId: null, accountId: compte,
    categoryId: null, memberIds: [], amountMin: 7000, amountMax: 7600, periodicity: 'mensuelle',
    renewalOn: '2026-09-15', noticeDays: 60, endsOn: null, status: 'actif', notes: '',
    refs: [{ key: 'N° de police', value: '123' }],
  }).id;
  repo.createTransaction({
    accountId: compte, date: '2026-08-05', amount: -7294, kind: 'depense',
    label: 'Prlv Sepa Axa', categoryId: null, contractId: contrat, notes: '', cleared: false,
  });
  rules.createRule({
    name: 'AXA', enabled: true, matchMode: 'all', stop: false,
    conditions: [{ field: 'label', op: 'contains', value: 'Axa', value2: '' }],
    actions: [{ kind: 'tag', value: 'assurance' }],
  });
  rules.applyRules();
}

beforeEach(reset);

describe('sauvegarde', () => {
  it('emporte toutes les tables du module, avec leur décompte', () => {
    populate();
    const dump = backup.exportModule('2026-08-19T10:00:00.000Z');

    assert.equal(dump.format, 1);
    assert.equal(dump.schemaVersion, FIN_SCHEMA_VERSION);
    assert.equal(dump.generatedAt, '2026-08-19T10:00:00.000Z');
    assert.equal(dump.counts['fin_accounts'], 1);
    assert.equal(dump.counts['fin_contracts'], 1);
    assert.equal(dump.counts['fin_transactions'], 1);
    assert.equal(dump.counts['fin_rules'], 1);
    assert.equal(dump.counts['fin_tags'], 1);
    // Les catégories de départ sont créées par la migration : elles voyagent aussi.
    assert.ok(dump.counts['fin_categories'] > 0);
  });

  it('produit un fichier qui traverse un aller-retour JSON', () => {
    populate();
    const dump = JSON.parse(JSON.stringify(backup.exportModule()));
    assert.deepEqual(dump.counts, backup.exportModule().counts);
  });
});

describe('restauration', () => {
  it('rétablit exactement l’état sauvegardé, y compris les liens', () => {
    populate();
    const dump = JSON.parse(JSON.stringify(backup.exportModule()));

    // Le foyer part en vrille entre-temps.
    repo.deleteTransaction(repo.listTransactions({}).rows[0].id);
    contracts.deleteContract(contracts.listContracts()[0].id);
    repo.createAccount({ name: 'Compte de trop', kind: 'courant', memberIds: [], openingBalance: 0, openingDate: null, archived: false });

    const report = backup.restoreModule(dump);

    assert.equal(report.before['fin_accounts'], 2);
    assert.equal(report.after['fin_accounts'], 1, 'le compte créé après la sauvegarde disparaît');
    const tx = repo.listTransactions({}).rows;
    assert.equal(tx.length, 1);
    assert.equal(tx[0].amount, -7294);
    assert.ok(tx[0].contractId, 'l’opération retrouve son contrat');
    assert.deepEqual(tx[0].tags, ['assurance'], 'et son étiquette');
    assert.equal(contracts.listContracts()[0].refs[0].value, '123');
    assert.deepEqual(repo.listAliases().map((a) => a.labelRaw), ['Compte Courant Mme N Dupont']);
  });

  it('est idempotente : restaurer deux fois donne le même état', () => {
    populate();
    const dump = JSON.parse(JSON.stringify(backup.exportModule()));
    backup.restoreModule(dump);
    const once = backup.exportModule().counts;
    backup.restoreModule(dump);
    assert.deepEqual(backup.exportModule().counts, once);
  });

  it('signale les colonnes qu’elle ignore, plutôt que de perdre en silence', () => {
    populate();
    const dump = JSON.parse(JSON.stringify(backup.exportModule()));
    // Une sauvegarde d'avant la migration 4 portait un titulaire unique en colonne.
    dump.schemaVersion = 3;
    for (const row of dump.tables['fin_accounts']) row.member_id = 'm1';

    const report = backup.restoreModule(dump);
    assert.deepEqual(report.ignoredColumns, [{ table: 'fin_accounts', columns: ['member_id'] }]);
    assert.equal(report.after['fin_accounts'], 1, 'le reste de la ligne est bien restauré');
  });

  it('emporte les titulaires dans la sauvegarde', () => {
    repo.updateAccount(compte, { name: 'Compte joint', kind: 'courant', memberIds: ['m1', 'm2'], openingBalance: 0, openingDate: null, archived: false });
    const dump = JSON.parse(JSON.stringify(backup.exportModule()));
    assert.equal(dump.counts['fin_account_members'], 2);

    repo.updateAccount(compte, { name: 'Compte joint', kind: 'courant', memberIds: [], openingBalance: 0, openingDate: null, archived: false });
    backup.restoreModule(dump);
    assert.deepEqual(repo.getAccount(compte)!.memberIds, ['m1', 'm2']);
  });

  it('refuse une sauvegarde plus récente que le schéma en place', () => {
    const dump = backup.exportModule();
    assert.throws(
      () => backup.restoreModule({ ...dump, schemaVersion: FIN_SCHEMA_VERSION + 1 }),
      (e: Error) => e instanceof backup.RestoreRefused && /plus récente/.test(e.message),
    );
  });

  it('accepte une sauvegarde plus ancienne, les migrations étant additives', () => {
    populate();
    const dump = JSON.parse(JSON.stringify(backup.exportModule()));
    // Une sauvegarde de la tranche 2 ignorait rule_id sur les opérations.
    dump.schemaVersion = 2;
    for (const row of dump.tables['fin_transactions']) delete row.rule_id;

    const report = backup.restoreModule(dump);
    assert.equal(report.after['fin_transactions'], 1);
    assert.equal(repo.listTransactions({}).rows[0].ruleId, null);
  });

  it('refuse ce qui n’est pas une sauvegarde de ce module', () => {
    for (const bad of [null, 'texte', {}, { format: 2 }, { format: 1, schemaVersion: 3 }]) {
      assert.throws(() => backup.restoreModule(bad), backup.RestoreRefused);
    }
  });

  it('refuse une sauvegarde corrompue sans rien détruire au passage', () => {
    populate();
    const avant = backup.exportModule().counts;
    const dump = JSON.parse(JSON.stringify(backup.exportModule()));
    dump.tables['fin_transactions'] = { pas: 'une liste' };

    assert.throws(() => backup.restoreModule(dump), backup.RestoreRefused);
    assert.deepEqual(backup.exportModule().counts, avant, 'la base est intacte');
  });

  it('laisse la base intacte quand la restauration échoue en cours de route', () => {
    populate();
    const avant = backup.exportModule().counts;
    const dump = JSON.parse(JSON.stringify(backup.exportModule()));
    // Une opération qui désigne un compte absent de la sauvegarde : les clés
    // étrangères sont vérifiées au commit, la transaction doit donc tout annuler.
    dump.tables['fin_transactions'][0].account_id = 9999;

    assert.throws(() => backup.restoreModule(dump));
    assert.deepEqual(backup.exportModule().counts, avant, 'tout ou rien');
    assert.equal(repo.listTransactions({}).rows.length, 1);
  });
});
