// Biens, contrats et échéances.
//
// L'échéance qui compte vraiment est la date limite de résiliation : un contrat
// tacitement reconduit et manqué d'un jour coûte une période entière de plus.
// Le reste du fichier vérifie que le coût réel dit la vérité, y compris quand
// elle contredit le montant annoncé.
import assert from 'node:assert/strict';
import fsp from 'node:fs';
import os from 'node:os';
import tmpPath from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';
import * as contracts from '../src/finances/contracts';
import * as rules from '../src/finances/rules-repo';

/** Un répertoire jetable par base : les pièces jointes écrivent sur disque. */
const tmpDir = (): string => fsp.mkdtempSync(tmpPath.join(os.tmpdir(), 'foyer-test-'));

let db: Database.Database;
let compte: number;

const TODAY = '2026-08-19';

function reset(): void {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFinances(db);
  repo.initFinancesRepo(db, tmpDir());
  compte = repo.createAccount({ name: 'Compte joint', kind: 'courant', memberIds: [], openingBalance: 0, openingDate: null, archived: false }).id;
}

const asset = (over: Partial<contracts.AssetInput> = {}): contracts.Asset => contracts.createAsset({
  name: 'Maison', kind: 'immobilier', status: 'actif', address: '', acquiredOn: null, soldOn: null, notes: '', ...over,
});

const contract = (over: Partial<contracts.ContractInput> = {}): contracts.Contract => contracts.createContract({
  name: 'Assurance véhicule', provider: 'AXA', kind: 'assurance',
  assetId: null, accountId: null, categoryId: null, memberIds: [],
  amountMin: null, amountMax: null, periodicity: 'mensuelle',
  renewalOn: null, noticeDays: 0, endsOn: null, status: 'actif', notes: '', refs: [], ...over,
});

const tx = (date: string, amount: number, over: Partial<Parameters<typeof repo.createTransaction>[0]> = {}): number =>
  repo.createTransaction({
    accountId: compte, date, amount, kind: amount < 0 ? 'depense' : 'recette',
    label: 'Prlv Sepa Axa', categoryId: null, notes: '', cleared: false, ...over,
  }).id;

beforeEach(reset);

describe('biens et contrats', () => {
  it('rattache un contrat à un bien, et compte les contrats du bien', () => {
    const maison = asset();
    contract({ name: 'Assurance habitation', assetId: maison.id });
    contract({ name: 'Électricité', assetId: maison.id, kind: 'energie' });
    contract({ name: 'Mutuelle', kind: 'sante' });

    assert.equal(contracts.getAsset(maison.id)!.contracts, 2);
  });

  it('supprimer un bien libère ses contrats sans les emporter', () => {
    const maison = asset();
    const c = contract({ assetId: maison.id });
    contracts.deleteAsset(maison.id);

    assert.equal(contracts.getAsset(maison.id), null);
    assert.equal(contracts.getContract(c.id)!.assetId, null, 'le contrat survit, détaché');
  });

  it('supprimer un contrat détache ses opérations au lieu de les effacer', () => {
    const c = contract();
    const t = tx('2026-08-05', -8169, { contractId: c.id });
    assert.equal(contracts.countTransactionsForContract(c.id), 1);

    contracts.deleteContract(c.id);
    const after = repo.getTransaction(t)!;
    assert.equal(after.contractId, null);
    assert.equal(after.amount, -8169, 'l’argent a bien été dépensé, seule l’explication disparaît');
  });

  it('couvre plusieurs personnes, et les libère avec le contrat', () => {
    const c = contract({ memberIds: ['m1', 'm2', 'm3'] });
    assert.deepEqual(contracts.getContract(c.id)!.memberIds, ['m1', 'm2', 'm3']);

    contracts.updateContract(c.id, { ...c, memberIds: ['m2'] });
    assert.deepEqual(contracts.getContract(c.id)!.memberIds, ['m2']);

    contracts.deleteContract(c.id);
    const restants = (db.prepare('SELECT COUNT(*) AS n FROM fin_contract_members WHERE contract_id = ?').get(c.id) as { n: number }).n;
    assert.equal(restants, 0);
  });

  it('conserve les références du contrat, dans l’ordre', () => {
    const c = contract({ refs: [{ key: 'N° de police', value: '123-456' }, { key: 'Client', value: 'AB99' }] });
    assert.deepEqual(contracts.getContract(c.id)!.refs.map((r) => r.key), ['N° de police', 'Client']);

    contracts.updateContract(c.id, { ...c, refs: [{ key: 'Client', value: 'AB99' }] });
    assert.deepEqual(contracts.getContract(c.id)!.refs, [{ key: 'Client', value: 'AB99' }]);
  });
});

describe('échéances', () => {
  it('la date limite de résiliation précède la reconduction du préavis', () => {
    contract({ renewalOn: '2026-10-15', noticeDays: 60 });

    const d = contracts.deadlines(TODAY);
    const preavis = d.find((x) => x.kind === 'preavis')!;
    const renouv = d.find((x) => x.kind === 'renouvellement')!;
    assert.equal(preavis.date, '2026-08-16');
    assert.equal(renouv.date, '2026-10-15');
    assert.equal(preavis.daysAway, -3, 'la fenêtre s’est fermée il y a trois jours, et on le dit');
  });

  it('reporte une date de reconduction passée sur son prochain anniversaire', () => {
    contract({ renewalOn: '2023-11-02', noticeDays: 30 });

    const d = contracts.deadlines(TODAY);
    assert.equal(d.find((x) => x.kind === 'renouvellement')!.date, '2026-11-02');
    assert.equal(d.find((x) => x.kind === 'preavis')!.date, '2026-10-03');
  });

  it('bascule sur l’année suivante quand l’anniversaire de cette année est passé', () => {
    contract({ renewalOn: '2020-03-04' });
    assert.equal(contracts.nextAnniversary('2020-03-04', TODAY), '2027-03-04');
    assert.equal(contracts.nextAnniversary('2020-12-31', TODAY), '2026-12-31');
    // Un 29 février sur une année commune tombe au 1er mars, comme à la banque.
    assert.equal(contracts.nextAnniversary('2024-02-29', '2026-06-01'), '2027-03-01');
  });

  it('ignore les contrats résiliés et ce qui sort de l’horizon', () => {
    contract({ name: 'Résilié', renewalOn: '2026-09-01', status: 'resilie' });
    contract({ name: 'Lointain', endsOn: '2028-01-01' });
    contract({ name: 'Proche', endsOn: '2026-09-30' });

    const names = contracts.deadlines(TODAY).map((d) => d.contractName);
    assert.deepEqual(names, ['Proche']);
  });

  it('trie les échéances par date, la plus proche en tête', () => {
    contract({ name: 'B', endsOn: '2026-10-01' });
    contract({ name: 'A', endsOn: '2026-09-01' });

    assert.deepEqual(contracts.deadlines(TODAY).map((d) => d.date), ['2026-09-01', '2026-10-01']);
  });

  it('ne réclame rien d’un contrat sans date', () => {
    contract({ renewalOn: null, endsOn: null, noticeDays: 90 });
    assert.deepEqual(contracts.deadlines(TODAY), []);
  });
});

describe('coût réel', () => {
  it('additionne les opérations rattachées sur douze mois', () => {
    const c = contract({ amountMin: 7500, amountMax: 8500 });
    tx('2026-06-05', -8169, { contractId: c.id });
    tx('2026-07-05', -8169, { contractId: c.id });
    tx('2026-08-05', -8169, { contractId: c.id });
    tx('2026-08-05', -4063);

    const cost = contracts.contractCosts(TODAY).get(c.id)!;
    assert.equal(cost.count, 3);
    assert.equal(cost.total, 24507);
    assert.equal(cost.lastAmount, 8169);
    assert.equal(cost.offRange, false);
  });

  it('signale un prélèvement sorti de la fourchette annoncée', () => {
    const c = contract({ amountMin: 7000, amountMax: 7600 });
    tx('2026-07-05', -7500, { contractId: c.id });
    tx('2026-08-05', -8169, { contractId: c.id });

    const cost = contracts.contractCosts(TODAY).get(c.id)!;
    assert.equal(cost.lastAmount, 8169);
    assert.equal(cost.offRange, true, '81,69 € dépasse la fourchette 70 à 76 €');
  });

  it('laisse de côté ce qui date de plus d’un an', () => {
    const c = contract();
    tx('2025-01-05', -8169, { contractId: c.id });
    assert.equal(contracts.contractCosts(TODAY).get(c.id), undefined);
  });
});

describe('règle : rattacher au contrat', () => {
  it('range les prélèvements du bon montant sous le bon contrat', () => {
    const auto = contract({ name: 'AXA véhicule', amountMin: 8000, amountMax: 8300 });
    const habitation = contract({ name: 'AXA habitation', amountMin: 4000, amountMax: 4200 });
    tx('2026-08-05', -8169);
    tx('2026-08-05', -4063);
    tx('2026-08-06', -63546);

    rules.createRule({
      name: 'AXA véhicule', enabled: true, matchMode: 'all', stop: false,
      conditions: [
        { field: 'label', op: 'contains', value: 'Prlv Sepa Axa', value2: '' },
        { field: 'amount', op: 'between', value: '80', value2: '83' },
      ],
      actions: [{ kind: 'contract', value: String(auto.id) }],
    });
    rules.createRule({
      name: 'AXA habitation', enabled: true, matchMode: 'all', stop: false,
      conditions: [
        { field: 'label', op: 'contains', value: 'Prlv Sepa Axa', value2: '' },
        { field: 'amount', op: 'between', value: '40', value2: '42' },
      ],
      actions: [{ kind: 'contract', value: String(habitation.id) }],
    });
    const report = rules.applyRules();

    assert.equal(report.changed, 2, 'le prélèvement de 635,46 € ne correspond à aucun des deux');
    assert.equal(contracts.countTransactionsForContract(auto.id), 1);
    assert.equal(contracts.countTransactionsForContract(habitation.id), 1);
    assert.equal(contracts.contractCosts(TODAY).get(auto.id)!.lastAmount, 8169);
  });

  it('rejouer ne rattache pas deux fois', () => {
    const c = contract();
    tx('2026-08-05', -8169);
    rules.createRule({
      name: 'AXA', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Prlv Sepa Axa', value2: '' }],
      actions: [{ kind: 'contract', value: String(c.id) }],
    });
    assert.equal(rules.applyRules().changed, 1);
    assert.equal(rules.applyRules().changed, 0);
  });
});
