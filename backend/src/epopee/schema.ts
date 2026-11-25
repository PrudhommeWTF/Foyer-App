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
        -- kind : amorce, bravo, etape (migration 2), annulation. ref : pour une annulation, l'écriture
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
  {
    version: 2,
    label: 'routines, étapes et leur déroulé du jour',
    up: (db) => {
      db.exec(`
        -- Une routine d'un enfant. kind : matin ou soir. time : l'heure prévue
        -- (HH:MM, heure de Paris). Retirer une routine pose archived_at.
        CREATE TABLE epo_routines (
          id TEXT PRIMARY KEY,
          member_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          time TEXT NOT NULL,
          created_at TEXT NOT NULL,
          archived_at TEXT
        );
        CREATE INDEX idx_epo_routines_member ON epo_routines(member_id, archived_at);

        -- Une étape : une seule consigne. seconds : la durée du sablier (un
        -- repère, jamais une échéance). ecus : ce que l'étape faite rapporte.
        CREATE TABLE epo_steps (
          id TEXT PRIMARY KEY,
          routine_id TEXT NOT NULL REFERENCES epo_routines(id),
          pos INTEGER NOT NULL,
          title TEXT NOT NULL,
          hint TEXT NOT NULL DEFAULT '',
          icon TEXT NOT NULL,
          seconds INTEGER NOT NULL,
          ecus INTEGER NOT NULL,
          archived_at TEXT
        );
        CREATE INDEX idx_epo_steps_routine ON epo_steps(routine_id, archived_at, pos);

        -- Une étape un jour donné (heure de Paris) : faite ou passée, une seule
        -- fois. L'écu d'une étape faite est une écriture du grand livre, dont
        -- l'identifiant se déduit de l'étape et du jour.
        CREATE TABLE epo_step_marks (
          step_id TEXT NOT NULL REFERENCES epo_steps(id),
          day TEXT NOT NULL,
          member_id TEXT NOT NULL,
          status TEXT NOT NULL,
          by_member TEXT,
          at TEXT NOT NULL,
          PRIMARY KEY (step_id, day)
        );
        CREATE INDEX idx_epo_step_marks_member ON epo_step_marks(member_id, day);

        -- Le déroulé d'une routine un jour donné : début, fin (toutes les étapes
        -- faites ou passées), nombre de pauses « grain de sable ».
        CREATE TABLE epo_routine_days (
          routine_id TEXT NOT NULL REFERENCES epo_routines(id),
          day TEXT NOT NULL,
          member_id TEXT NOT NULL,
          started_at TEXT,
          ended_at TEXT,
          pauses INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (routine_id, day)
        );
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
