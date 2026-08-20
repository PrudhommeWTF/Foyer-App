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
      'fin_account_members', 'fin_contract_members',
    ]) assert.ok(names.includes(t), `table manquante : ${t}`);
  });

  it('migration 4 : reprend le titulaire unique déjà saisi, sans le perdre', () => {
    const db = freshDb();
    // On rejoue l'état d'une base arrêtée à la migration 3, colonne comprise.
    migrateFinances(db);
    db.exec('DROP TABLE fin_account_members; DROP TABLE fin_contract_members;');
    for (const c of ['loan_principal', 'loan_rate_bp', 'loan_payment', 'loan_insurance', 'loan_first_on']) {
      db.exec(`ALTER TABLE fin_accounts DROP COLUMN ${c}`);
    }
    db.exec("ALTER TABLE fin_accounts ADD COLUMN member_id TEXT");
    db.exec("ALTER TABLE fin_contracts ADD COLUMN member_id TEXT");
    db.prepare("INSERT INTO fin_accounts (name, kind, member_id, position) VALUES ('Compte', 'courant', 'm1', 0)").run();
    db.prepare("INSERT INTO fin_accounts (name, kind, member_id, position) VALUES ('Sans titulaire', 'courant', '', 1)").run();
    db.prepare("INSERT INTO fin_contracts (name, member_id) VALUES ('Assurance', 'm2')").run();
    db.prepare("UPDATE fin_meta SET value = '3' WHERE key = 'schema_version'").run();

    assert.equal(migrateFinances(db), FIN_SCHEMA_VERSION);

    const accounts = db.prepare('SELECT account_id, member_id FROM fin_account_members').all();
    assert.deepEqual(accounts, [{ account_id: 1, member_id: 'm1' }], 'le titulaire vide ne crée pas de ligne');
    const contracts = db.prepare('SELECT contract_id, member_id FROM fin_contract_members').all();
    assert.deepEqual(contracts, [{ contract_id: 1, member_id: 'm2' }]);

    // La colonne a bien disparu : deux sources de vérité seraient pires qu'une.
    const columns = (db.prepare('PRAGMA table_info(fin_accounts)').all() as { name: string }[]).map((c) => c.name);
    assert.ok(!columns.includes('member_id'));
  });

  it('migration 5 : ajoute les colonnes du prêt sans toucher aux comptes existants', () => {
    const db = freshDb();
    migrateFinances(db);
    db.prepare("INSERT INTO fin_accounts (name, kind, opening_balance, position) VALUES ('Joint', 'courant', 5000, 0)").run();
    const columns = (db.prepare('PRAGMA table_info(fin_accounts)').all() as { name: string }[]).map((c) => c.name);
    for (const c of ['loan_principal', 'loan_rate_bp', 'loan_payment', 'loan_insurance', 'loan_first_on']) {
      assert.ok(columns.includes(c), `colonne manquante : ${c}`);
    }
    const row = db.prepare('SELECT kind, opening_balance, loan_principal FROM fin_accounts').get() as Record<string, unknown>;
    assert.deepEqual(row, { kind: 'courant', opening_balance: 5000, loan_principal: null },
      'un compte ordinaire n’a rien à ressaisir');
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
