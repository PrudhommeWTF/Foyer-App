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
// Rien n'est supprimé : une fiche change de statut (daté) puis s'archive ; une
// pièce de la maison s'archive. L'état de la garantie n'est **jamais** stocké :
// il se calcule à la lecture (voir warranty.ts). Les montants sont en centimes.
import type { Database } from 'better-sqlite3';
import { Migration, runMigrations } from '../storage/migrate';

export const EQP_SCHEMA_VERSION = 2;

/**
 * Les pièces de départ de la migration 1, quand le module rangeait ses pièces
 * dans `eqp_rooms`. Depuis la migration 2, les pièces vivent dans le **socle
 * Maison** du document (`rooms`), partagé avec Entretien : `eqp_rooms` ne sert
 * plus qu'à la reprise des installations qui l'ont connue (voir rooms.ts), et
 * l'écran propose sa propre liste de départ quand le socle est vide.
 */
export const STARTER_ROOMS: readonly { name: string; icon: string }[] = [
  { name: 'Cuisine', icon: 'cuisine' },
  { name: 'Salon', icon: 'salon' },
  { name: 'Salle de bain', icon: 'bain' },
  { name: 'Chambre 1', icon: 'chambre' },
  { name: 'Chambre 2', icon: 'chambre' },
  { name: 'Bureau', icon: 'bureau' },
  { name: 'Buanderie', icon: 'buanderie' },
  { name: 'Garage', icon: 'garage' },
  { name: 'Cave', icon: 'cave' },
  { name: 'Extérieur', icon: 'exterieur' },
];

export function seedRooms(db: Database): void {
  const ins = db.prepare('INSERT INTO eqp_rooms (name, icon, position) VALUES (?, ?, ?)');
  STARTER_ROOMS.forEach((r, i) => ins.run(r.name, r.icon, i));
}

const MIGRATIONS: Migration[] = [
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
      seedRooms(db);
    },
  },
  {
    version: 2,
    label: 'fiches rattachées aux pièces partagées du foyer',
    up: (db) => {
      // La pièce d'une fiche désigne désormais une pièce du socle Maison
      // (document, identifiant texte), la même liste que celle d'Entretien.
      // room_id et eqp_rooms restent en place, inutilisés après la reprise :
      // une migration additive ne supprime rien.
      db.exec('ALTER TABLE eqp_items ADD COLUMN room_ref TEXT');
      // Pas encore de foyer (installation neuve) : les pièces de départ de la
      // migration 1 n'ont servi à personne, il n'y a rien à reprendre. Le
      // foyer naîtra avec un socle vide, comme Entretien le veut.
      if (!db.prepare('SELECT 1 FROM household WHERE id = 1').get()) {
        db.prepare("INSERT OR REPLACE INTO eqp_meta (key, value) VALUES ('rooms_adopted', 'installation neuve')").run();
      }
    },
  },
];

export function migrateEquipements(db: Database): number {
  return runMigrations(db, {
    metaTable: 'eqp_meta',
    label: 'Équipements',
    restoreHint: 'Restaurez votre sauvegarde si nécessaire (voir docs/equipements.md) et signalez l’erreur.',
    migrations: MIGRATIONS,
  });
}
