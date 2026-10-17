// Reprise des pièces d'Équipements (table eqp_rooms de la première version)
// dans le socle Maison du document, partagé avec Entretien. Sur une base en
// mémoire : la reprise s'exécute au démarrage, une seule fois.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateEquipements } from '../src/equipements/schema';
import { adoptSharedRooms } from '../src/equipements/rooms';

/** Une base qui a connu la migration 1 avec un foyer existant, puis passe à la 2. */
function baseV1(rooms: unknown[]): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE household (id INTEGER PRIMARY KEY, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT)');
  db.prepare('INSERT INTO household (id, state) VALUES (1, ?)').run(JSON.stringify({ familyName: 'Test', rooms }));
  return db;
}
const doc = (db: Database.Database) => JSON.parse((db.prepare('SELECT state FROM household').get() as { state: string }).state);
const ref = (db: Database.Database, id: number) => (db.prepare('SELECT room_ref FROM eqp_items WHERE id = ?').get(id) as { room_ref: string | null }).room_ref;

describe('Équipements : reprise des pièces dans le socle partagé', () => {
  it('socle vide : les pièces sont recopiées dans l’ordre, renommage compris, et les fiches suivent', () => {
    const db = baseV1([]);
    migrateEquipements(db);
    db.prepare("UPDATE eqp_rooms SET name = 'Chambre de Nolan' WHERE name = 'Chambre 1'").run();
    db.prepare("UPDATE eqp_rooms SET archived_at = datetime('now') WHERE name = 'Cave'").run();
    const cuisine = (db.prepare("SELECT id FROM eqp_rooms WHERE name = 'Cuisine'").get() as { id: number }).id;
    db.prepare('INSERT INTO eqp_items (name, room_id) VALUES (?, ?)').run('Lave-vaisselle', cuisine);
    db.prepare('INSERT INTO eqp_items (name) VALUES (?)').run('Sans pièce');
    adoptSharedRooms(db);
    const rooms = doc(db).rooms as { id: string; name: string; position: number }[];
    assert.deepEqual(rooms.map((r) => r.name), ['Cuisine', 'Salon', 'Salle de bain', 'Chambre de Nolan', 'Chambre 2', 'Bureau', 'Buanderie', 'Garage', 'Extérieur'], 'la pièce archivée ne revient pas');
    assert.equal(ref(db, 1), rooms[0].id);
    assert.equal(ref(db, 2), null);
    const v = (db.prepare('SELECT version FROM household').get() as { version: number }).version;
    adoptSharedRooms(db);
    assert.equal((db.prepare('SELECT version FROM household').get() as { version: number }).version, v, 'une seule fois');
  });

  it('socle déjà rempli : on rattache par nom (casse et accents ignorés), on ne crée que ce qui manque', () => {
    const db = baseV1([{ id: 'x1', name: 'CUISINE', position: 0 }]);
    migrateEquipements(db);
    const id = (n: string) => (db.prepare('SELECT id FROM eqp_rooms WHERE name = ?').get(n) as { id: number }).id;
    db.prepare('INSERT INTO eqp_items (name, room_id) VALUES (?, ?)').run('Four', id('Cuisine'));
    db.prepare('INSERT INTO eqp_items (name, room_id) VALUES (?, ?)').run('Chaudière', id('Cave'));
    adoptSharedRooms(db);
    const rooms = doc(db).rooms as { id: string; name: string }[];
    assert.deepEqual(rooms.map((r) => r.name), ['CUISINE', 'Cave'], 'les autres pièces de départ ne sont pas imposées');
    assert.equal(ref(db, 1), 'x1');
    assert.equal(ref(db, 2), rooms[1].id);
  });

  it('installation neuve (pas encore de foyer) : rien à reprendre, jamais', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE household (id INTEGER PRIMARY KEY, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT)');
    migrateEquipements(db);
    db.prepare('INSERT INTO household (id, state) VALUES (1, ?)').run(JSON.stringify({ rooms: [] }));
    adoptSharedRooms(db);
    assert.deepEqual(doc(db).rooms, [], 'le foyer neuf garde un socle vide');
  });
});
