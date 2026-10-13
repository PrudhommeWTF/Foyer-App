// Schéma du module « École » (ÉcoleDirecte). Comme Employés, il vit dans ses
// propres tables (`ed_*`) hors du document du foyer : il est écrit en arrière-
// plan par le planificateur, pas par les téléphones.
//
// Migrations versionnées, appliquées au démarrage, chacune dans sa transaction.
// `ed_meta.schema_version` retient la dernière. On ne modifie jamais une
// migration livrée, on en ajoute une nouvelle.
//
// Les colonnes `*_enc` sont chiffrées (storage/secret-box.ts) : identifiant,
// mot de passe, et le couple cn / cv de l'appareil de confiance. Elles restent
// chiffrées dans toutes les sauvegardes, et ne sortent jamais des routes.
import type { Database } from 'better-sqlite3';
import { Migration, runMigrations } from '../storage/migrate';

export const ED_SCHEMA_VERSION = 1;

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    label: 'comptes ÉcoleDirecte, élèves et journal de synchronisation',
    up: (db) => {
      db.exec(`
        CREATE TABLE ed_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          label TEXT NOT NULL,
          login_enc TEXT,
          password_enc TEXT,
          creds_set_at TEXT,
          -- 'famille' | 'eleve', connu après la première connexion réussie.
          account_type TEXT,
          ed_user_id INTEGER,
          trusted_cn_enc TEXT,
          trusted_cv_enc TEXT,
          trusted_at TEXT,
          -- Question de sécurité en attente : { question, propositions[], askedAt }.
          pending_qcm TEXT,
          -- 0 : mis en pause à la main.
          enabled INTEGER NOT NULL DEFAULT 1,
          -- Ce qui exige un geste humain avant toute nouvelle connexion :
          -- 'qcm' | 'identifiants' | 'version' | 'cle'. NULL : rien.
          blocked TEXT,
          -- Pour 'version' : la version refusée. Une autre version configurée lève le blocage.
          blocked_detail TEXT,
          last_sync_at TEXT,
          last_sync_ok INTEGER,
          last_ok_at TEXT,
          last_error_at TEXT,
          last_error_code INTEGER,
          last_error_kind TEXT,
          last_error_message TEXT,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          -- Pause automatique après trois échecs passagers de suite.
          paused_until TEXT,
          -- Les administrateurs ont été prévenus de l'incident en cours : une seule fois.
          alert_sent_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT,
          -- Rien n'est supprimé : un compte retiré perd ses secrets et s'archive.
          archived_at TEXT
        );

        CREATE TABLE ed_students (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL REFERENCES ed_accounts(id) ON DELETE CASCADE,
          ed_student_id INTEGER NOT NULL,
          id_login INTEGER,
          ed_first_name TEXT NOT NULL DEFAULT '',
          ed_last_name TEXT NOT NULL DEFAULT '',
          class_name TEXT NOT NULL DEFAULT '',
          school_name TEXT NOT NULL DEFAULT '',
          -- Membre du foyer : proposé d'après le prénom, puis confirmé ou corrigé.
          member_id TEXT,
          -- 'prenom' | 'manuel' : d'où vient l'association.
          match_source TEXT,
          -- 'propose' | 'confirme' | 'ignore' | 'aucun'. Seul 'confirme' sera synchronisé.
          link_state TEXT NOT NULL DEFAULT 'aucun',
          modules_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT,
          -- L'élève n'apparaît plus dans le compte (changement d'année, départ).
          archived_at TEXT,
          UNIQUE (account_id, ed_student_id)
        );

        CREATE TABLE ed_sync_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER REFERENCES ed_accounts(id) ON DELETE CASCADE,
          at TEXT NOT NULL DEFAULT (datetime('now')),
          -- 'connexion' | 'qcm' | ...
          scope TEXT NOT NULL,
          ok INTEGER NOT NULL,
          http_status INTEGER,
          ed_code INTEGER,
          message TEXT NOT NULL DEFAULT '',
          duration_ms INTEGER
        );
        CREATE INDEX ed_sync_log_account ON ed_sync_log(account_id, id);
      `);
    },
  },
];

export function migrateEcole(db: Database): number {
  return runMigrations(db, {
    metaTable: 'ed_meta',
    label: 'École',
    restoreHint: 'Restaurez votre sauvegarde si nécessaire (voir docs/ecole.md) et signalez l’erreur.',
    migrations: MIGRATIONS,
  });
}
