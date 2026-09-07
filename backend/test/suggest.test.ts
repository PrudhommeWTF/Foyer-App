// Catégorisation suggérée : la clé « marchand », le choix majoritaire prudent,
// et la mémoire apprise des seules catégorisations manuelles.
import assert from 'node:assert/strict';
import fsp from 'node:fs';
import os from 'node:os';
import tmpPath from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFinances } from '../src/finances/schema';
import { initBlobs } from '../src/storage/blobs';
import * as repo from '../src/finances/repo';
import * as rules from '../src/finances/rules-repo';
import * as imports from '../src/finances/import-repo';
import { importSuggestions, suggestCategory } from '../src/finances/suggest-repo';
import { KeyedTx, merchantKey, pickCategory } from '../src/finances/suggest';

const tmpDir = (): string => fsp.mkdtempSync(tmpPath.join(os.tmpdir(), 'foyer-test-'));

describe('merchantKey', () => {
  it('regroupe deux passages du même commerçant malgré dates et références', () => {
    const a = merchantKey('CB CARREFOUR CITY 1234 DU 07/09');
    const b = merchantKey('CB CARREFOUR CITY 5678 DU 03/10/2026');
    assert.equal(a, b);
    assert.equal(a, 'CARREFOUR CITY');
  });
  it('distingue deux commerçants différents', () => {
    assert.notEqual(merchantKey('PAIEMENT CB BOULANGERIE PAUL'), merchantKey('PAIEMENT CB CARREFOUR'));
  });
  it('rend une clé vide pour un libellé sans lettres', () => {
    assert.equal(merchantKey('   1234  07/09 '), '');
  });
});

describe('pickCategory', () => {
  const rows: KeyedTx[] = [
    { key: 'CARREFOUR', categoryId: 5 }, { key: 'CARREFOUR', categoryId: 5 },
    { key: 'CARREFOUR', categoryId: 5 }, { key: 'CARREFOUR', categoryId: 6 },
    { key: 'AUTRE', categoryId: 9 },
  ];
  it('rend la catégorie franchement majoritaire au-dessus du seuil', () => {
    assert.deepEqual(pickCategory('CARREFOUR', rows, 2), { categoryId: 5, seen: 3, total: 4 });
  });
  it('ne propose rien en dessous du seuil de confiance', () => {
    assert.equal(pickCategory('CARREFOUR', rows, 4), null); // 3 < 4
  });
  it('ne propose rien quand deux catégories sont à égalité', () => {
    const tie: KeyedTx[] = [{ key: 'K', categoryId: 1 }, { key: 'K', categoryId: 2 }];
    assert.equal(pickCategory('K', tie, 1), null);
  });
  it('ne propose rien pour un marchand inconnu', () => {
    assert.equal(pickCategory('INCONNU', rows, 1), null);
  });
});

describe('suggestCategory (repo)', () => {
  let db: Database.Database;
  let accId: number;
  let courses: number;
  let resto: number;

  const addTx = (label: string, categoryId: number | null, over: Partial<Parameters<typeof repo.createTransaction>[0]> = {}) =>
    repo.createTransaction({ accountId: accId, date: '2026-09-05', amount: -1500, kind: 'depense', label, categoryId, notes: '', cleared: false, ...over });

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateFinances(db);
    initBlobs(tmpDir());
    repo.initFinancesRepo(db);
    accId = repo.createAccount({ name: 'Courant', kind: 'courant', memberIds: [], openingBalance: 0, openingDate: null, archived: false }).id;
    courses = repo.createCategory({ parentId: null, name: 'Courses', monthlyBudget: 0, color: '#7A9B76', icon: 'facture' }).id;
    resto = repo.createCategory({ parentId: null, name: 'Restaurant', monthlyBudget: 0, color: '#E56B4E', icon: 'facture' }).id;
  });

  it('apprend d’un marchand catégorisé à la main et le propose', () => {
    addTx('CB CARREFOUR CITY 111 DU 01/09', courses);
    addTx('CB CARREFOUR CITY 222 DU 08/09', courses);
    assert.equal(suggestCategory('CB CARREFOUR CITY 999 DU 20/09', 2)?.categoryId, courses);
  });

  it('reste muet sous le seuil', () => {
    addTx('CB CARREFOUR CITY 111 DU 01/09', courses);
    assert.equal(suggestCategory('CB CARREFOUR CITY 999', 2), null);
  });

  it('ignore les opérations catégorisées par une règle', () => {
    const t1 = addTx('CB CARREFOUR CITY 111', courses);
    const ruleId = rules.createRule({
      name: 'r', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'CARREFOUR', value2: '' }],
      actions: [{ kind: 'category', value: String(courses) }],
    }).id;
    const t2 = addTx('CB CARREFOUR CITY 222', courses);
    db.prepare('UPDATE fin_transactions SET rule_id = ? WHERE id = ?').run(ruleId, t2.id);
    // Une seule catégorisation manuelle (t1) : la ligne posée par la règle (t2) ne compte pas.
    void t1;
    assert.equal(suggestCategory('CB CARREFOUR CITY 333', 2), null);
  });

  it('ignore les virements et les opérations sans catégorie', () => {
    addTx('CB CARREFOUR CITY 111', courses);
    addTx('CB CARREFOUR CITY 222', null);
    addTx('CB CARREFOUR CITY 333', resto, { kind: 'virement' });
    assert.equal(suggestCategory('CB CARREFOUR CITY 999', 2), null); // une seule manuelle valable
  });

  it('propose en lot les lignes non catégorisées d’un import', () => {
    // Mémoire : deux passages Carrefour rangés à la main en Courses.
    addTx('CB CARREFOUR CITY 111 DU 01/09', courses);
    addTx('CB CARREFOUR CITY 222 DU 08/09', courses);
    // Un import dont une ligne est sans catégorie (même marchand) et une autre inconnue.
    const importId = imports.createDraft('releve.csv', 'csv');
    const attach = (id: number) => db.prepare('UPDATE fin_transactions SET import_id = ? WHERE id = ?').run(importId, id);
    const a = addTx('CB CARREFOUR CITY 777 DU 20/09', null); attach(a.id);
    const b = addTx('VIR SALAIRE ACME 999', null); attach(b.id); // marchand inconnu : pas de suggestion
    const sug = importSuggestions(importId, 2);
    assert.equal(sug.length, 1);
    assert.equal(sug[0].id, a.id);
    assert.equal(sug[0].categoryId, courses);
    // Une catégorisation en lot rend la ligne manuelle et vide la suggestion suivante.
    assert.equal(repo.setCategoriesManual([{ id: a.id, categoryId: courses }]), 1);
    assert.equal(importSuggestions(importId, 2).length, 0);
  });
});
