// Le runner de migrations partagé par les deux schémas SQLite (Finances et
// foyer). Les deux tenaient le même code à la table de méta, au libellé de
// journal et au lien de restauration près : une seule version ici.
//
// Chaque migration s'applique dans sa propre transaction, et la version n'est
// inscrite qu'après : un échec laisse la base sur la version précédente, jamais
// à moitié migrée. Déjà appliquées, les versions sont sautées (idempotent).
import type { Database } from 'better-sqlite3';
import { log } from '../log';

export interface Migration { version: number; label: string; up: (db: Database) => void; }

export function runMigrations(db: Database, opts: {
  /** Table clé/valeur qui porte `schema_version` : `fin_meta`, `hh_meta`. Constante, jamais une saisie. */
  metaTable: string;
  /** Préfixe de journal : « Finances », « Foyer ». */
  label: string;
  /** Ligne d'aide affichée en cas d'échec (le chemin du guide de restauration diffère selon le module). */
  restoreHint: string;
  migrations: Migration[];
}): number {
  const { metaTable, label, restoreHint, migrations } = opts;
  const current = (): number => {
    db.exec(`CREATE TABLE IF NOT EXISTS ${metaTable} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    const row = db.prepare(`SELECT value FROM ${metaTable} WHERE key = 'schema_version'`).get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) || 0 : 0;
  };
  const from = current();
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (!pending.length) return from;
  for (const m of pending) {
    try {
      db.transaction(() => {
        m.up(db);
        db.prepare(`INSERT INTO ${metaTable} (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(m.version));
      })();
      log.info(`${label} : migration ${m.version} appliquée (${m.label}).`);
    } catch (e) {
      log.erreur(
        `ERREUR : la migration ${label} ${m.version} (${m.label}) a échoué : ${(e as Error).message}\n` +
        `        La base reste en version ${current()}, aucune donnée n'a été modifiée.\n` +
        `        ${restoreHint}`,
      );
      throw e;
    }
  }
  return current();
}
