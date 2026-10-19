// Schéma du module « Révisions ». Relationnel, tables `rev_*`, hors du document
// du foyer : une session d'exercice produit des dizaines de réponses
// horodatées, le suivi agrège par item et dans le temps, et deux enfants
// s'entraînent en même temps sur deux appareils.
//
// Le schéma ne connaît aucune matière : un exercice n'est qu'un identifiant
// (`exercise_id`), un item qu'une clé (`item_key`, fournie par la définition
// de l'exercice), une question qu'un JSON propre à l'exercice. Ajouter un
// exercice n'ajoute ni table ni colonne. Voir docs/revisions.md.
//
// Rien n'est jamais supprimé : une session abandonnée reste (`aborted`), ses
// réponses comptent ; un programme remplacé reste (`active = 0`), daté et signé.
// `rev_mastery` n'est qu'un cache : elle se recalcule entièrement depuis
// `rev_answers` (voir repo.ts et la commande revisions:recalcul).
//
// Migrations versionnées comme Finances et Employé : on ajoute, on ne modifie
// jamais une migration livrée.
import type { Database } from 'better-sqlite3';
import { Migration, runMigrations } from '../storage/migrate';

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    label: 'tables du module Révisions',
    up: (db) => {
      db.exec(`
        -- Le programme d'un enfant pour un exercice, réglé par un parent. Un seul
        -- actif par enfant et par exercice ; l'ancien reste, pour que le bilan
        -- d'une période dise sur quoi elle portait. params_json : les paramètres
        -- déclarés par l'exercice (les tables travaillées, la liste de mots…).
        CREATE TABLE rev_programs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id TEXT NOT NULL,
          exercise_id TEXT NOT NULL,
          params_json TEXT NOT NULL,
          questions INTEGER NOT NULL,
          -- NULL : le barème selon l'âge s'applique.
          seconds_allowed REAL,
          fast_seconds REAL,
          daily_goal INTEGER NOT NULL DEFAULT 1,
          set_by TEXT,
          set_at TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX idx_rev_programs_member ON rev_programs(member_id, exercise_id, active);

        -- Une session d'exercice. L'identifiant vient de l'appareil (uuid) : deux
        -- envois de la même session n'en font qu'une, c'est ce qui rend le rejeu
        -- d'une file hors ligne sans danger.
        CREATE TABLE rev_sessions (
          id TEXT PRIMARY KEY,
          member_id TEXT NOT NULL,
          exercise_id TEXT NOT NULL,
          program_id INTEGER,
          mode TEXT NOT NULL,
          params_json TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT NOT NULL,
          aborted INTEGER NOT NULL DEFAULT 0,
          questions INTEGER NOT NULL,
          good INTEGER NOT NULL,
          slow INTEGER NOT NULL,
          wrong INTEGER NOT NULL,
          avg_ms INTEGER,
          -- Le temps accordé et le seuil rapide appliqués pendant la session.
          allowed_ms INTEGER NOT NULL,
          fast_ms INTEGER NOT NULL,
          device TEXT NOT NULL DEFAULT '',
          -- Le parent qui avait ouvert la session de l'enfant, s'il y en a un.
          via TEXT,
          received_at TEXT NOT NULL
        );
        CREATE INDEX idx_rev_sessions_member ON rev_sessions(member_id, exercise_id, started_at);

        -- Les réponses. question_json : la question telle que posée (propre à
        -- l'exercice) ; item_key : l'item qu'elle travaille. counts : la réponse
        -- compte pour la maîtrise (pas en mode Apprendre, où l'enfant recopie).
        CREATE TABLE rev_answers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES rev_sessions(id),
          member_id TEXT NOT NULL,
          exercise_id TEXT NOT NULL,
          item_key TEXT NOT NULL,
          question_json TEXT NOT NULL,
          expected TEXT NOT NULL,
          given TEXT,
          ms INTEGER NOT NULL,
          result TEXT NOT NULL,
          asked_at TEXT NOT NULL,
          counts INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX idx_rev_answers_item ON rev_answers(member_id, exercise_id, item_key, asked_at);
        CREATE INDEX idx_rev_answers_session ON rev_answers(session_id);

        -- La maîtrise par item, recalculable depuis rev_answers.
        CREATE TABLE rev_mastery (
          member_id TEXT NOT NULL,
          exercise_id TEXT NOT NULL,
          item_key TEXT NOT NULL,
          level INTEGER NOT NULL,
          good_count INTEGER NOT NULL,
          wrong_count INTEGER NOT NULL,
          last_result TEXT NOT NULL,
          last_at TEXT NOT NULL,
          next_at TEXT NOT NULL,
          PRIMARY KEY (member_id, exercise_id, item_key)
        );
      `);
    },
  },
];

/** Met le schéma du module à jour. Idempotent, chaque migration dans sa propre transaction. */
export function migrateRevisions(db: Database): number {
  return runMigrations(db, {
    metaTable: 'rev_meta',
    label: 'Révisions',
    restoreHint: 'Restaurez votre sauvegarde si nécessaire (voir docs/sauvegarde-restauration.md) et signalez l’erreur.',
    migrations: MIGRATIONS,
  });
}
