// Schéma relationnel du module Entretien : ce que coûtent les gestes. Les
// gestes eux-mêmes sont des tâches du document ; leurs montants n'y sont pas,
// parce que le document part entier à chaque membre, enfants compris, et qu'un
// enfant ne voit jamais un montant. Ils vivent ici, servis aux seuls adultes.
//
// Migrations versionnées, appliquées au démarrage, chacune dans sa
// transaction ; `ent_meta.schema_version` retient la dernière. On ne modifie
// jamais une migration livrée, on en ajoute une. Les montants sont en centimes.
import type { Database } from 'better-sqlite3';
import { Migration, runMigrations } from '../storage/migrate';

export const ENT_SCHEMA_VERSION = 2;

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    label: 'coûts des gestes d’entretien',
    up: (db) => {
      db.exec(`
        -- Le coût prévu d'un geste, à chaque fois qu'il est fait : la
        -- cartouche, le ramonage. Ou le contrat Finances qui le couvre (le
        -- contrat d'entretien de la chaudière), sans montant propre : il est
        -- déjà compté dans le contrat. Pas de clé étrangère vers fin_contracts :
        -- la restauration de Finances vide et recharge ses tables.
        CREATE TABLE ent_costs (
          task_id TEXT PRIMARY KEY,
          amount INTEGER,
          contract_id INTEGER,
          updated_by TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Ce qu'a coûté chaque réalisation, noté au moment où elle est faite :
        -- un prix changé ensuite ne réécrit pas le passé. Une réalisation est
        -- désignée par son instant (history[].at), unique pour un geste.
        CREATE TABLE ent_spend (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          done_at TEXT NOT NULL,
          day TEXT NOT NULL,
          amount INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (task_id, done_at)
        );
        CREATE INDEX ent_spend_day ON ent_spend(day);
      `);
    },
  },
  {
    version: 2,
    label: 'notes des réalisations',
    up: (db) => {
      db.exec(`
        -- La note d'une réalisation (« conduit propre, rien à signaler »),
        -- ajoutée après coup. Une réalisation est désignée comme dans
        -- ent_spend. Les justificatifs (attestation, certificat) sont des
        -- fichiers de hh_attachments, genre « maintenance » : voir
        -- realisations.ts. Une ligne survit à l'annulation de sa réalisation :
        -- on ne perd pas une attestation sur un « Annuler ».
        CREATE TABLE ent_done_notes (
          task_id TEXT NOT NULL,
          done_at TEXT NOT NULL,
          day TEXT NOT NULL,
          note TEXT NOT NULL,
          updated_by TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (task_id, done_at)
        );
      `);
    },
  },
];

export function migrateEntretien(db: Database): number {
  return runMigrations(db, {
    metaTable: 'ent_meta',
    label: 'Entretien',
    restoreHint: 'Restaurez votre sauvegarde si nécessaire (voir docs/entretien.md) et signalez l’erreur.',
    migrations: MIGRATIONS,
  });
}
