import assert from 'node:assert/strict';
import fsp from 'node:fs';
import os from 'node:os';
import tmpPath from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFinances } from '../src/finances/schema';
import { commitImport, createDraft } from '../src/finances/import-repo';
import * as repo from '../src/finances/repo';

/** Un répertoire jetable par base : les pièces jointes écrivent sur disque. */
const tmpDir = (): string => fsp.mkdtempSync(tmpPath.join(os.tmpdir(), 'foyer-test-'));

let db: Database.Database;

function reset(): void {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFinances(db);
  repo.initFinancesRepo(db, tmpDir());
}

const account = (name: string, over: Partial<repo.AccountInput> = {}): number =>
  repo.createAccount({ name, kind: 'courant', memberIds: [], openingBalance: 0, openingDate: null, archived: false, ...over }).id;

const tx = (accountId: number, date: string, amount: number, label: string, over: Partial<repo.TxInput> = {}): number =>
  repo.createTransaction({
    accountId, date, amount, kind: amount < 0 ? 'depense' : 'recette',
    label, categoryId: null, notes: '', cleared: false, ...over,
  }).id;

const categoryId = (name: string): number => repo.listCategories().find((c) => c.name === name)!.id;

beforeEach(reset);

describe('comptes', () => {
  it('accepte plusieurs titulaires, et se souvient de leur ordre', () => {
    const id = account('Compte joint', { memberIds: ['m1', 'm2'] });
    assert.deepEqual(repo.getAccount(id)!.memberIds, ['m1', 'm2']);

    repo.updateAccount(id, { name: 'Compte joint', kind: 'courant', memberIds: ['m2', 'm3'], openingBalance: 0, openingDate: null, archived: false });
    assert.deepEqual(repo.getAccount(id)!.memberIds, ['m2', 'm3'], 'la liste est remplacée, pas complétée');

    repo.updateAccount(id, { name: 'Compte joint', kind: 'courant', memberIds: [], openingBalance: 0, openingDate: null, archived: false });
    assert.deepEqual(repo.getAccount(id)!.memberIds, [], 'un compte sans titulaire précis reste possible');
  });

  it('emporte ses titulaires quand il est supprimé', () => {
    const id = account('Éphémère', { memberIds: ['m1'] });
    repo.deleteAccount(id);
    const restants = (db.prepare('SELECT COUNT(*) AS n FROM fin_account_members WHERE account_id = ?').get(id) as { n: number }).n;
    assert.equal(restants, 0);
  });

  it('crée, met à jour et liste les comptes', () => {
    const id = account('Compte joint', { kind: 'courant', memberIds: ['me'], openingBalance: 150000, openingDate: '2025-12-01' });
    const a = repo.getAccount(id)!;
    assert.equal(a.name, 'Compte joint');
    assert.equal(a.openingBalance, 150000);
    assert.deepEqual(a.memberIds, ['me']);

    repo.updateAccount(id, { name: 'Compte joint (BPACA)', kind: 'courant', memberIds: ['me'], openingBalance: 150000, openingDate: '2025-12-01', archived: true });
    assert.equal(repo.getAccount(id)!.name, 'Compte joint (BPACA)');
    assert.equal(repo.getAccount(id)!.archived, true);
  });

  it('calcule le solde comme ouverture plus opérations', () => {
    const joint = account('Joint', { openingBalance: 100000 });
    const livret = account('LDDS', { kind: 'epargne', openingBalance: 500000 });
    tx(joint, '2026-08-05', -5000, 'Retrait Dab Remoulins Brinks');
    tx(joint, '2026-08-05', -5000, 'Retrait Dab Remoulins Brinks');
    tx(joint, '2026-08-08', 170000, 'Correction Virement Rejete');

    const balances = repo.accountBalances();
    assert.equal(balances[joint], 100000 - 5000 - 5000 + 170000);
    assert.equal(balances[livret], 500000, 'un compte sans opération garde son solde d’ouverture');
  });

  it('n’ajoute que les opérations postérieures quand le solde porte une date', () => {
    const joint = account('Joint', { openingBalance: 100000, openingDate: '2026-08-20' });
    tx(joint, '2026-01-10', -30000, 'Vieille dépense');
    tx(joint, '2026-08-20', -2000, 'Course du jour même');
    tx(joint, '2026-08-21', -1500, 'Lendemain');

    assert.equal(repo.accountBalances()[joint], 100000 - 1500,
      'le solde saisi contient déjà le jour même et tout ce qui précède');
    assert.equal(repo.opsBeforeOpening()[joint], 2, 'les deux opérations écartées sont signalées');
  });

  it('sans date, le solde d’ouverture s’ajoute à tout l’historique', () => {
    const joint = account('Joint', { openingBalance: 100000 });
    tx(joint, '2020-01-10', -30000, 'Très vieille dépense');
    assert.equal(repo.accountBalances()[joint], 70000);
    assert.equal(repo.opsBeforeOpening()[joint], undefined, 'rien à signaler sans date');
  });

  it('un solde daté sans opération antérieure ne signale rien', () => {
    const joint = account('Joint', { openingBalance: 100000, openingDate: '2026-08-20' });
    tx(joint, '2026-08-25', 5000, 'Après');
    assert.equal(repo.accountBalances()[joint], 105000);
    assert.equal(repo.opsBeforeOpening()[joint], undefined);
  });

  it('reporte la couverture par compte', () => {
    const tphIt = account('TPH-IT');
    const livret = account('Livret enfant', { kind: 'epargne' });
    tx(tphIt, '2026-01-15', -1000, 'A');
    tx(tphIt, '2026-03-19', -1000, 'B');
    tx(livret, '2025-12-31', 2500, 'Intérêts');

    const cov = repo.accountCoverage();
    const t = cov.find((c) => c.accountId === tphIt)!;
    assert.equal(t.firstDate, '2026-01-15');
    assert.equal(t.lastDate, '2026-03-19');
    assert.equal(t.count, 2);
    assert.equal(cov.find((c) => c.accountId === livret)!.lastDate, '2025-12-31');
  });
});

describe('alias de compte', () => {
  it('résout plusieurs libellés vers le même compte réel', () => {
    const joint = account('Compte joint');
    repo.addAlias(joint, "Compte Courant Mme N Prud Homme OU M T Prud'Homme");
    repo.addAlias(joint, "Compte Courant Mle N Favier OU M T Prud'Homme");

    assert.equal(repo.findAccountByAlias("Compte Courant Mme N Prud Homme OU M T Prud'Homme"), joint);
    assert.equal(repo.findAccountByAlias("Compte Courant Mle N Favier OU M T Prud'Homme"), joint);
    assert.equal(repo.listAliases().length, 2);
  });

  it('ignore casse, accents et espaces superflus', () => {
    const joint = account('Compte joint');
    repo.addAlias(joint, 'C/C Eurocompte Confort Mme Nolwenn Prud Homme');
    assert.equal(repo.findAccountByAlias('  c/c   EUROCOMPTE confort mme nolwenn prud homme '), joint);
  });

  it('renvoie null sur un libellé inconnu, sans créer de compte', () => {
    account('Compte joint');
    assert.equal(repo.findAccountByAlias('Compte Courant Professionnel Favier Nolwenn (Ei)'), null);
    assert.equal(repo.listAccounts().length, 1);
  });

  it('réaffecter un alias existant le déplace au lieu de le dupliquer', () => {
    const a = account('A');
    const b = account('B');
    repo.addAlias(a, 'Libellé banque');
    repo.addAlias(b, 'Libellé banque');
    assert.equal(repo.listAliases().length, 1);
    assert.equal(repo.findAccountByAlias('Libellé banque'), b);
  });
});

describe('catégories', () => {
  it('accepte deux niveaux', () => {
    const alim = categoryId('Alimentation');
    const sub = repo.createCategory({ parentId: alim, name: 'Supermarché', monthlyBudget: 60000, color: '#7A9B76', icon: 'panier' });
    assert.equal(sub.parentId, alim);
    assert.equal(repo.countChildren(alim), 1);
  });

  it('supprimer une parente emporte ses filles et détache les transactions', () => {
    const alim = categoryId('Alimentation');
    const sub = repo.createCategory({ parentId: alim, name: 'Supermarché', monthlyBudget: 0, color: '#7A9B76', icon: 'panier' });
    const a = account('Joint');
    const t = tx(a, '2026-08-06', -3811, 'CB Remoulins Carrefour Marke', { categoryId: sub.id });

    repo.deleteCategory(alim);
    assert.equal(repo.getCategory(sub.id), null);
    assert.equal(repo.getTransaction(t)!.categoryId, null);
    assert.equal(repo.getTransaction(t)!.amount, -3811, 'la transaction elle-même est conservée');
  });
});

describe('transactions', () => {
  it('filtre par période, compte, catégorie et recherche', () => {
    const joint = account('Joint');
    const perso = account('Perso');
    const loisirs = categoryId('Loisirs et vacances');
    tx(joint, '2026-08-05', -6000, 'Paiement Psc Carcassonn Chateau Comtal', { categoryId: loisirs });
    tx(joint, '2026-08-06', -3811, 'CB Remoulins Carrefour Marke');
    tx(perso, '2026-07-28', 350000, 'Remuneration');

    assert.equal(repo.listTransactions({ from: '2026-08-01', to: '2026-08-31' }).total, 2);
    assert.equal(repo.listTransactions({ accountId: perso }).total, 1);
    assert.equal(repo.listTransactions({ categoryId: loisirs }).total, 1);
    assert.equal(repo.listTransactions({ uncategorised: true }).total, 2);
    assert.equal(repo.listTransactions({ q: 'carrefour' }).total, 1, 'la recherche ignore la casse');
    assert.equal(repo.listTransactions({ q: 'chateau' }).total, 1);
    assert.equal(repo.listTransactions({ q: 'château' }).total, 1, 'la recherche ignore les accents');
  });

  it('trie du plus récent au plus ancien et pagine', () => {
    const a = account('Joint');
    for (let d = 1; d <= 5; d++) tx(a, `2026-08-0${d}`, -100 * d, `Op ${d}`);
    const page1 = repo.listTransactions({ limit: 2 });
    assert.equal(page1.total, 5);
    assert.deepEqual(page1.rows.map((r) => r.date), ['2026-08-05', '2026-08-04']);
    const page2 = repo.listTransactions({ limit: 2, offset: 2 });
    assert.deepEqual(page2.rows.map((r) => r.date), ['2026-08-03', '2026-08-02']);
  });

  it('donne une empreinte unique aux saisies manuelles, jamais dédoublonnées', () => {
    const a = account('Joint');
    // Deux retraits identiques le même jour : le cas réel du 05/08 sur le joint.
    const t1 = tx(a, '2026-08-05', -5000, 'Retrait Dab Remoulins Brinks');
    const t2 = tx(a, '2026-08-05', -5000, 'Retrait Dab Remoulins Brinks');
    assert.notEqual(t1, t2);
    assert.equal(repo.listTransactions({}).total, 2);
  });

  it('produit une empreinte d’import stable et sensible à chaque composante', () => {
    const base = repo.dedupeKey(1, '2026-08-05', -5000, 'Retrait Dab Remoulins Brinks');
    assert.equal(base, repo.dedupeKey(1, '2026-08-05', -5000, '  retrait   dab remoulins brinks '));
    assert.notEqual(base, repo.dedupeKey(2, '2026-08-05', -5000, 'Retrait Dab Remoulins Brinks'));
    assert.notEqual(base, repo.dedupeKey(1, '2026-08-06', -5000, 'Retrait Dab Remoulins Brinks'));
    assert.notEqual(base, repo.dedupeKey(1, '2026-08-05', -5001, 'Retrait Dab Remoulins Brinks'));
  });
});

describe('synthèse mensuelle', () => {
  it('additionne recettes et dépenses du mois', () => {
    const joint = account('Joint');
    tx(joint, '2026-08-05', -6000, 'Chateau Comtal');
    tx(joint, '2026-08-06', -3811, 'Carrefour');
    tx(joint, '2026-08-08', 170000, 'Correction Virement Rejete');
    tx(joint, '2026-07-31', -15000, 'Cheque'); // hors mois

    const s = repo.monthSummary('2026-08');
    assert.equal(s.expense, 9811);
    assert.equal(s.income, 170000);
    assert.equal(s.balance, 170000 - 9811);
  });

  it('exclut les virements internes des recettes et des dépenses', () => {
    const perso = account('Perso');
    const joint = account('Joint');
    // Le virement réel du 05/08 : 2 000 € du perso vers le joint.
    tx(perso, '2026-08-05', -200000, 'Vir Compte Commun', { kind: 'virement' });
    tx(joint, '2026-08-05', 200000, 'Vir De M Prud Homme Thomas', { kind: 'virement' });
    tx(joint, '2026-08-06', -3811, 'Carrefour');

    const s = repo.monthSummary('2026-08');
    assert.equal(s.expense, 3811, 'le virement ne doit pas gonfler les dépenses');
    assert.equal(s.income, 0, 'ni les recettes');
    // Les deux lignes restent en base : les soldes de compte doivent rester justes.
    assert.equal(repo.listTransactions({}).total, 3);
    assert.equal(repo.accountBalances()[perso], -200000);
    assert.equal(repo.accountBalances()[joint], 200000 - 3811);
  });

  it('remonte les dépenses d’une sous-catégorie sur sa parente', () => {
    const alim = categoryId('Alimentation');
    const sub = repo.createCategory({ parentId: alim, name: 'Supermarché', monthlyBudget: 0, color: '#7A9B76', icon: 'panier' });
    const joint = account('Joint');
    tx(joint, '2026-08-06', -3811, 'Carrefour', { categoryId: sub.id });
    tx(joint, '2026-08-04', -15890, 'Carrefour', { categoryId: alim });

    const s = repo.monthSummary('2026-08');
    const line = s.categories.find((c) => c.categoryId === alim)!;
    assert.equal(line.spent, 3811 + 15890);
    assert.ok(!s.categories.some((c) => c.name === 'Supermarché'), 'une sous-catégorie n’a pas sa propre ligne');
  });

  it('regroupe les dépenses sans catégorie dans une ligne dédiée', () => {
    const joint = account('Joint');
    tx(joint, '2026-08-06', -3811, 'Carrefour');
    const s = repo.monthSummary('2026-08');
    const sans = s.categories.find((c) => c.categoryId === null)!;
    assert.equal(sans.name, 'Sans catégorie');
    assert.equal(sans.spent, 3811);
  });

  it('n’ajoute pas de ligne « sans catégorie » quand tout est classé', () => {
    const joint = account('Joint');
    tx(joint, '2026-08-06', -3811, 'Carrefour', { categoryId: categoryId('Alimentation') });
    assert.ok(!repo.monthSummary('2026-08').categories.some((c) => c.categoryId === null));
  });

  it('signale un mois incomplet en nommant le compte et sa date d’arrêt', () => {
    const joint = account('Joint');
    const tphIt = account('TPH-IT');
    tx(joint, '2026-04-10', -3811, 'Carrefour');
    tx(tphIt, '2026-03-19', -1000, 'Dernière opération connue');
    // Les deux comptes ont été importés ; la connexion de TPH-IT s'est arrêtée
    // au 19/03, il n'apparaît donc plus dans les imports suivants.
    commitImport(createDraft('mars.csv', 'CSV'), [], new Map([
      [joint, { from: '2026-01-01', to: '2026-04-30' }],
      [tphIt, { from: '2026-01-01', to: '2026-03-19' }],
    ]));

    const s = repo.monthSummary('2026-04', '2026-04-10');
    assert.equal(s.incomplete, true);
    assert.equal(s.missing.length, 1);
    assert.equal(s.missing[0].name, 'TPH-IT');
    assert.equal(s.missing[0].coveredThrough, '2026-03-19');
  });

  it('une couverture déclarée par un import prime sur la dernière opération', () => {
    const joint = account('Joint');
    const livret = account('LDDS', { kind: 'epargne' });
    tx(joint, '2026-04-10', -3811, 'Carrefour');
    tx(livret, '2025-12-31', 11240, 'Intérêts annuels');

    // Un premier import couvre le joint jusqu'en avril, le livret jusqu'en décembre.
    commitImport(createDraft('ancien.csv', 'CSV'), [], new Map([
      [joint, { from: '2025-12-01', to: '2026-04-30' }],
      [livret, { from: '2025-12-01', to: '2025-12-31' }],
    ]));
    const before = repo.monthSummary('2026-04', '2026-04-10');
    assert.equal(before.incomplete, true);
    assert.deepEqual(before.missing.map((m) => m.name), ['LDDS']);

    // Le livret ne bouge que deux fois par an : une fois couvert jusqu'en avril,
    // il n'a plus à être signalé comme une donnée manquante malgré son immobilité.
    commitImport(createDraft('recent.csv', 'CSV'), [], new Map([[livret, { from: '2026-01-01', to: '2026-04-30' }]]));
    assert.equal(repo.monthSummary('2026-04', '2026-04-10').incomplete, false);
  });

  it('archiver un compte éteint l’alerte sans toucher aux totaux passés', () => {
    const joint = account('Joint');
    const tphIt = account('TPH-IT');
    tx(joint, '2026-04-10', -3811, 'Carrefour');
    tx(tphIt, '2026-03-19', -1000, 'Dernière opération connue');
    commitImport(createDraft('mars.csv', 'CSV'), [], new Map([
      [joint, { from: '2026-01-01', to: '2026-04-30' }],
      [tphIt, { from: '2026-01-01', to: '2026-03-19' }],
    ]));

    const before = repo.monthSummary('2026-03', '2026-03-31');
    repo.updateAccount(tphIt, { name: 'TPH-IT', kind: 'courant', memberIds: [], openingBalance: 0, openingDate: null, archived: true });

    assert.equal(repo.monthSummary('2026-04', '2026-04-10').incomplete, false);
    assert.equal(repo.monthSummary('2026-03', '2026-03-31').expense, before.expense, 'les totaux historiques sont inchangés');
    assert.equal(repo.listTransactions({ accountId: tphIt }).total, 1, 'l’historique est conservé');
  });

  it('ne signale rien quand tous les comptes actifs couvrent le mois', () => {
    const joint = account('Joint');
    const perso = account('Perso');
    tx(joint, '2026-08-10', -3811, 'Carrefour');
    tx(perso, '2026-08-28', 350000, 'Remuneration');
    const s = repo.monthSummary('2026-08', '2026-08-28');
    assert.equal(s.incomplete, false);
    assert.deepEqual(s.missing, []);
  });

  it('ne signale jamais un compte que l’on n’a jamais importé', () => {
    const joint = account('Joint');
    const perso = account('Perso');
    tx(joint, '2026-08-10', -3811, 'Carrefour');
    tx(perso, '2026-08-01', 350000, 'Remuneration');
    // Saisie manuelle uniquement : aucun import n'a affirmé couvrir la période,
    // il n'y a donc rien à signaler comme manquant.
    assert.equal(repo.monthSummary('2026-08', '2026-08-28').incomplete, false);
  });

  it('ignore un compte encore vierge de toute opération', () => {
    const joint = account('Joint');
    account('Compte tout juste créé');
    tx(joint, '2026-08-10', -3811, 'Carrefour');
    assert.equal(repo.monthSummary('2026-08', '2026-08-10').incomplete, false);
  });

  it('liste les mois qui portent des données, du plus récent au plus ancien', () => {
    const joint = account('Joint');
    tx(joint, '2026-08-10', -100, 'A');
    tx(joint, '2026-07-28', -100, 'B');
    tx(joint, '2025-12-31', -100, 'C');
    assert.deepEqual(repo.availableMonths(), ['2026-08', '2026-07', '2025-12']);
  });
});

describe('export CSV', () => {
  it('exporte toutes les opérations avec un BOM et un séparateur point-virgule', () => {
    const joint = account('Compte joint');
    const alim = categoryId('Alimentation');
    const sub = repo.createCategory({ parentId: alim, name: 'Supermarché', monthlyBudget: 0, color: '#7A9B76', icon: 'panier' });
    tx(joint, '2026-08-06', -3811, 'CB Remoulins Carrefour Marke', { categoryId: sub.id });
    tx(joint, '2026-08-08', 170000, 'Correction Virement Rejete');

    const csv = repo.exportCsv();
    assert.ok(csv.startsWith('﻿'), 'le BOM permet à Excel FR d’ouvrir le fichier sans boîte de dialogue');
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.ok(lines[0].startsWith('"Date";"Libellé"'));
    // Trié du plus récent au plus ancien, comme la liste des transactions.
    assert.ok(lines[1].startsWith('"2026-08-08"'), lines[1]);
    assert.ok(lines[1].includes('"1700.00"'), lines[1]);
    // Une sous-catégorie s'écrit (parente ; fille).
    assert.ok(lines[2].includes('"Alimentation";"Supermarché"'), lines[2]);
    assert.ok(lines[2].includes('"-38.11"'), lines[2]);
  });

  it('échappe les guillemets et conserve les points-virgules d’un libellé', () => {
    const joint = account('Joint');
    tx(joint, '2026-08-06', -1000, 'Libellé "curieux" ; avec séparateur');
    const line = repo.exportCsv().split('\r\n')[1];
    assert.ok(line.includes('"Libellé ""curieux"" ; avec séparateur"'), line);
  });

  it('exporte un fichier vide mais valide quand il n’y a rien', () => {
    const csv = repo.exportCsv().replace('﻿', '').trim();
    assert.equal(csv.split('\r\n').length, 1);
  });
});
