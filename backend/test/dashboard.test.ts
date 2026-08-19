// Tableau de bord : agrégats mensuels et annuels, et honnêteté des chiffres.
//
// Un tableau de bord se lit d'un coup d'œil et se croit sur parole. Un total
// sous-estimé parce qu'il manque un relevé est pire qu'une absence de total :
// ces tests portent donc autant sur les sommes que sur ce qui les signale.
import assert from 'node:assert/strict';
import fsp from 'node:fs';
import os from 'node:os';
import tmpPath from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';
import * as imports from '../src/finances/import-repo';
import { SERIES_LENGTH, dashboard } from '../src/finances/dashboard';

/** Un répertoire jetable par base : les pièces jointes écrivent sur disque. */
const tmpDir = (): string => fsp.mkdtempSync(tmpPath.join(os.tmpdir(), 'foyer-test-'));

let db: Database.Database;
let joint: number;
let livret: number;

const TODAY = '2026-08-19';

function reset(): void {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFinances(db);
  repo.initFinancesRepo(db, tmpDir());
  joint = repo.createAccount({ name: 'Compte joint', kind: 'courant', memberId: null, openingBalance: 0, openingDate: null, archived: false }).id;
  livret = repo.createAccount({ name: 'Livret', kind: 'epargne', memberId: null, openingBalance: 0, openingDate: null, archived: false }).id;
}

/** One operation, entered by hand (so it claims nothing about completeness). */
function tx(date: string, amount: number, over: Partial<Parameters<typeof repo.createTransaction>[0]> = {}): number {
  return repo.createTransaction({
    accountId: joint, date, amount, kind: amount < 0 ? 'depense' : 'recette',
    label: 'Op ' + date, categoryId: null, notes: '', cleared: false, ...over,
  }).id;
}

/** Declare that an import covered [from, to] for an account. */
function covers(accountId: number, from: string, to: string): void {
  const id = imports.createDraft('relevé.csv', 'CSV');
  imports.commitImport(id, [], new Map([[accountId, { from, to }]]));
}

beforeEach(reset);

describe('tableau de bord : le mois', () => {
  it('somme les ressources et les dépenses, virements internes exclus', () => {
    tx('2026-08-03', 250000);
    tx('2026-08-04', -60000);
    tx('2026-08-05', -1550);
    tx('2026-08-06', -100000, { kind: 'virement' });

    const d = dashboard('2026-08', TODAY);
    assert.equal(d.month.income, 250000);
    assert.equal(d.month.expense, 61550);
    assert.equal(d.month.balance, 188450);
  });

  it('compare au mois précédent, et se tait quand il n’y a pas de précédent', () => {
    tx('2026-07-10', -40000);
    tx('2026-08-10', -50000);

    assert.equal(dashboard('2026-08', TODAY).previous?.expense, 40000);
    assert.equal(dashboard('2026-07', TODAY).previous, null, 'un mois vide ne sert pas de comparaison');
  });

  it('classe les plus grosses dépenses du mois, virements exclus', () => {
    tx('2026-08-02', -1200, { label: 'Petite' });
    tx('2026-08-03', -90000, { label: 'Grosse' });
    tx('2026-08-04', -45000, { label: 'Moyenne' });
    tx('2026-08-05', -300000, { kind: 'virement', label: 'Virement' });
    tx('2026-08-06', 500000, { label: 'Salaire' });

    const top = dashboard('2026-08', TODAY).topExpenses;
    assert.deepEqual(top.map((t) => t.label), ['Grosse', 'Moyenne', 'Petite']);
  });
});

describe('tableau de bord : les douze mois', () => {
  it('rend toujours douze points, trous compris, du plus ancien au plus récent', () => {
    tx('2026-08-10', -10000);
    tx('2026-03-10', -20000);

    const s = dashboard('2026-08', TODAY).series;
    assert.equal(s.length, SERIES_LENGTH);
    assert.equal(s[0].month, '2025-09');
    assert.equal(s[SERIES_LENGTH - 1].month, '2026-08');
    assert.equal(s.find((p) => p.month === '2026-03')!.expense, 20000);
    // Un mois sans opération vaut zéro, il n’est pas escamoté.
    assert.equal(s.find((p) => p.month === '2026-05')!.expense, 0);
  });

  it('exclut les mois incomplets et les mois vides de la moyenne', () => {
    // Deux mois pleins à 100 € et 200 €, plus un mois tronqué à 10 €.
    covers(joint, '2026-06-01', '2026-07-31');
    tx('2026-06-10', -10000);
    tx('2026-07-10', -20000);
    tx('2026-08-10', -1000);

    const d = dashboard('2026-08', TODAY);
    assert.equal(d.completeMonths, 2, 'août s’arrête au 31/07 côté couverture');
    assert.equal(d.averageExpense, 15000);
  });
});

describe('tableau de bord : ce qui est incomplet le dit', () => {
  it('signale un mois dont les données s’arrêtent en cours de route', () => {
    covers(joint, '2026-01-01', '2026-07-31');
    tx('2026-07-10', -10000);

    const s = dashboard('2026-08', TODAY).series;
    assert.equal(s.find((p) => p.month === '2026-07')!.incomplete, false);
    assert.equal(s.find((p) => p.month === '2026-08')!.incomplete, true, 'plus rien après le 31/07');
  });

  it('signale un trou au milieu, pas seulement une fin de données', () => {
    covers(joint, '2026-01-01', '2026-03-31');
    covers(joint, '2026-06-01', '2026-08-19');

    const s = dashboard('2026-08', TODAY).series;
    assert.equal(s.find((p) => p.month === '2026-02')!.incomplete, false);
    assert.equal(s.find((p) => p.month === '2026-04')!.incomplete, true, 'avril n’est couvert par aucun import');
    assert.equal(s.find((p) => p.month === '2026-07')!.incomplete, false);
  });

  it('ne prétend rien sur la période antérieure au premier import d’un compte', () => {
    // Le livret n’a été importé qu’à partir de juin : les mois d’avant ne sont
    // pas déclarés incomplets à cause de lui.
    covers(joint, '2026-01-01', '2026-08-19');
    covers(livret, '2026-06-01', '2026-08-19');

    const s = dashboard('2026-08', TODAY).series;
    assert.ok(s.filter((p) => p.month >= '2026-01').every((p) => !p.incomplete));
  });

  it('recolle deux imports qui se suivent sans laisser de trou d’un jour', () => {
    covers(joint, '2026-01-01', '2026-04-30');
    covers(joint, '2026-05-01', '2026-08-19');

    const s = dashboard('2026-08', TODAY).series;
    assert.ok(s.filter((p) => p.month >= '2026-01').every((p) => !p.incomplete), 'le 30/04 et le 01/05 se touchent');
  });

  it('un compte tenu à la main ne rend jamais un mois incomplet', () => {
    tx('2026-08-10', -10000);
    assert.equal(dashboard('2026-08', TODAY).series[SERIES_LENGTH - 1].incomplete, false);
  });
});

describe('tableau de bord : l’année', () => {
  it('cumule l’année en cours jusqu’au mois affiché, pas au-delà', () => {
    tx('2026-02-10', -10000);
    tx('2026-05-10', -20000);
    tx('2026-11-10', -99999);

    const y = dashboard('2026-05', TODAY).year;
    assert.equal(y.year, 2026);
    assert.equal(y.expense, 30000, 'novembre n’est pas compté depuis mai');
    assert.equal(y.months, 5);
  });

  it('met le budget de référence à l’échelle des mois écoulés', () => {
    const courses = repo.createCategory({ parentId: null, name: 'Courses', monthlyBudget: 40000, color: '#7A9B76', icon: 'panier' }).id;
    tx('2026-01-10', -30000, { categoryId: courses });
    tx('2026-02-10', -50000, { categoryId: courses });

    const y = dashboard('2026-02', TODAY).year;
    const line = y.categories.find((c) => c.categoryId === courses)!;
    assert.equal(line.spent, 80000);
    assert.equal(line.budget, 80000, '400 € par mois sur deux mois');
  });

  it('fait remonter une sous-catégorie sur sa parente et isole le non classé', () => {
    const maison = repo.createCategory({ parentId: null, name: 'Maison', monthlyBudget: 0, color: '#7A9B76', icon: 'maison' }).id;
    const elec = repo.createCategory({ parentId: maison, name: 'Électricité', monthlyBudget: 0, color: '#7A9B76', icon: 'facture' }).id;
    tx('2026-03-10', -12000, { categoryId: elec });
    tx('2026-03-11', -8000, { categoryId: maison });
    tx('2026-03-12', -5000);

    const y = dashboard('2026-03', TODAY).year;
    assert.equal(y.categories.find((c) => c.categoryId === maison)!.spent, 20000);
    assert.equal(y.categories.find((c) => c.categoryId === null)!.spent, 5000);
    // Les lignes sont triées par dépense décroissante.
    assert.deepEqual(y.categories.map((c) => c.spent), [20000, 5000]);
  });

  it('liste les mois incomplets de l’année, pour ne pas laisser croire au total', () => {
    covers(joint, '2026-01-01', '2026-02-28');
    tx('2026-01-10', -10000);

    const y = dashboard('2026-04', TODAY).year;
    assert.deepEqual(y.incompleteMonths, ['2026-03', '2026-04']);
  });
});
