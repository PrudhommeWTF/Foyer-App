// Schéma du module « Employé à domicile ». Comme Finances, il vit dans ses
// propres tables relationnelles (`emp_*`) plutôt que dans le document JSON du
// foyer : historique pluriannuel des présences, agrégats mensuels, archivage.
//
// Les migrations sont versionnées et appliquées au démarrage, dans l'ordre,
// chacune dans sa propre transaction. `emp_meta.schema_version` retient la
// dernière version appliquée : un second démarrage ne fait rien. On ne modifie
// jamais une migration livrée, on en ajoute une nouvelle.
//
// L'argent est en centimes entiers (pas de dérive en virgule flottante). Les
// durées sont en minutes (multiples de 15). Aucune donnée personnelle de
// l'employé au-delà du nom et du rôle : ni numéro de sécurité sociale, ni IBAN,
// ni adresse.
import type { Database } from 'better-sqlite3';
import { Migration, runMigrations } from '../storage/migrate';

export const EMP_SCHEMA_VERSION = 1;

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    label: 'tables du module Employé à domicile',
    up: (db) => {
      db.exec(`
        CREATE TABLE emp_employees (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          -- 'menage' | 'garde' | 'jardin' | 'autre'
          role TEXT NOT NULL DEFAULT 'menage',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          -- Rien n'est jamais supprimé : un employé qui part est archivé, daté.
          archived_at TEXT
        );

        -- Historique daté des taux nets horaires. Le mois déjà déclaré fige ses
        -- totaux (voir emp_months) et n'est jamais recalculé ; l'historique ne
        -- sert qu'à valoriser les présences des mois encore ouverts, au taux en
        -- vigueur le jour de chaque présence.
        CREATE TABLE emp_rates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_id INTEGER NOT NULL REFERENCES emp_employees(id) ON DELETE CASCADE,
          net_hourly_cents INTEGER NOT NULL,
          effective_from TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_by TEXT
        );
        CREATE INDEX emp_rates_emp_date ON emp_rates(employee_id, effective_from);

        -- Une présence : une ligne par jour et par employé. Deux passages le
        -- même jour se règlent en modifiant la ligne ou en refusant un doublon,
        -- jamais par une fusion silencieuse. Le retrait archive (archived_at).
        CREATE TABLE emp_shifts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_id INTEGER NOT NULL REFERENCES emp_employees(id) ON DELETE CASCADE,
          day TEXT NOT NULL,
          minutes INTEGER NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_by TEXT,
          updated_at TEXT,
          updated_by TEXT,
          archived_at TEXT
        );
        CREATE INDEX emp_shifts_emp_day ON emp_shifts(employee_id, day);

        -- État mensuel. 'ouvert' | 'declare' | 'paye' | 'sans-presence'. Un mois
        -- déclaré ou payé est figé : ses totaux (declared_*) sont ceux du moment
        -- de la déclaration, jamais recalculés. attachment_id pointera plus tard
        -- vers le justificatif CESU (service de fichiers), non utilisé en P1.
        CREATE TABLE emp_months (
          employee_id INTEGER NOT NULL REFERENCES emp_employees(id) ON DELETE CASCADE,
          month TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ouvert',
          declared_at TEXT,
          declared_hours_minutes INTEGER,
          declared_net_cents INTEGER,
          conges_inclus INTEGER,
          paid_at TEXT,
          urssaf_total_cents INTEGER,
          attachment_id INTEGER,
          note TEXT NOT NULL DEFAULT '',
          updated_at TEXT,
          updated_by TEXT,
          PRIMARY KEY (employee_id, month)
        );
      `);
    },
  },
];

/**
 * Met le schéma du module à jour. Idempotent, chaque migration dans sa propre
 * transaction : un échec laisse la base sur la version précédente.
 */
export function migrateEmployes(db: Database): number {
  return runMigrations(db, {
    metaTable: 'emp_meta',
    label: 'Employé à domicile',
    restoreHint: 'Restaurez votre sauvegarde si nécessaire (voir docs/employe-domicile.md) et signalez l’erreur.',
    migrations: MIGRATIONS,
  });
}
