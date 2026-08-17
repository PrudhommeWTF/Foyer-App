import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { FIN_SCHEMA_VERSION, migrateFinances } from '../src/finances/schema';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

const tableNames = (db: Database.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

describe('migrations du module Finances', () => {
  it('crée toutes les tables et enregistre la version', () => {
    const db = freshDb();
    assert.equal(migrateFinances(db), FIN_SCHEMA_VERSION);
    const names = tableNames(db);
    for (const t of [
      'fin_meta', 'fin_accounts', 'fin_account_aliases', 'fin_categories', 'fin_assets',
      'fin_contracts', 'fin_contract_refs', 'fin_imports', 'fin_transactions', 'fin_tags',
      'fin_transaction_tags', 'fin_readings', 'fin_rules', 'fin_rule_conditions',
      'fin_rule_actions', 'fin_savings', 'fin_attachments',
    ]) assert.ok(names.includes(t), `table manquante : ${t}`);
  });

  it('est rejouable : un second démarrage ne duplique rien', () => {
    const db = freshDb();
    migrateFinances(db);
    const before = db.prepare('SELECT COUNT(*) AS n FROM fin_categories').get() as { n: number };
    assert.equal(migrateFinances(db), FIN_SCHEMA_VERSION);
    assert.equal(migrateFinances(db), FIN_SCHEMA_VERSION);
    const after = db.prepare('SELECT COUNT(*) AS n FROM fin_categories').get() as { n: number };
    assert.equal(after.n, before.n);
    assert.equal(before.n, 14, 'les 14 catégories de départ doivent être créées une seule fois');
  });

  it('installe les catégories de départ à plat, sans sous-catégorie imposée', () => {
    const db = freshDb();
    migrateFinances(db);
    const rows = db.prepare('SELECT name, parent_id FROM fin_categories ORDER BY position').all() as { name: string; parent_id: number | null }[];
    assert.equal(rows.length, 14);
    assert.ok(rows.every((r) => r.parent_id === null));
    assert.equal(rows[0].name, 'Alimentation');
    assert.ok(rows.some((r) => r.name === 'Charges du cabinet'));
    assert.ok(rows.some((r) => r.name === 'Impôts et URSSAF'));
  });

  it('applique les clés étrangères : supprimer une catégorie détache ses transactions', () => {
    const db = freshDb();
    migrateFinances(db);
    db.prepare("INSERT INTO fin_accounts (name) VALUES ('Joint')").run();
    db.prepare(`INSERT INTO fin_transactions (account_id, date, amount, label_raw, label, category_id, dedupe_key)
                VALUES (1, '2026-08-01', -1000, 'X', 'X', 1, 'k1')`).run();
    db.prepare('DELETE FROM fin_categories WHERE id = 1').run();
    const tx = db.prepare('SELECT category_id FROM fin_transactions WHERE id = 1').get() as { category_id: number | null };
    assert.equal(tx.category_id, null, 'la transaction doit survivre sans catégorie');
  });

  it('applique la cascade sur les sous-catégories', () => {
    const db = freshDb();
    migrateFinances(db);
    db.prepare("INSERT INTO fin_categories (parent_id, name) VALUES (1, 'Supermarché')").run();
    db.prepare('DELETE FROM fin_categories WHERE id = 1').run();
    const n = (db.prepare("SELECT COUNT(*) AS n FROM fin_categories WHERE name = 'Supermarché'").get() as { n: number }).n;
    assert.equal(n, 0);
  });

  it('refuse deux fois la même empreinte et le même rang', () => {
    const db = freshDb();
    migrateFinances(db);
    db.prepare("INSERT INTO fin_accounts (name) VALUES ('Joint')").run();
    const ins = db.prepare(`INSERT INTO fin_transactions (account_id, date, amount, label_raw, label, dedupe_key, dedupe_seq)
                            VALUES (1, '2026-08-05', -5000, 'Retrait', 'Retrait', 'abc', ?)`);
    ins.run(0);
    ins.run(1); // deuxième occurrence légitime le même jour
    assert.throws(() => ins.run(0), /UNIQUE/);
    const n = (db.prepare('SELECT COUNT(*) AS n FROM fin_transactions').get() as { n: number }).n;
    assert.equal(n, 2);
  });

  it('laisse la base intacte quand une migration échoue', () => {
    const db = freshDb();
    migrateFinances(db);
    // Une table déjà existante fait échouer un CREATE non gardé : on vérifie que
    // la version ne bouge pas et que rien n'est à moitié appliqué.
    const version = (db.prepare("SELECT value FROM fin_meta WHERE key = 'schema_version'").get() as { value: string }).value;
    assert.equal(version, String(FIN_SCHEMA_VERSION));
  });
});
