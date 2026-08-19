// Cahier de recette de l'import : les six anomalies décrites dans
// docs/finances-cahier-de-recette.md, vérifiées sur un extrait anonymisé d'un
// export Bankin' réel (223 lignes brutes pour 95 opérations).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';
import * as imports from '../src/finances/import-repo';
import { parseFile } from '../src/finances/import/parse';
import { resolveAndCollapse, stage } from '../src/finances/import/run';
import { findTransferCandidates } from '../src/finances/import/transfers';
import { splitBlocks } from '../src/finances/import/blocks';

const FIXTURE = path.join(__dirname, 'fixtures', 'bankin-aout.csv');
const bytes = (): Buffer => fs.readFileSync(FIXTURE);

const LABELS = {
  jointA: 'Compte Courant Mme N Dupont OU M T Dupont',
  jointB: 'Compte Courant Mle N Martin OU M T Dupont',
  paul: 'Compte Courant M Paul Dupont',
  marie: 'C/C Eurocompte Confort Mme Marie Dupont',
  pro: 'Compte Courant Professionnel Martin Marie (Ei)',
};

let db: Database.Database;
let acc: Record<string, number>;

function reset(): void {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFinances(db);
  repo.initFinancesRepo(db);
  imports.initImportRepo(db);
  acc = {};
  for (const name of ['Compte joint', 'Compte Paul', 'Compte Marie', 'Cabinet Marie']) {
    acc[name] = repo.createAccount({ name, kind: 'courant', memberId: null, openingBalance: 0, openingDate: null, archived: false }).id;
  }
}

/** Declare the aliases a first import would have made the user declare. */
function declareAliases(): void {
  repo.addAlias(acc['Compte joint'], LABELS.jointA);
  repo.addAlias(acc['Compte joint'], LABELS.jointB);
  repo.addAlias(acc['Compte Paul'], LABELS.paul);
  repo.addAlias(acc['Compte Marie'], LABELS.marie);
  repo.addAlias(acc['Cabinet Marie'], LABELS.pro);
}

/** Full pipeline: parse, resolve, collapse, deduplicate against the database. */
function runImport(buf = bytes(), filename = 'bankin.csv'): { inserted: number; duplicates: number; importId: number; perAccount: ReturnType<typeof stage>['perAccount'] } {
  const parsed = parseFile(buf, filename);
  const importId = imports.createDraft(filename, parsed.format);
  const resolution = resolveAndCollapse(parsed.rows);
  const staged = stage(resolution, imports.existingByKey);
  const inserted = imports.commitImport(importId, staged.rows, staged.coverage);
  return { inserted, duplicates: staged.duplicates, importId, perAccount: staged.perAccount };
}

beforeEach(reset);

describe('anomalie 1 : triplication du compte perso, duplication du joint', () => {
  it('découpe le fichier en blocs contigus, un par section de l’export', () => {
    const parsed = parseFile(bytes(), 'bankin.csv');
    assert.equal(parsed.rows.length, 223, '223 lignes de données');
    const blocks = splitBlocks(parsed.rows);
    assert.deepEqual(blocks.map((b) => b.rows.length), [40, 24, 40, 24, 6, 25, 40, 24]);
    // Les blocs 1 et 3 portent le MÊME libellé : c'est le découpage qui porte
    // l'information, pas le libellé.
    assert.equal(blocks[0].accountLabel, blocks[2].accountLabel);
  });

  it('R1.1 : 223 lignes brutes donnent 95 opérations', () => {
    declareAliases();
    assert.equal(runImport().inserted, 95);
    assert.equal(repo.listTransactions({}).total, 95);
  });

  it('R1.2 : décompte par compte, joint 40, Paul 24, Marie 6, cabinet 25', () => {
    declareAliases();
    runImport();
    assert.equal(repo.listTransactions({ accountId: acc['Compte joint'] }).total, 40);
    assert.equal(repo.listTransactions({ accountId: acc['Compte Paul'] }).total, 24);
    assert.equal(repo.listTransactions({ accountId: acc['Compte Marie'] }).total, 6);
    assert.equal(repo.listTransactions({ accountId: acc['Cabinet Marie'] }).total, 25);
  });

  it('R1.3 : les deux retraits de 50 € du 05/08 survivent tous les deux', () => {
    declareAliases();
    runImport();
    const retraits = repo.listTransactions({ q: 'Retrait Dab Remoulins' }).rows;
    assert.equal(retraits.length, 2, 'le maximum par bloc, et non un ensemble de signatures');
    assert.ok(retraits.every((r) => r.amount === -5000 && r.date === '2026-08-05'));
  });

  it('R1.4 : deux blocs de libellé identique ne produisent pas de doublon', () => {
    declareAliases();
    runImport();
    // Le joint apparaît 120 fois dans le fichier (80 sous un libellé, 40 sous l'autre).
    assert.equal(repo.listTransactions({ accountId: acc['Compte joint'] }).total, 40);
  });

  it('somme les blocs au maximum, pas à l’addition', () => {
    declareAliases();
    const parsed = parseFile(bytes(), 'bankin.csv');
    const resolution = resolveAndCollapse(parsed.rows);
    assert.equal(resolution.collapsed, 223 - 95);
    assert.equal(resolution.unknown.length, 0);
  });
});

describe('anomalie 2 : le compte joint sous deux libellés', () => {
  it('R2.1 : sans alias, l’import signale 5 comptes inconnus et n’écrit rien', () => {
    const parsed = parseFile(bytes(), 'bankin.csv');
    const resolution = resolveAndCollapse(parsed.rows);
    assert.equal(resolution.unknown.length, 5);
    assert.equal(resolution.byAccount.size, 0);
    assert.equal(repo.listTransactions({}).total, 0);
    // Le plus volumineux vient en tête, avec de quoi le reconnaître.
    assert.equal(resolution.unknown[0].label, LABELS.jointA);
    assert.equal(resolution.unknown[0].rows, 80);
    assert.ok(resolution.unknown[0].sample.length > 0);
  });

  it('R2.2 : les deux libellés du joint rattachés au même compte donnent 95', () => {
    declareAliases();
    assert.equal(runImport().inserted, 95);
  });

  it('R2.3 : un libellé inconnu ne crée jamais de compte tout seul', () => {
    const before = repo.listAccounts().length;
    resolveAndCollapse(parseFile(bytes(), 'bankin.csv').rows);
    assert.equal(repo.listAccounts().length, before);
  });

  it('propose le compte qui porte exactement le même nom que le libellé', () => {
    // Un compte nommé comme dans le fichier : l'accent et la casse ne comptent pas.
    const jumeau = repo.createAccount({
      name: 'compte courant  mme n dupont ou m t dupont', kind: 'courant', memberId: null,
      openingBalance: 0, openingDate: null, archived: false,
    }).id;

    const unknown = resolveAndCollapse(parseFile(bytes(), 'bankin.csv').rows).unknown;
    const jointA = unknown.find((u) => u.label === LABELS.jointA)!;
    assert.equal(jointA.suggestedAccountId, jumeau);
    // Les autres libellés ne ressemblent à aucun compte : rien n'est proposé.
    assert.ok(unknown.filter((u) => u.label !== LABELS.jointA).every((u) => u.suggestedAccountId === null));
  });

  it('ne propose ni un compte archivé, ni un nom porté par deux comptes', () => {
    const archive = repo.createAccount({
      name: LABELS.paul, kind: 'courant', memberId: null,
      openingBalance: 0, openingDate: null, archived: true,
    }).id;
    repo.createAccount({ name: LABELS.marie, kind: 'courant', memberId: null, openingBalance: 0, openingDate: null, archived: false });
    repo.createAccount({ name: LABELS.marie, kind: 'epargne', memberId: null, openingBalance: 0, openingDate: null, archived: false });

    const unknown = resolveAndCollapse(parseFile(bytes(), 'bankin.csv').rows).unknown;
    assert.equal(unknown.find((u) => u.label === LABELS.paul)!.suggestedAccountId, null, 'un compte archivé ne se propose pas');
    assert.equal(unknown.find((u) => u.label === LABELS.marie)!.suggestedAccountId, null, 'un nom ambigu ne se propose pas');
    assert.ok(repo.getAccount(archive)!.archived);
  });
});

describe('anomalie 3 : chevauchement des exports', () => {
  it('R3.1 : réimporter le même fichier n’ajoute rien', () => {
    declareAliases();
    assert.equal(runImport().inserted, 95);
    const second = runImport();
    assert.equal(second.inserted, 0);
    assert.equal(second.duplicates, 95);
    assert.equal(repo.listTransactions({}).total, 95);
  });

  it('R3.2 : un export qui chevauche n’apporte que son delta', () => {
    declareAliases();
    // Premier import : le fichier tronqué avant le 28/07, comme l'export de
    // décembre à juillet qui s'arrête ce jour-là.
    const all = fs.readFileSync(FIXTURE, 'utf-8').split('\n');
    const head = all[0];
    const before28 = all.slice(1).filter((l) => l.trim() && !l.startsWith('"28/07/2026"'));
    runImport(Buffer.from([head, ...before28].join('\n'), 'utf-8'), 'partiel.csv');
    const partial = repo.listTransactions({}).total;

    // Second import : le fichier complet, qui recouvre tout le premier.
    const second = runImport();
    assert.equal(second.duplicates, partial, 'tout ce qui était déjà là est écarté');
    assert.equal(repo.listTransactions({}).total, 95);
    // Les 12 opérations du 28/07 sont exactement le delta apporté.
    assert.equal(second.inserted, 12);
    assert.equal(repo.listTransactions({ from: '2026-07-28', to: '2026-07-28' }).total, 12);
  });

  it('R3.3 : l’ordre des deux imports ne change pas le total final', () => {
    declareAliases();
    runImport();
    const all = fs.readFileSync(FIXTURE, 'utf-8').split('\n');
    const partial = [all[0], ...all.slice(1).filter((l) => l.trim() && !l.startsWith('"28/07/2026"'))].join('\n');
    const second = runImport(Buffer.from(partial, 'utf-8'), 'partiel.csv');
    assert.equal(second.inserted, 0);
    assert.equal(repo.listTransactions({}).total, 95);
  });

  it('R3.4 : une opération modifiée à la main ne ressuscite pas au réimport', () => {
    declareAliases();
    runImport();
    const target = repo.listTransactions({ q: 'Carrefour' }).rows[0];
    const alimentation = repo.listCategories().find((c) => c.name === 'Alimentation')!;
    repo.updateTransaction(target.id, {
      accountId: target.accountId, date: target.date, amount: target.amount, kind: target.kind,
      label: 'Courses Carrefour (renommé)', categoryId: alimentation.id, notes: 'vérifié', cleared: true,
    });

    const second = runImport();
    assert.equal(second.inserted, 0, 'le libellé brut porte l’empreinte, pas le libellé affiché');
    assert.equal(repo.listTransactions({}).total, 95);
    const after = repo.getTransaction(target.id)!;
    assert.equal(after.label, 'Courses Carrefour (renommé)');
    assert.equal(after.categoryId, alimentation.id);
  });

  it('reprend la numérotation au-delà du rang le plus élevé déjà stocké', () => {
    declareAliases();
    runImport();
    const retraits = repo.listTransactions({ q: 'Retrait Dab Remoulins' }).rows;
    repo.deleteTransaction(retraits[0].id);
    // Le fichier en porte toujours deux, la base une : une seule est réinsérée.
    const second = runImport();
    assert.equal(second.inserted, 1);
    assert.equal(repo.listTransactions({ q: 'Retrait Dab Remoulins' }).total, 2);
  });
});

describe('anomalie 4 : virements internes', () => {
  const candidates = () => {
    const dates = repo.listTransactions({ limit: 1000 }).rows.map((r) => r.date).sort();
    return findTransferCandidates(imports.transferPool(dates[0], dates[dates.length - 1]));
  };

  it('R4.1 : les trois virements réels sont détectés en confiance forte', () => {
    declareAliases();
    runImport();
    const strong = candidates().filter((c) => c.confidence === 'forte');
    const amounts = strong.map((c) => c.credit.amount).sort((a, b) => a - b);
    assert.deepEqual(amounts, [170000, 200000, 200000]);
    // Libellés différents de chaque côté : c'est le cas réel.
    const two = strong.find((c) => c.credit.amount === 200000 && /Compte Commun/i.test(c.debit.label))!;
    assert.ok(two, 'le virement « Vir Compte Commun » vers le joint est détecté');
    assert.notEqual(two.debit.label, two.credit.label);
    assert.equal(two.daysApart, 0);
  });

  it('R4.2 : le faux rapprochement retrait/remise est classé en confiance faible', () => {
    declareAliases();
    runImport();
    const bogus = candidates().find((c) => /Retrait Dab/i.test(c.debit.label) || /Retrait Dab/i.test(c.credit.label));
    if (bogus) {
      assert.equal(bogus.confidence, 'faible', 'un retrait d’espèces ne peut pas être pré-coché');
    }
    // Aucun rapprochement impliquant un retrait ne doit atteindre la confiance forte.
    assert.ok(!candidates().some((c) => c.confidence === 'forte' && /Retrait Dab|Remcb/i.test(c.debit.label + c.credit.label)));
  });

  it('R4.3 : aucune fusion n’a lieu sans validation explicite', () => {
    declareAliases();
    runImport();
    assert.ok(candidates().length > 0);
    assert.equal(repo.listTransactions({}).rows.filter((t) => t.transferGroup).length, 0);
    assert.equal(repo.listTransactions({}).rows.filter((t) => t.kind === 'virement').length, 0);
  });

  it('R4.4 : après validation, les deux lignes restent et les soldes ne bougent pas', () => {
    declareAliases();
    runImport();
    const before = repo.accountBalances();
    const expenseBefore = repo.monthSummary('2026-08', '2026-08-31').expense;

    const pair = candidates().find((c) => c.confidence === 'forte' && c.credit.amount === 200000)!;
    imports.mergeTransfer(pair.debit.id, pair.credit.id);

    assert.equal(repo.listTransactions({}).total, 95, 'les deux lignes sont conservées');
    assert.deepEqual(repo.accountBalances(), before, 'les soldes de compte sont inchangés');
    const after = repo.monthSummary('2026-08', '2026-08-31');
    assert.equal(after.expense, expenseBefore - 200000, 'le virement sort des dépenses');
    const legs = repo.listTransactions({}).rows.filter((t) => t.transferGroup);
    assert.equal(legs.length, 2);
    assert.equal(legs[0].transferGroup, legs[1].transferGroup);
    assert.ok(legs.every((l) => l.kind === 'virement'));
  });

  it('R4.5 : un virement étiqueté par la banque mais sans contrepartie n’est pas proposé', () => {
    declareAliases();
    runImport();
    // « Vir Loyer » +366 € est rangé en « Virements internes » par Bankin' mais
    // n'a aucune contrepartie : la sous-catégorie du fournisseur n'est pas un critère.
    assert.ok(!candidates().some((c) => /Vir Loyer/i.test(c.credit.label + c.debit.label)));
  });

  it('refuse de fusionner deux lignes du même compte ou de montants différents', () => {
    declareAliases();
    runImport();
    const joint = repo.listTransactions({ accountId: acc['Compte joint'], limit: 5 }).rows;
    assert.throws(() => imports.mergeTransfer(joint[0].id, joint[1].id), /même compte|comptes différents/i);
  });

  it('sépare un virement validé et rend les deux opérations à leur nature', () => {
    declareAliases();
    runImport();
    const pair = candidates().find((c) => c.confidence === 'forte')!;
    const group = imports.mergeTransfer(pair.debit.id, pair.credit.id);
    assert.equal(imports.unmergeTransfer(group), 2);
    assert.equal(repo.getTransaction(pair.debit.id)!.kind, 'depense');
    assert.equal(repo.getTransaction(pair.credit.id)!.kind, 'recette');
  });
});

describe('annulation d’un import', () => {
  it('retire exactement les lignes créées et rend la base à son état précédent', () => {
    declareAliases();
    const first = runImport();
    assert.equal(repo.listTransactions({}).total, 95);
    const { deleted } = imports.undoImport(first.importId);
    assert.equal(deleted, 95);
    assert.equal(repo.listTransactions({}).total, 0);
  });

  it('signale les lignes retouchées à la main avant de proposer l’annulation', () => {
    declareAliases();
    const first = runImport();
    const target = repo.listTransactions({ q: 'Carrefour' }).rows[0];
    repo.updateTransaction(target.id, {
      accountId: target.accountId, date: target.date, amount: target.amount, kind: target.kind,
      label: target.label, categoryId: null, notes: 'annoté', cleared: false,
    });
    const row = imports.getImport(first.importId)!;
    assert.equal(row.liveRows, 95);
    assert.equal(row.editedRows, 1);
  });

  it('ne laisse pas de demi-virement derrière lui', () => {
    declareAliases();
    // Deux imports : on valide un virement, puis on annule celui qui porte une des deux jambes.
    const first = runImport();
    const dates = repo.listTransactions({ limit: 1000 }).rows.map((r) => r.date).sort();
    const pair = findTransferCandidates(imports.transferPool(dates[0], dates[dates.length - 1]))
      .find((c) => c.confidence === 'forte')!;
    imports.mergeTransfer(pair.debit.id, pair.credit.id);

    const { ungrouped } = imports.undoImport(first.importId);
    assert.equal(ungrouped, 0, 'les deux jambes partaient du même import, rien ne survit');
    assert.equal(repo.listTransactions({}).rows.filter((t) => t.transferGroup).length, 0);
  });

  it('rejoue un import annulé sans rien dupliquer', () => {
    declareAliases();
    const first = runImport();
    imports.undoImport(first.importId);
    assert.equal(runImport().inserted, 95);
    assert.equal(repo.listTransactions({}).total, 95);
  });
});

describe('anomalie 5 : couverture des comptes et mois incomplets', () => {
  it('R5.1 : la fenêtre couverte est enregistrée par compte', () => {
    declareAliases();
    const first = runImport();
    const row = imports.getImport(first.importId)!;
    assert.equal(row.coverage.length, 4);
    for (const c of row.coverage) {
      assert.equal(c.from, '2026-07-28');
      assert.equal(c.to, '2026-08-17');
    }
  });

  it('R5.2 : un compte dont la couverture s’arrête avant le mois est signalé', () => {
    declareAliases();
    runImport();
    const tphIt = repo.createAccount({ name: 'TPH-IT', kind: 'pro', memberId: null, openingBalance: 0, openingDate: null, archived: false }).id;
    repo.createTransaction({ accountId: tphIt, date: '2026-03-19', amount: -8900, kind: 'depense', label: 'Prlv Sepa Ovh Sas', categoryId: null, notes: '', cleared: false });
    // Un import de mars couvrait TPH-IT ; sa connexion s'est arrêtée depuis.
    imports.commitImport(imports.createDraft('mars.csv', 'CSV'), [], new Map([[tphIt, { from: '2026-01-01', to: '2026-03-19' }]]));

    const s = repo.monthSummary('2026-08', '2026-08-31');
    assert.equal(s.incomplete, true);
    const flagged = s.missing.find((m) => m.name === 'TPH-IT')!;
    assert.equal(flagged.coveredThrough, '2026-03-19');
  });

  it('R5.3 : archiver le compte éteint l’alerte sans toucher aux totaux', () => {
    declareAliases();
    runImport();
    const tphIt = repo.createAccount({ name: 'TPH-IT', kind: 'pro', memberId: null, openingBalance: 0, openingDate: null, archived: false }).id;
    repo.createTransaction({ accountId: tphIt, date: '2026-03-19', amount: -8900, kind: 'depense', label: 'Ovh', categoryId: null, notes: '', cleared: false });
    imports.commitImport(imports.createDraft('mars.csv', 'CSV'), [], new Map([[tphIt, { from: '2026-01-01', to: '2026-03-19' }]]));
    const expense = repo.monthSummary('2026-08', '2026-08-31').expense;

    repo.updateAccount(tphIt, { name: 'TPH-IT', kind: 'pro', memberId: null, openingBalance: 0, openingDate: null, archived: true });
    // Au 17/08, date de la dernière opération importée, le mois est couvert.
    const s = repo.monthSummary('2026-08', '2026-08-17');
    assert.equal(s.incomplete, false);
    assert.equal(s.expense, expense);
  });

  it('R5.4 : un mois entièrement couvert n’est pas signalé', () => {
    declareAliases();
    runImport();
    // L'import couvre jusqu'au 17/08 : au 17/08, rien ne manque.
    assert.equal(repo.monthSummary('2026-08', '2026-08-17').incomplete, false);
    // Au 31/08 en revanche, les deux dernières semaines n'ont pas été importées,
    // et les chiffres du mois sont donc sous-estimés : il faut le dire.
    const endOfMonth = repo.monthSummary('2026-08', '2026-08-31');
    assert.equal(endOfMonth.incomplete, true);
    assert.equal(endOfMonth.missing.length, 4);
    assert.ok(endOfMonth.missing.every((m) => m.coveredThrough === '2026-08-17'));
  });

  it('un compte dormant couvert par l’import n’est plus signalé à tort', () => {
    declareAliases();
    // Un livret sans aucune opération dans la période, mais présent dans l'import.
    const livret = repo.createAccount({ name: 'LDDS', kind: 'epargne', memberId: null, openingBalance: 1200000, openingDate: null, archived: false }).id;
    repo.createTransaction({ accountId: livret, date: '2025-12-31', amount: 11240, kind: 'recette', label: 'Interets', categoryId: null, notes: '', cleared: false });
    // Sans import le concernant, il n'est pas considéré comme une donnée manquante.
    assert.equal(repo.monthSummary('2026-08', '2026-08-17').incomplete, false);

    // Un import de mars le couvrait, mais s'arrête bien avant le mois affiché.
    imports.commitImport(imports.createDraft('mars.csv', 'CSV'), [], new Map([[livret, { from: '2025-12-01', to: '2026-03-31' }]]));
    const before = repo.monthSummary('2026-08', '2026-08-17');
    assert.equal(before.incomplete, true, 'une couverture trop ancienne est signalée');
    assert.deepEqual(before.missing.map((m) => m.name), ['LDDS']);

    // Le même livret déclaré couvert jusqu'au 17/08 par un import.
    const importId = imports.createDraft('livret.csv', 'CSV');
    imports.commitImport(importId, [], new Map([[livret, { from: '2025-12-01', to: '2026-08-17' }]]));
    assert.equal(repo.monthSummary('2026-08', '2026-08-17').incomplete, false, 'la couverture déclarée fait foi');
  });

  it('ne signale pas le mois en cours comme incomplet à cause des jours à venir', () => {
    declareAliases();
    runImport();
    // Nous sommes le 17/08 : la couverture s'arrête ce jour-là, ce qui est normal.
    assert.equal(repo.monthSummary('2026-08', '2026-08-17').incomplete, false);
  });
});

describe('anomalie 6 : catégories du fournisseur', () => {
  it('les catégories Bankin ne sont pas appliquées automatiquement', () => {
    declareAliases();
    runImport();
    // Les quatre prélèvements AXA sont tous rangés en « Auto & Transports » par
    // Bankin'. Aucun n'est catégorisé à l'import : c'est le moteur de règles
    // (tranche 3) qui tranchera, par montant.
    const axa = repo.listTransactions({ q: 'Prlv Sepa Axa' }).rows;
    assert.equal(axa.length, 4);
    assert.ok(axa.every((t) => t.categoryId === null));
    // Trois d'entre eux portent un libellé rigoureusement identique.
    const identical = axa.filter((t) => t.label === 'Prlv Sepa Axa');
    assert.equal(identical.length, 3);
    assert.deepEqual(identical.map((t) => t.amount).sort((a, b) => a - b), [-63546, -8169, -4063].sort((a, b) => a - b));
  });

  it('conserve le libellé brut, mojibake de la banque compris', () => {
    declareAliases();
    runImport();
    // « N?mes » vient de la banque : le réparer ferait bouger l'empreinte.
    const nimes = repo.listTransactions({ q: 'Spl Eclat Muroma' }).rows;
    assert.equal(nimes.length, 2);
    assert.ok(nimes.every((t) => t.labelRaw.includes('N?mes')));
  });
});

describe('avertissement avant annulation', () => {
  it('ne compte pas la validation d’un virement comme une retouche manuelle', () => {
    declareAliases();
    const first = runImport();
    const dates = repo.listTransactions({ limit: 1000 }).rows.map((r) => r.date).sort();
    const pair = findTransferCandidates(imports.transferPool(dates[0], dates[dates.length - 1]))
      .find((c) => c.confidence === 'forte')!;
    imports.mergeTransfer(pair.debit.id, pair.credit.id);

    // Grouper deux lignes est un changement de structure, pas une retouche du
    // contenu : l'avertissement « ces modifications seront perdues » doit rester juste.
    assert.equal(imports.getImport(first.importId)!.editedRows, 0);

    const target = repo.listTransactions({ q: 'Carrefour' }).rows[0];
    repo.updateTransaction(target.id, {
      accountId: target.accountId, date: target.date, amount: target.amount, kind: target.kind,
      label: 'Renommé', categoryId: null, notes: '', cleared: false,
    });
    assert.equal(imports.getImport(first.importId)!.editedRows, 1);
  });
});
