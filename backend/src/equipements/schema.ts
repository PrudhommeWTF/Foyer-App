// Schéma du module « Équipements » : une fiche par appareil de la maison, ses
// pièces jointes (facture, plaque signalétique, notice, photos) et son
// historique (pannes, SAV, réparations). Comme Employé, il vit dans ses propres
// tables relationnelles (`eqp_*`), hors du document JSON : plusieurs dizaines de
// fiches avec des fichiers, des agrégats (par pièce, garanties qui expirent), et
// un module Entretien qui y fera référence par identifiant.
//
// Migrations versionnées, appliquées au démarrage, chacune dans sa transaction ;
// `eqp_meta.schema_version` retient la dernière. On ne modifie jamais une
// migration livrée, on en ajoute une.
//
// Rien n'est supprimé : une fiche change de statut (daté) puis s'archive.
// Les pièces de la maison ne sont plus ici depuis la migration 2 : c'est le
// socle commun du document (`rooms`, voir rooms.ts), partagé avec Entretien. L'état de la garantie n'est **jamais** stocké :
// il se calcule à la lecture (voir warranty.ts). Les montants sont en centimes.
import type { Database } from 'better-sqlite3';
import { Migration, runMigrations } from '../storage/migrate';
import { ROOM_ICONS, STARTER_ROOMS, roomKey } from '../rooms';

export const EQP_SCHEMA_VERSION = 2;

/**
 * Migration 2 : les pièces d'Équipements rejoignent le socle commun du
 * document. Chaque pièce de `eqp_rooms` (archivées comprises) devient une pièce
 * de `rooms`, ou retrouve celle qui porte déjà son nom (casse et accents
 * ignorés) ; chaque fiche est rattachée par la nouvelle colonne `room`.
 *
 * `eqp_rooms` et `eqp_items.room_id` restent en place sans plus être lus : une
 * version antérieure de Foyer, restaurée avec cette base, y retrouve ses
 * données. Une migration ultérieure pourra les retirer.
 *
 * Sans foyer (installation neuve, avant l'onboarding), il n'y a ni fiche ni
 * document : rien à reprendre, les pièces de départ naissent avec le foyer.
 */
function moveRoomsToDocument(db: Database): void {
  db.exec('ALTER TABLE eqp_items ADD COLUMN room TEXT');
  db.exec('CREATE INDEX eqp_items_room_ref ON eqp_items(room)');
  const row = db.prepare('SELECT state FROM household WHERE id = 1').get() as { state: string } | undefined;
  if (!row) return;
  const doc = JSON.parse(row.state) as Record<string, any>;
  const rooms: Record<string, any>[] = Array.isArray(doc['rooms']) ? doc['rooms'] : (doc['rooms'] = []);
  const eqp = db.prepare('SELECT id, name, icon, position, archived_at FROM eqp_rooms ORDER BY position, id').all() as
    { id: number; name: string; icon: string; position: number; archived_at: string | null }[];
  const starter = new Map(STARTER_ROOMS().map((r) => [roomKey(r.name), r.id]));
  const setRoom = db.prepare('UPDATE eqp_items SET room = ? WHERE room_id = ?');
  for (const r of eqp) {
    let target = rooms.find((x) => roomKey(String(x?.['name'] ?? '')) === roomKey(r.name));
    if (!target) {
      // Une pièce de départ garde l'identifiant fixe qu'un foyer neuf lui donne.
      const id = starter.get(roomKey(r.name)) && !rooms.some((x) => x?.['id'] === starter.get(roomKey(r.name))) ? starter.get(roomKey(r.name))! : `p-eqp-${r.id}`;
      target = { id, name: r.name, icon: (ROOM_ICONS as readonly string[]).includes(r.icon) ? r.icon : 'autre', position: rooms.length, ...(r.archived_at ? { archived: true } : {}) };
      rooms.push(target);
    }
    setRoom.run(target['id'], r.id);
  }
  db.prepare("UPDATE household SET state = ?, version = version + 1, updated_at = datetime('now') WHERE id = 1").run(JSON.stringify(doc));
}

export const EQP_MIGRATIONS: Migration[] = [
  {
    version: 1,
    label: 'tables du module Équipements et pièces de départ',
    up: (db) => {
      db.exec(`
        CREATE TABLE eqp_rooms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          -- Clé d'icône parmi une liste fermée (voir repo.ts, ROOM_ICONS).
          icon TEXT NOT NULL DEFAULT 'autre',
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          archived_at TEXT
        );

        CREATE TABLE eqp_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER REFERENCES eqp_rooms(id) ON DELETE SET NULL,
          -- Bien immobilier du module Finances (fin_assets.id). Pas de clé
          -- étrangère : la restauration de Finances vide et recharge ses tables,
          -- elle ne doit pas défaire en silence les rattachements d'ici.
          asset_id INTEGER,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'autre',
          brand TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          serial TEXT NOT NULL DEFAULT '',
          purchased_on TEXT,
          purchase_price INTEGER,
          vendor TEXT NOT NULL DEFAULT '',
          -- 'neuf' | 'occasion_pro' | 'occasion_particulier' : la garantie
          -- légale n'est pas la même (voir warranty.ts).
          condition TEXT NOT NULL DEFAULT 'neuf',
          warranty_months INTEGER,
          warranty_until TEXT,
          warranty_note TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          -- 'en_service' | 'en_panne' | 'remplace' | 'donne_vendu' | 'jete'
          status TEXT NOT NULL DEFAULT 'en_service',
          status_on TEXT,
          replaced_by INTEGER REFERENCES eqp_items(id) ON DELETE SET NULL,
          created_by TEXT,
          created_via TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_by TEXT,
          updated_at TEXT,
          archived_at TEXT
        );
        CREATE INDEX eqp_items_room ON eqp_items(room_id);

        -- Une ligne par rattachement d'un fichier à une fiche. Le fichier
        -- lui-même est une ligne de hh_attachments (genre 'equipment') : une
        -- facture groupée jointe à cinq fiches, c'est cinq lignes ici, une ligne
        -- là-bas, un fichier sur le disque.
        CREATE TABLE eqp_attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL REFERENCES eqp_items(id) ON DELETE CASCADE,
          -- 'facture' | 'plaque' | 'notice' | 'photo' | 'autre'
          kind TEXT NOT NULL,
          file_id INTEGER NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          added_by TEXT,
          added_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (item_id, file_id)
        );
        CREATE INDEX eqp_attachments_file ON eqp_attachments(file_id);

        -- L'historique d'un appareil : combien de fois ce lave-linge est tombé
        -- en panne, ce qu'ont coûté les réparations.
        CREATE TABLE eqp_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL REFERENCES eqp_items(id) ON DELETE CASCADE,
          at TEXT NOT NULL,
          -- 'achat' | 'panne' | 'reparation' | 'sav' | 'remplacement' | 'note'
          kind TEXT NOT NULL,
          text TEXT NOT NULL DEFAULT '',
          cost INTEGER,
          created_by TEXT,
          created_via TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          archived_at TEXT
        );
        CREATE INDEX eqp_events_item ON eqp_events(item_id, at);
      `);
      // Les pièces de départ de la première version : la migration 2 les reprend
      // dans le document (rooms.ts). Gardées ici telles qu'elles ont été livrées.
      const ins = db.prepare('INSERT INTO eqp_rooms (name, icon, position) VALUES (?, ?, ?)');
      STARTER_ROOMS().forEach((r, i) => ins.run(r.name, r.icon, i));
    },
  },
  {
    version: 2,
    label: 'pièces reprises dans le socle commun du document',
    up: moveRoomsToDocument,
  },
];

export function migrateEquipements(db: Database): number {
  return runMigrations(db, {
    metaTable: 'eqp_meta',
    label: 'Équipements',
    restoreHint: 'Restaurez votre sauvegarde si nécessaire (voir docs/equipements.md) et signalez l’erreur.',
    migrations: EQP_MIGRATIONS,
  });
}
