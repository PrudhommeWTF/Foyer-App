// Relevés de compteur.
//
// La moitié de ces tests porte sur les cas où le module doit refuser de donner
// un chiffre : un compteur remplacé, deux relevés le même jour, un index
// manquant. Une consommation négative affichée comme un fait serait pire que
// pas de consommation du tout.
import assert from 'node:assert/strict';
import fsp from 'node:fs';
import os from 'node:os';
import tmpPath from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';
import { initBlobs } from '../src/storage/blobs';
import * as contracts from '../src/finances/contracts';
import * as energy from '../src/finances/energy';

const tmpDir = (): string => fsp.mkdtempSync(tmpPath.join(os.tmpdir(), 'foyer-test-'));

let db: Database.Database;
let contractId: number;

function reset(): void {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFinances(db);
  // Le magasin d’octets est un service du foyer, initialisé une fois au
  // démarrage (voir db.ts). Les tests font de même plutôt que de le supposer.
  initBlobs(tmpDir());
  repo.initFinancesRepo(db);
  contractId = contracts.createContract({
    name: 'Électricité', provider: 'EDF', kind: 'energie',
    assetId: null, accountId: null, categoryId: null, memberIds: [],
    amountMin: null, amountMax: null, periodicity: 'mensuelle',
    renewalOn: null, noticeDays: 0, endsOn: null, status: 'actif', notes: '', refs: [],
  }).id;
}

/** A meter reading: date and cumulative index, the usual case. */
const read = (date: string, indexTotal: number | null, over: Partial<energy.ReadingInput> = {}): energy.Reading =>
  energy.createReading({
    contractId, date, indexTotal, indexHp: null, indexHc: null,
    kwh: null, kwhHp: null, kwhHc: null, cost: null, notes: '', ...over,
  });

beforeEach(reset);

describe('consommation entre deux relevés', () => {
  it('soustrait les index et ramène à une consommation par jour', () => {
    read('2026-01-01', 10000);
    read('2026-01-31', 10600);

    const p = energy.periods(contractId)[1];
    assert.equal(p.days, 30);
    assert.equal(p.kwh, 600);
    assert.equal(p.kwhPerDay, 20);
    assert.equal(p.gap, null);
  });

  it('préfère la consommation lue sur une facture à une soustraction d’index', () => {
    read('2026-01-01', 10000);
    read('2026-01-31', 99999, { kwh: 600 });

    const p = energy.periods(contractId)[1];
    assert.equal(p.kwh, 600, 'la facture fait foi, l’index n’est pas recalculé');
  });

  it('additionne les heures pleines et creuses quand il n’y a pas de total', () => {
    read('2026-01-01', null, { indexHp: 5000, indexHc: 3000 });
    read('2026-01-11', null, { indexHp: 5150, indexHc: 3100 });

    const p = energy.periods(contractId)[1];
    assert.equal(p.kwhHp, 150);
    assert.equal(p.kwhHc, 100);
    assert.equal(p.kwh, 250);
    assert.equal(p.kwhPerDay, 25);
  });

  it('donne le prix du kWh quand le montant de la période est connu', () => {
    read('2026-01-01', 10000);
    read('2026-01-31', 10600, { cost: 12000 });

    const p = energy.periods(contractId)[1];
    assert.equal(p.cost, 12000);
    assert.equal(p.costPerKwh, 20, '120 € pour 600 kWh, soit 20 centimes');
  });
});

describe('ce qui ne peut pas être mesuré ne l’est pas', () => {
  it('le premier relevé ouvre l’historique sans rien mesurer', () => {
    read('2026-01-01', 10000);
    const p = energy.periods(contractId)[0];
    assert.equal(p.gap, 'premier');
    assert.equal(p.kwh, null);
    assert.equal(p.kwhPerDay, null);
  });

  it('un index qui recule signale un compteur remplacé, pas une consommation négative', () => {
    read('2026-01-01', 10600);
    read('2026-02-01', 200);

    const p = energy.periods(contractId)[1];
    assert.equal(p.gap, 'index-recule');
    assert.equal(p.kwh, null, 'aucun chiffre plutôt qu’un chiffre faux');
  });

  it('un index heures creuses qui recule suffit à invalider la période', () => {
    read('2026-01-01', null, { indexHp: 5000, indexHc: 3000 });
    read('2026-02-01', null, { indexHp: 5200, indexHc: 10 });

    assert.equal(energy.periods(contractId)[1].gap, 'index-recule');
  });

  it('deux relevés le même jour ne donnent pas une consommation infinie', () => {
    read('2026-01-01', 10000);
    read('2026-01-01', 10050);

    const p = energy.periods(contractId)[1];
    assert.equal(p.days, 0);
    assert.equal(p.gap, 'meme-jour');
    assert.equal(p.kwhPerDay, null);
  });

  it('un relevé sans index ni consommation le dit', () => {
    read('2026-01-01', 10000);
    read('2026-02-01', null);

    assert.equal(energy.periods(contractId)[1].gap, 'inconnu');
  });
});

describe('comparaison à l’an dernier', () => {
  it('compare la même fenêtre de calendrier, pas la période précédente', () => {
    // Janvier 2025 : 20 kWh par jour. Avril 2025 : 5 kWh par jour.
    read('2025-01-01', 0);
    read('2025-01-31', 600);
    read('2025-04-01', 700);
    read('2025-04-30', 845);
    // Janvier 2026 : 25 kWh par jour, à comparer aux 20 de janvier 2025.
    read('2025-12-31', 3000);
    read('2026-01-30', 3750);

    const janvier2026 = energy.periods(contractId).find((p) => p.to === '2026-01-30')!;
    assert.equal(janvier2026.kwhPerDay, 25);
    assert.equal(janvier2026.lastYearKwhPerDay, 20, 'janvier contre janvier, pas contre avril');
  });

  it('ne compare à rien quand l’historique ne remonte pas assez loin', () => {
    read('2026-01-01', 10000);
    read('2026-01-31', 10600);
    assert.equal(energy.periods(contractId)[1].lastYearKwhPerDay, null);
  });
});

describe('synthèse', () => {
  it('cumule douze mois glissants et donne la tendance', () => {
    read('2025-01-01', 0);
    read('2025-01-31', 600);
    read('2025-12-31', 5000);
    read('2026-01-30', 5750);

    const s = energy.summary(contractId);
    assert.equal(s.readings, 4);
    assert.equal(s.latest!.to, '2026-01-30');
    assert.equal(s.latest!.kwhPerDay, 25);
    assert.equal(Math.round(s.trend!), 25, '25 kWh/jour contre 20, soit 25 % de plus');
  });

  it('reste muette plutôt que d’inventer, sans relevé', () => {
    const s = energy.summary(contractId);
    assert.equal(s.readings, 0);
    assert.equal(s.latest, null);
    assert.equal(s.trend, null);
    assert.equal(s.yearKwh, null);
  });

  it('les relevés disparaissent avec leur contrat', () => {
    read('2026-01-01', 10000);
    contracts.deleteContract(contractId);
    assert.deepEqual(energy.listReadings(contractId), []);
  });
});
