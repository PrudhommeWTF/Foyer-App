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

export const ED_SCHEMA_VERSION = 3;

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
  {
    version: 2,
    label: 'devoirs, emploi du temps, liste de tâches et demi-pension par élève',
    up: (db) => {
      db.exec(`
        -- La liste « Devoirs de … » du document, créée à l'association de l'élève.
        ALTER TABLE ed_students ADD COLUMN task_list_id TEXT;
        -- Déjeune à la cantine : la pause de midi entre deux cours compte comme
        -- une absence du foyer pour les couverts. Oui par défaut.
        ALTER TABLE ed_students ADD COLUMN half_board INTEGER NOT NULL DEFAULT 1;
        -- État des données de cet élève (un compte peut réussir sa connexion et
        -- échouer sur le cahier de textes d'un seul enfant).
        ALTER TABLE ed_students ADD COLUMN data_ok_at TEXT;
        ALTER TABLE ed_students ADD COLUMN data_error TEXT;
        ALTER TABLE ed_students ADD COLUMN data_error_at TEXT;

        -- Un devoir du cahier de textes. Source de vérité : la tâche Foyer n'en
        -- est qu'une projection (task_id). Jamais effacé : archivé quand
        -- ÉcoleDirecte ne le renvoie plus.
        CREATE TABLE ed_homework (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES ed_students(id) ON DELETE CASCADE,
          ed_id INTEGER NOT NULL,
          due_date TEXT NOT NULL,
          subject TEXT NOT NULL DEFAULT '',
          subject_code TEXT NOT NULL DEFAULT '',
          teacher TEXT NOT NULL DEFAULT '',
          content_html TEXT NOT NULL DEFAULT '',
          content_text TEXT NOT NULL DEFAULT '',
          content_hash TEXT,
          is_test INTEGER NOT NULL DEFAULT 0,
          online INTEGER NOT NULL DEFAULT 0,
          given_on TEXT,
          -- « Fait » des deux côtés. done_ed : ce qu'ÉcoleDirecte dit ;
          -- done_synced : la dernière valeur sur laquelle les deux côtés étaient
          -- d'accord ; done_local : ce que Foyer veut quand la tâche n'existe plus
          -- (sinon c'est la coche de la tâche qui fait foi).
          done_ed INTEGER NOT NULL DEFAULT 0,
          done_synced INTEGER,
          done_local INTEGER,
          done_sent_at TEXT,
          done_error TEXT,
          task_id TEXT,
          -- L'utilisateur a supprimé la tâche : elle n'est jamais recréée.
          task_dropped_at TEXT,
          detail_at TEXT,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          -- Le professeur a changé l'énoncé après publication.
          modified_at TEXT,
          archived_at TEXT,
          UNIQUE (student_id, ed_id)
        );
        CREATE INDEX ed_homework_due ON ed_homework(student_id, due_date);

        -- Un cours de l'emploi du temps importé. Lecture seule, jamais fusionné
        -- avec les créneaux saisis à la main.
        CREATE TABLE ed_lessons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES ed_students(id) ON DELETE CASCADE,
          ed_id INTEGER NOT NULL,
          day TEXT NOT NULL,
          start TEXT NOT NULL,
          end TEXT NOT NULL,
          subject TEXT NOT NULL DEFAULT '',
          teacher TEXT NOT NULL DEFAULT '',
          room TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT '',
          cancelled INTEGER NOT NULL DEFAULT 0,
          modified INTEGER NOT NULL DEFAULT 0,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          archived_at TEXT,
          UNIQUE (student_id, ed_id, day)
        );
        CREATE INDEX ed_lessons_day ON ed_lessons(student_id, day);
      `);
    },
  },
  {
    version: 3,
    label: 'notes, moyennes et vie scolaire',
    up: (db) => {
      db.exec(`
        -- La première lecture des notes et de la vie scolaire d'un élève est
        -- muette : tout ce qu'elle trouve est marqué déjà notifié. Ces dates
        -- disent qu'elle a eu lieu.
        ALTER TABLE ed_students ADD COLUMN grades_baseline_at TEXT;
        ALTER TABLE ed_students ADD COLUMN life_baseline_at TEXT;
        ALTER TABLE ed_students ADD COLUMN homework_baseline_at TEXT;
        ALTER TABLE ed_homework ADD COLUMN notified_at TEXT;

        -- Une note, telle qu'ÉcoleDirecte la donne : la valeur brute (« 14,5 »,
        -- « Abs », « NN ») et, quand c'en est une, sa valeur numérique.
        CREATE TABLE ed_grades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES ed_students(id) ON DELETE CASCADE,
          ed_id INTEGER NOT NULL,
          date TEXT,
          subject TEXT NOT NULL DEFAULT '',
          subject_code TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT '',
          value_raw TEXT NOT NULL DEFAULT '',
          value_num REAL,
          out_of TEXT NOT NULL DEFAULT '',
          coefficient TEXT NOT NULL DEFAULT '',
          class_average TEXT NOT NULL DEFAULT '',
          class_min TEXT NOT NULL DEFAULT '',
          class_max TEXT NOT NULL DEFAULT '',
          period_code TEXT NOT NULL DEFAULT '',
          not_significant INTEGER NOT NULL DEFAULT 0,
          school_year TEXT NOT NULL DEFAULT '',
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          notified_at TEXT,
          UNIQUE (student_id, ed_id)
        );
        CREATE INDEX ed_grades_date ON ed_grades(student_id, date);

        -- Les moyennes par période et par matière, telles qu'ÉcoleDirecte les
        -- renvoie. Jamais recalculées par Foyer.
        CREATE TABLE ed_averages (
          student_id INTEGER NOT NULL REFERENCES ed_students(id) ON DELETE CASCADE,
          period_code TEXT NOT NULL,
          period_label TEXT NOT NULL DEFAULT '',
          period_from TEXT,
          period_to TEXT,
          closed INTEGER NOT NULL DEFAULT 0,
          subject_code TEXT NOT NULL,
          subject TEXT NOT NULL DEFAULT '',
          average TEXT NOT NULL DEFAULT '',
          class_average TEXT NOT NULL DEFAULT '',
          class_min TEXT NOT NULL DEFAULT '',
          class_max TEXT NOT NULL DEFAULT '',
          coefficient TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (student_id, period_code, subject_code)
        );

        -- Absences, retards, sanctions, encouragements.
        CREATE TABLE ed_life (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES ed_students(id) ON DELETE CASCADE,
          ed_id INTEGER NOT NULL,
          -- 'absence' | 'retard' | 'sanction' | 'encouragement'
          kind TEXT NOT NULL,
          date TEXT,
          display_date TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL DEFAULT '',
          justified INTEGER,
          given_by TEXT NOT NULL DEFAULT '',
          comment TEXT NOT NULL DEFAULT '',
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          notified_at TEXT,
          UNIQUE (student_id, kind, ed_id)
        );
        CREATE INDEX ed_life_date ON ed_life(student_id, date);
      `);
      // Les devoirs déjà connus ne déclenchent pas de notification « nouveau devoir ».
      db.exec(`UPDATE ed_homework SET notified_at = first_seen_at WHERE notified_at IS NULL;
               UPDATE ed_students SET homework_baseline_at = datetime('now') WHERE data_ok_at IS NOT NULL;`);
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
