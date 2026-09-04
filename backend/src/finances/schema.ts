// Finances module schema. Unlike the rest of the household (a single JSON
// document in `household`), finances live in dedicated relational tables so
// thousands of transactions can be filtered, aggregated and written granularly.
//
// Migrations are versioned and applied at boot, in order, each inside its own
// transaction. `fin_meta.schema_version` records the last applied version, so a
// second boot is a no-op. Never edit a shipped migration: add a new one.
import type { Database } from 'better-sqlite3';
import { log } from '../log';

/** Money is stored as signed integer cents: no floating-point drift on 6000 rows. */
export const FIN_SCHEMA_VERSION = 5;

interface Migration { version: number; label: string; up: (db: Database) => void; }

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    label: 'tables du module Finances',
    up: (db) => {
      db.exec(`
        CREATE TABLE fin_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'courant',
          member_id TEXT,
          opening_balance INTEGER NOT NULL DEFAULT 0,
          opening_date TEXT,
          archived INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Several export labels can designate the same real account (name change,
        -- one account synced through several bank connections).
        CREATE TABLE fin_account_aliases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL REFERENCES fin_accounts(id) ON DELETE CASCADE,
          label_norm TEXT NOT NULL UNIQUE,
          label_raw TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE fin_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          parent_id INTEGER REFERENCES fin_categories(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          monthly_budget INTEGER NOT NULL DEFAULT 0,
          color TEXT NOT NULL DEFAULT '#7A9B76',
          icon TEXT NOT NULL DEFAULT 'facture',
          position INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE fin_assets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'immobilier',
          status TEXT NOT NULL DEFAULT 'actif',
          address TEXT NOT NULL DEFAULT '',
          acquired_on TEXT,
          sold_on TEXT,
          notes TEXT NOT NULL DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE fin_contracts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT 'autre',
          asset_id INTEGER REFERENCES fin_assets(id) ON DELETE SET NULL,
          account_id INTEGER REFERENCES fin_accounts(id) ON DELETE SET NULL,
          category_id INTEGER REFERENCES fin_categories(id) ON DELETE SET NULL,
          member_id TEXT,
          amount_min INTEGER,
          amount_max INTEGER,
          periodicity TEXT NOT NULL DEFAULT 'mensuelle',
          renewal_on TEXT,
          notice_days INTEGER NOT NULL DEFAULT 0,
          ends_on TEXT,
          status TEXT NOT NULL DEFAULT 'actif',
          notes TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE fin_contract_refs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contract_id INTEGER NOT NULL REFERENCES fin_contracts(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT NOT NULL DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0
        );

        -- One row per import run: every transaction it created carries its id, so
        -- an import can be undone without hand-written SQL.
        CREATE TABLE fin_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL DEFAULT '',
          format TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT,
          inserted INTEGER NOT NULL DEFAULT 0,
          duplicates INTEGER NOT NULL DEFAULT 0,
          transfers INTEGER NOT NULL DEFAULT 0,
          report TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE fin_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL REFERENCES fin_accounts(id) ON DELETE RESTRICT,
          date TEXT NOT NULL,
          amount INTEGER NOT NULL,
          kind TEXT NOT NULL DEFAULT 'depense',
          label_raw TEXT NOT NULL,
          label TEXT NOT NULL,
          category_id INTEGER REFERENCES fin_categories(id) ON DELETE SET NULL,
          contract_id INTEGER REFERENCES fin_contracts(id) ON DELETE SET NULL,
          notes TEXT NOT NULL DEFAULT '',
          cleared INTEGER NOT NULL DEFAULT 0,
          transfer_group TEXT,
          import_id INTEGER REFERENCES fin_imports(id) ON DELETE SET NULL,
          dedupe_key TEXT NOT NULL,
          dedupe_seq INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- The (key, seq) pair is what makes re-importing an overlapping export a
        -- no-op while still allowing two genuinely identical operations the same day.
        CREATE UNIQUE INDEX fin_tx_dedupe ON fin_transactions (dedupe_key, dedupe_seq);
        CREATE INDEX fin_tx_date ON fin_transactions (date);
        CREATE INDEX fin_tx_account_date ON fin_transactions (account_id, date);
        CREATE INDEX fin_tx_category ON fin_transactions (category_id);
        CREATE INDEX fin_tx_contract ON fin_transactions (contract_id);
        CREATE INDEX fin_tx_transfer ON fin_transactions (transfer_group);
        CREATE INDEX fin_tx_import ON fin_transactions (import_id);

        CREATE TABLE fin_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE fin_transaction_tags (
          transaction_id INTEGER NOT NULL REFERENCES fin_transactions(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES fin_tags(id) ON DELETE CASCADE,
          PRIMARY KEY (transaction_id, tag_id)
        );

        CREATE TABLE fin_readings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contract_id INTEGER NOT NULL REFERENCES fin_contracts(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          index_total REAL,
          index_hp REAL,
          index_hc REAL,
          kwh REAL,
          kwh_hp REAL,
          kwh_hc REAL,
          cost INTEGER,
          notes TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX fin_readings_contract ON fin_readings (contract_id, date);

        CREATE TABLE fin_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          match_mode TEXT NOT NULL DEFAULT 'all',
          stop INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE fin_rule_conditions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rule_id INTEGER NOT NULL REFERENCES fin_rules(id) ON DELETE CASCADE,
          field TEXT NOT NULL,
          op TEXT NOT NULL,
          value TEXT NOT NULL DEFAULT '',
          value2 TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE fin_rule_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rule_id INTEGER NOT NULL REFERENCES fin_rules(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          value TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE fin_savings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          annual_gain INTEGER NOT NULL DEFAULT 0,
          contract_id INTEGER REFERENCES fin_contracts(id) ON DELETE SET NULL,
          asset_id INTEGER REFERENCES fin_assets(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'idee',
          target_date TEXT,
          task_id TEXT,
          position INTEGER NOT NULL DEFAULT 0
        );

        -- Attachments live on disk under FOYER_DATA_DIR; only the path is stored.
        -- owner_kind is open ('contract', 'asset', 'transaction', later 'document')
        -- so the Documents module can reuse the same table and storage service.
        CREATE TABLE fin_attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_kind TEXT NOT NULL,
          owner_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          mime TEXT NOT NULL DEFAULT '',
          size INTEGER NOT NULL DEFAULT 0,
          sha256 TEXT NOT NULL,
          rel_path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX fin_attachments_owner ON fin_attachments (owner_kind, owner_id);
      `);

      // Starter categories for a French household. Generic on purpose: no personal
      // data ships in a migration. Accounts are created by the user.
      const cat = db.prepare('INSERT INTO fin_categories (name, color, icon, position) VALUES (?, ?, ?, ?)');
      [
        ['Alimentation', '#7A9B76', 'panier'],
        ['Logement', '#E56B4E', 'maison'],
        ['Impôts et URSSAF', '#9B6FA8', 'facture'],
        ['Crédit immobilier', '#4E93B8', 'epargne'],
        ['Achats', '#F0B24B', 'shopping'],
        ['Loisirs et vacances', '#F0B24B', 'loisir'],
        ['Retraits et chèques', '#9B6FA8', 'facture'],
        ['Scolarité et enfants', '#4E93B8', 'ecole'],
        ['Abonnements', '#9B6FA8', 'facture'],
        ['Assurances', '#4E93B8', 'facture'],
        ['Auto et transports', '#4E93B8', 'voiture'],
        ['Santé', '#E56B4E', 'sante'],
        ['Charges du cabinet', '#9B6FA8', 'facture'],
        ['Divers', '#7A9B76', 'facture'],
      ].forEach((c, i) => cat.run(c[0], c[1], c[2], i));
    },
  },
  {
    version: 2,
    label: 'import : brouillon, fenêtre de couverture',
    up: (db) => {
      db.exec(`
        -- Staged rows of an import waiting for validation. Cleared once committed
        -- or discarded, so a pending import never weighs on the database.
        ALTER TABLE fin_imports ADD COLUMN payload TEXT NOT NULL DEFAULT '';

        -- Period each import actually covers, per account. This is what makes the
        -- « mois incomplet » answer exact instead of guessed from the last
        -- operation: a dormant passbook covered by an import is not missing data.
        CREATE TABLE fin_import_coverage (
          import_id INTEGER NOT NULL REFERENCES fin_imports(id) ON DELETE CASCADE,
          account_id INTEGER NOT NULL REFERENCES fin_accounts(id) ON DELETE CASCADE,
          from_date TEXT NOT NULL,
          to_date TEXT NOT NULL,
          PRIMARY KEY (import_id, account_id)
        );
        CREATE INDEX fin_import_coverage_account ON fin_import_coverage (account_id, to_date);
      `);
    },
  },
  {
    version: 3,
    label: 'règles : provenance de la catégorisation',
    up: (db) => {
      db.exec(`
        -- Which rule last decided this row's category or label. NULL means the
        -- user set it by hand, and replaying the rules must not undo that.
        ALTER TABLE fin_transactions ADD COLUMN rule_id INTEGER REFERENCES fin_rules(id) ON DELETE SET NULL;
        CREATE INDEX fin_tx_rule ON fin_transactions (rule_id);
      `);
    },
  },
  {
    version: 4,
    label: 'plusieurs titulaires par compte et par contrat',
    up: (db) => {
      db.exec(`
        -- Un compte joint a deux titulaires, une assurance peut couvrir toute la
        -- famille : une colonne unique ne pouvait pas le dire.
        CREATE TABLE fin_account_members (
          account_id INTEGER NOT NULL REFERENCES fin_accounts(id) ON DELETE CASCADE,
          member_id TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (account_id, member_id)
        );
        CREATE TABLE fin_contract_members (
          contract_id INTEGER NOT NULL REFERENCES fin_contracts(id) ON DELETE CASCADE,
          member_id TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (contract_id, member_id)
        );

        -- Le titulaire unique déjà saisi devient le premier de la liste : rien
        -- n'est perdu, et une base existante n'a rien à ressaisir.
        INSERT INTO fin_account_members (account_id, member_id)
          SELECT id, member_id FROM fin_accounts WHERE member_id IS NOT NULL AND member_id <> '';
        INSERT INTO fin_contract_members (contract_id, member_id)
          SELECT id, member_id FROM fin_contracts WHERE member_id IS NOT NULL AND member_id <> '';

        -- La colonne part une fois recopiée : la laisser en place ferait deux
        -- sources de vérité pour la même question.
        ALTER TABLE fin_accounts DROP COLUMN member_id;
        ALTER TABLE fin_contracts DROP COLUMN member_id;
      `);
    },
  },
  {
    version: 5,
    label: 'comptes de crédit : paramètres du prêt',
    up: (db) => {
      db.exec(`
        -- Les termes d'un prêt amortissable, tels qu'ils sont écrits sur l'offre
        -- de prêt. NULL partout pour un compte qui n'est pas un crédit. Le
        -- capital restant dû n'est pas ici : il se calcule (voir loans.ts).
        ALTER TABLE fin_accounts ADD COLUMN loan_principal INTEGER;
        -- Taux annuel nominal en points de base, pour rester en entiers : 345 = 3,45 %.
        ALTER TABLE fin_accounts ADD COLUMN loan_rate_bp INTEGER;
        ALTER TABLE fin_accounts ADD COLUMN loan_payment INTEGER;
        ALTER TABLE fin_accounts ADD COLUMN loan_insurance INTEGER;
        ALTER TABLE fin_accounts ADD COLUMN loan_first_on TEXT;
      `);
    },
  },
];

function currentVersion(db: Database): number {
  db.exec('CREATE TABLE IF NOT EXISTS fin_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = db.prepare("SELECT value FROM fin_meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  return row ? parseInt(row.value, 10) || 0 : 0;
}

/**
 * Bring the finances schema up to date. Idempotent: already-applied versions are
 * skipped. Each migration runs in its own transaction, so a failure leaves the
 * database on the previous version rather than half-migrated.
 */
export function migrateFinances(db: Database): number {
  const from = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (!pending.length) return from;
  for (const m of pending) {
    try {
      db.transaction(() => {
        m.up(db);
        db.prepare("INSERT INTO fin_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(m.version));
      })();
      log.info(`Finances : migration ${m.version} appliquée (${m.label}).`);
    } catch (e) {
      log.erreur(
        `ERREUR : la migration Finances ${m.version} (${m.label}) a échoué : ${(e as Error).message}\n` +
        `        La base reste en version ${currentVersion(db)}, aucune donnée n'a été modifiée.\n` +
        `        Restaurez votre sauvegarde si nécessaire (voir deploy/README.md) et signalez l'erreur.`,
      );
      throw e;
    }
  }
  return currentVersion(db);
}
