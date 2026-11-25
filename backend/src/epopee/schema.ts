// Schéma du module « Épopée » (routines, écus et récompenses des enfants).
// Relationnel, tables `epo_*`, hors du document du foyer : le solde d'un enfant
// bouge plusieurs fois par jour depuis plusieurs appareils, et son histoire ne
// doit pas pouvoir être réécrite par l'enregistrement d'un autre écran.
//
// Le cœur est un **grand livre** (`epo_ledger`) en ajout seul : on n'y modifie
// ni n'y efface rien. Le solde d'un enfant est la somme de ses écritures, et
// annuler, c'est écrire la contre-écriture. Les règles (plancher, ce qui
// s'annule) vivent dans rules.ts, pures.
//
// Migrations versionnées comme les autres modules : on ajoute, on ne modifie
// jamais une migration livrée.
import type { Database } from 'better-sqlite3';
import { Migration, runMigrations } from '../storage/migrate';

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    label: 'tables du module Épopée',
    up: (db) => {
      db.exec(`
        -- Un enfant enrôlé. floor : le plancher de sa besace, les écus d'amorce
        -- reçus à l'enrôlement, qu'aucun retrait n'entame. retired_at : sorti de
        -- l'Épopée par un parent ; la ligne et ses écritures restent.
        CREATE TABLE epo_profiles (
          member_id TEXT PRIMARY KEY,
          floor INTEGER NOT NULL,
          enrolled_at TEXT NOT NULL,
          enrolled_by TEXT,
          retired_at TEXT
        );

        -- Le grand livre. id : un uuid, donné par l'appareil quand le geste vient
        -- de lui (un second envoi du même geste ne compte pas deux fois).
        -- kind : amorce, bravo, annulation. ref : pour une annulation, l'écriture
        -- annulée. by_member : l'adulte qui a fait le geste.
        CREATE TABLE epo_ledger (
          id TEXT PRIMARY KEY,
          member_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          delta INTEGER NOT NULL,
          note TEXT,
          ref TEXT,
          by_member TEXT,
          at TEXT NOT NULL
        );
        CREATE INDEX idx_epo_ledger_member ON epo_ledger(member_id, at);
        -- Une écriture ne s'annule qu'une fois, quoi que fassent deux appareils.
        CREATE UNIQUE INDEX idx_epo_ledger_ref ON epo_ledger(ref) WHERE ref IS NOT NULL;
      `);
    },
  },
];

/** Met le schéma du module à jour. Idempotent, chaque migration dans sa propre transaction. */
export function migrateEpopee(db: Database): number {
  return runMigrations(db, {
    metaTable: 'epo_meta',
    label: 'Épopée',
    restoreHint: 'Restaurez votre sauvegarde si nécessaire (voir docs/sauvegarde-restauration.md) et signalez l’erreur.',
    migrations: MIGRATIONS,
  });
}
