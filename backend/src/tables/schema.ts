// Schéma du module « Tables » (calcul mental). Relationnel, tables `tab_*`,
// hors du document du foyer : une session d'exercice produit des dizaines de
// réponses horodatées, le suivi agrège par opération et dans le temps, et deux
// enfants s'entraînent en même temps sur deux appareils.
//
// Rien n'est jamais supprimé : une session abandonnée reste (`aborted`), ses
// réponses comptent ; un programme remplacé reste (`active = 0`), daté et signé.
// `tab_mastery` n'est qu'un cache : elle se recalcule entièrement depuis
// `tab_answers` (voir repo.ts et la commande tables:recalcul).
//
// Migrations versionnées comme Finances et Employé : on ajoute, on ne modifie
// jamais une migration livrée.
import type { Database } from 'better-sqlite3';
import { Migration, runMigrations } from '../storage/migrate';

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    label: 'tables du module Tables',
    up: (db) => {
      db.exec(`
        -- Le programme d'un enfant, réglé par un parent. Un seul actif par enfant ;
        -- l'ancien reste, pour que le bilan d'une période dise sur quoi elle portait.
        CREATE TABLE tab_programs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          from_table INTEGER NOT NULL,
          to_table INTEGER NOT NULL,
          questions INTEGER NOT NULL,
          -- NULL : le barème selon l'âge s'applique.
          seconds_allowed REAL,
          fast_seconds REAL,
          daily_goal INTEGER NOT NULL DEFAULT 1,
          both_directions INTEGER NOT NULL DEFAULT 1,
          set_by TEXT,
          set_at TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX idx_tab_programs_member ON tab_programs(member_id, active);

        -- Une session d'exercice. L'identifiant vient de l'appareil (uuid) : deux
        -- envois de la même session n'en font qu'une, c'est ce qui rend le rejeu
        -- d'une file hors ligne sans danger.
        CREATE TABLE tab_sessions (
          id TEXT PRIMARY KEY,
          member_id TEXT NOT NULL,
          program_id INTEGER,
          mode TEXT NOT NULL,
          operation TEXT NOT NULL,
          from_table INTEGER NOT NULL,
          to_table INTEGER NOT NULL,
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
        CREATE INDEX idx_tab_sessions_member ON tab_sessions(member_id, started_at);

        -- Les réponses. (pa, pb) est le couple commutatif, (a, b) la question telle
        -- que posée. \`counts\` : la réponse compte pour la maîtrise (pas en mode
        -- Apprendre, où l'enfant recopie la table sous ses yeux).
        CREATE TABLE tab_answers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES tab_sessions(id),
          member_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          a INTEGER NOT NULL,
          b INTEGER NOT NULL,
          pa INTEGER NOT NULL,
          pb INTEGER NOT NULL,
          expected INTEGER NOT NULL,
          given INTEGER,
          ms INTEGER NOT NULL,
          result TEXT NOT NULL,
          asked_at TEXT NOT NULL,
          counts INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX idx_tab_answers_pair ON tab_answers(member_id, operation, pa, pb, asked_at);
        CREATE INDEX idx_tab_answers_session ON tab_answers(session_id);

        -- La maîtrise par couple, recalculable depuis tab_answers.
        CREATE TABLE tab_mastery (
          member_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          a INTEGER NOT NULL,
          b INTEGER NOT NULL,
          level INTEGER NOT NULL,
          good_count INTEGER NOT NULL,
          wrong_count INTEGER NOT NULL,
          last_result TEXT NOT NULL,
          last_at TEXT NOT NULL,
          next_at TEXT NOT NULL,
          PRIMARY KEY (member_id, operation, a, b)
        );
      `);
    },
  },
];

/** Met le schéma du module à jour. Idempotent, chaque migration dans sa propre transaction. */
export function migrateTables(db: Database): number {
  return runMigrations(db, {
    metaTable: 'tab_meta',
    label: 'Tables',
    restoreHint: 'Restaurez votre sauvegarde si nécessaire (voir docs/sauvegarde-restauration.md) et signalez l’erreur.',
    migrations: MIGRATIONS,
  });
}
