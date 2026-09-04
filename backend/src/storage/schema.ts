// Tables du foyer qui ne peuvent pas vivre dans le document JSON.
//
// Le reste de l'état du foyer est un unique document (voir db.ts) et le reste.
// Trois choses seulement en sortent, et chacune pour une raison précise :
//
//   - `hh_attachments` : les octets d'une photo n'ont rien à faire en base64 au
//     milieu de l'état. Chaque sauvegarde renvoyait le document entier, donc
//     toutes les photos du carnet, y compris pour cocher un article de courses
//     en 4G dans un magasin.
//   - `hh_shop_ops` et `hh_task_ops` : les identifiants des opérations de
//     courses et de tâches déjà appliquées, pour qu'un rejeu après coupure
//     réseau ne ressuscite pas un article ou une tâche supprimés entre-temps.
//   - `hh_push_subs` et `hh_notif_sent` : les appareils abonnés aux rappels et
//     le journal de ce qui leur a été envoyé (voir notify/push.ts).
//   - `hh_settings_log` : qui a changé quel réglage, quand, et pour quelle
//     valeur. À deux administrateurs, savoir qui a changé quoi évite des
//     discussions inutiles (voir settings/repo.ts).
//   - `hh_meta` : la version du schéma, celle du document, et les clés VAPID.
//
// Les migrations sont versionnées et appliquées au démarrage, chacune dans sa
// transaction. Ne jamais modifier une migration livrée : en ajouter une.
import type { Database } from 'better-sqlite3';
import { log } from '../log';

export const HH_SCHEMA_VERSION = 4;

interface Migration { version: number; label: string; up: (db: Database) => void; }

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    label: 'fichiers du foyer et journal des opérations de courses',
    up: (db) => {
      db.exec(`
        -- Contrairement aux pièces Finances, le propriétaire est désigné par un
        -- identifiant texte : les entités du document JSON s'appellent « r7f3a »,
        -- pas « 42 ».
        CREATE TABLE hh_attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_kind TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          name TEXT NOT NULL,
          mime TEXT NOT NULL,
          size INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          rel_path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_hh_attachments_owner ON hh_attachments(owner_kind, owner_id);
        CREATE INDEX idx_hh_attachments_sha ON hh_attachments(sha256);

        -- Une opération rejouée après une coupure réseau ne doit rien refaire.
        -- Les lignes anciennes sont élaguées : ce journal n'est pas un historique,
        -- juste une mémoire courte contre les doublons.
        CREATE TABLE hh_shop_ops (
          op_id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 2,
    label: 'journal des opérations de tâches',
    up: (db) => {
      db.exec(`
        -- Même rôle que hh_shop_ops, pour les tâches (voir tasks/repo.ts).
        CREATE TABLE hh_task_ops (
          op_id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 3,
    label: 'appareils abonnés aux rappels et journal des envois',
    up: (db) => {
      db.exec(`
        -- Un abonnement Web Push par appareil, rattaché au membre connecté au
        -- moment de l'abonnement. L'adresse (endpoint) est l'identité de l'appareil.
        CREATE TABLE hh_push_subs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id TEXT NOT NULL,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          ua TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_ok_at TEXT,
          last_error TEXT
        );
        CREATE INDEX idx_hh_push_subs_member ON hh_push_subs(member_id);

        -- Ce qui a été envoyé, à qui, et ce que ça a donné. La clé porte la
        -- tâche, son échéance et son réglage : c'est ce qui rend un redémarrage
        -- sans double envoi, et une tâche reportée rappelée à nouveau.
        CREATE TABLE hh_notif_sent (
          key TEXT NOT NULL,
          member_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          task_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          error TEXT,
          sent_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (key, member_id)
        );
      `);
    },
  },
  {
    version: 4,
    label: 'journal des modifications de réglages',
    up: (db) => {
      db.exec(`
        -- Qui a changé quel réglage, quand, et de quoi vers quoi. Les valeurs
        -- sont rangées en JSON : un booléen, un nombre et un texte s'y écrivent
        -- de la même façon, et se relisent sans deviner leur type.
        --
        -- Ce journal n'est pas élagué : quatre personnes qui règlent une
        -- application familiale n'en produisent pas des milliers de lignes, et
        -- c'est précisément l'ancienneté d'une ligne qui la rend utile.
        CREATE TABLE hh_settings_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          before_json TEXT,
          after_json TEXT NOT NULL,
          member_id TEXT,
          at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_hh_settings_log_at ON hh_settings_log(at DESC);
      `);
    },
  },
];

function currentVersion(db: Database): number {
  db.exec('CREATE TABLE IF NOT EXISTS hh_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = db.prepare("SELECT value FROM hh_meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  return row ? parseInt(row.value, 10) || 0 : 0;
}

export function migrateHousehold(db: Database): number {
  const from = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (!pending.length) return from;
  for (const m of pending) {
    try {
      db.transaction(() => {
        m.up(db);
        db.prepare("INSERT INTO hh_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(m.version));
      })();
      log.info(`Foyer : migration ${m.version} appliquée (${m.label}).`);
    } catch (e) {
      log.erreur(
        `ERREUR : la migration Foyer ${m.version} (${m.label}) a échoué : ${(e as Error).message}\n` +
        `        La base reste en version ${currentVersion(db)}, aucune donnée n'a été modifiée.\n` +
        "        Restaurez votre sauvegarde si nécessaire (voir README, « Sauvegarde et restauration ») et signalez l'erreur.",
      );
      throw e;
    }
  }
  return currentVersion(db);
}

// ---- version du document d'état -------------------------------------------
// Distincte de la version du schéma : le document est migré par son propre jeu
// de transformations (voir state/migrations.ts), qui n'ont pas la même cadence.
export function stateVersion(db: Database): number {
  const row = db.prepare("SELECT value FROM hh_meta WHERE key = 'state_version'").get() as { value: string } | undefined;
  return row ? parseInt(row.value, 10) || 0 : 0;
}
export function setStateVersion(db: Database, v: number): void {
  db.prepare("INSERT INTO hh_meta (key, value) VALUES ('state_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(v));
}
