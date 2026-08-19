// Pistes d'économies.
//
// Une piste est une intention chiffrée. Le module ne prétend pas mesurer
// l'économie obtenue, seul le coût réel du contrat le dira : il tient la liste,
// le cumul, et sépare ce qui est fait de ce qui reste à faire.
import assert from 'node:assert/strict';
import fsp from 'node:fs';
import os from 'node:os';
import tmpPath from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';
import * as contracts from '../src/finances/contracts';
import * as savings from '../src/finances/savings';
import * as backup from '../src/finances/backup';

const tmpDir = (): string => fsp.mkdtempSync(tmpPath.join(os.tmpdir(), 'foyer-test-'));

let db: Database.Database;

function reset(): void {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFinances(db);
  repo.initFinancesRepo(db, tmpDir());
}

const piste = (over: Partial<savings.SavingInput> = {}): savings.Saving => savings.createSaving({
  title: 'Renégocier l’assurance habitation', description: '', annualGain: 24000,
  contractId: null, assetId: null, status: 'idee', targetDate: null, taskId: null, ...over,
});

const contract = (): number => contracts.createContract({
  name: 'Assurance habitation', provider: 'AXA', kind: 'assurance',
  assetId: null, accountId: null, categoryId: null, memberIds: [],
  amountMin: null, amountMax: null, periodicity: 'mensuelle',
  renewalOn: null, noticeDays: 0, endsOn: null, status: 'actif', notes: '', refs: [],
}).id;

beforeEach(reset);

describe('pistes d’économies', () => {
  it('sépare ce qui reste à faire de ce qui est obtenu', () => {
    piste({ title: 'Assurance', annualGain: 24000 });
    piste({ title: 'Fibre', annualGain: 12000, status: 'en-cours' });
    piste({ title: 'Électricité', annualGain: 30000, status: 'faite' });

    const t = savings.totals();
    assert.equal(t.pending, 36000, 'les idées et les pistes en cours');
    assert.equal(t.done, 30000);
    assert.equal(t.openCount, 2);
    assert.equal(t.count, 3);
  });

  it('ne compte nulle part une piste abandonnée', () => {
    piste({ annualGain: 24000, status: 'abandonnee' });
    const t = savings.totals();
    assert.equal(t.pending, 0, 'un total gonflé par ce qui ne se fera jamais ne sert à rien');
    assert.equal(t.done, 0);
    assert.equal(t.count, 1);
  });

  it('montre d’abord ce sur quoi agir, du plus gros gain au plus petit', () => {
    piste({ title: 'Petite idée', annualGain: 5000 });
    piste({ title: 'Grosse idée', annualGain: 50000 });
    piste({ title: 'En cours', annualGain: 1000, status: 'en-cours' });
    piste({ title: 'Faite', annualGain: 90000, status: 'faite' });

    assert.deepEqual(savings.listSavings().map((s) => s.title),
      ['En cours', 'Grosse idée', 'Petite idée', 'Faite']);
  });

  it('survit à la disparition du contrat auquel elle était rattachée', () => {
    const c = contract();
    const p = piste({ contractId: c });
    contracts.deleteContract(c);

    const after = savings.getSaving(p.id)!;
    assert.equal(after.contractId, null, 'la piste reste, détachée');
    assert.equal(after.annualGain, 24000);
  });

  it('mémorise la tâche créée, et sait l’oublier', () => {
    const p = piste();
    assert.equal(savings.linkTask(p.id, 't42')!.taskId, 't42');
    assert.equal(savings.linkTask(p.id, null)!.taskId, null, 'la tâche supprimée ailleurs se délie ici');
  });

  it('voyage dans la sauvegarde du module', () => {
    piste({ title: 'Assurance', annualGain: 24000, status: 'en-cours' });
    const dump = JSON.parse(JSON.stringify(backup.exportModule()));
    assert.equal(dump.counts['fin_savings'], 1);

    savings.deleteSaving(savings.listSavings()[0].id);
    assert.equal(savings.totals().count, 0);

    backup.restoreModule(dump);
    assert.equal(savings.listSavings()[0].title, 'Assurance');
    assert.equal(savings.totals().pending, 24000);
  });
});
