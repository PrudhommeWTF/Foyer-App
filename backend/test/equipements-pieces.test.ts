// Migration 2 d'Équipements : les pièces de `eqp_rooms` rejoignent le socle
// commun du document (`rooms`), partagé avec Entretien. Ce qui compte : aucune
// fiche ne perd sa pièce, une pièce déjà au document n'est pas doublée, une
// pièce archivée le reste, et sans foyer il n'y a rien à faire.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { EQP_MIGRATIONS, EQP_SCHEMA_VERSION, migrateEquipements } from '../src/equipements/schema';
import { runMigrations } from '../src/storage/migrate';

function base(doc: Record<string, unknown> | null): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE household (id INTEGER PRIMARY KEY, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at TEXT)");
  if (doc) db.prepare('INSERT INTO household (id, state) VALUES (1, ?)').run(JSON.stringify(doc));
  // La base telle qu'Équipements 1/3 l'a laissée : schéma 1, pièces de départ.
  runMigrations(db, { metaTable: 'eqp_meta', label: 'Équipements', restoreHint: '', migrations: EQP_MIGRATIONS.filter((m) => m.version === 1) });
  return db;
}
const docOf = (db: Database.Database): Record<string, any> => JSON.parse((db.prepare('SELECT state FROM household WHERE id = 1').get() as { state: string }).state);

describe('Équipements, migration 2 : pièces au socle commun', () => {
  it('reprend les pièces au document, rattache les fiches, ne double pas une pièce de même nom', () => {
    // Un foyer qui a déjà une « cuisine » (Entretien) et rien d'autre.
    const db = base({ rooms: [{ id: 'x-cuisine', name: 'cuisine ', position: 0 }], taskLists: [] });
    const roomId = (name: string): number => (db.prepare('SELECT id FROM eqp_rooms WHERE name = ?').get(name) as { id: number }).id;
    db.prepare("UPDATE eqp_rooms SET name = 'Chambre de Nolan', archived_at = datetime('now') WHERE name = 'Chambre 1'").run();
    db.prepare("INSERT INTO eqp_rooms (name, icon, position) VALUES ('Atelier', 'bidon', 10)").run();
    const ins = db.prepare('INSERT INTO eqp_items (name, room_id) VALUES (?, ?)');
    ins.run('Lave-vaisselle', roomId('Cuisine'));
    ins.run('Lampe', roomId('Chambre de Nolan'));
    ins.run('Établi', roomId('Atelier'));
    ins.run('Radio', null);

    assert.equal(migrateEquipements(db), EQP_SCHEMA_VERSION);
    const rooms = docOf(db)['rooms'] as { id: string; name: string; icon?: string; archived?: boolean }[];
    assert.equal(rooms.length, 11, 'la cuisine existante, les neuf autres pièces de départ et l’Atelier');
    assert.equal(rooms.filter((r) => r.name.trim().toLowerCase() === 'cuisine').length, 1, 'pas de seconde cuisine');
    assert.equal(rooms.find((r) => r.name === 'Salon')?.id, 'p-salon', 'une pièce de départ garde l’identifiant d’un foyer neuf');
    assert.equal(rooms.find((r) => r.name === 'Chambre de Nolan')?.archived, true);
    assert.equal(rooms.find((r) => r.name === 'Atelier')?.icon, 'autre', 'une icône inconnue devient « autre »');

    const room = (name: string) => (db.prepare('SELECT room FROM eqp_items WHERE name = ?').get(name) as { room: string | null }).room;
    assert.equal(room('Lave-vaisselle'), 'x-cuisine');
    assert.equal(room('Lampe'), rooms.find((r) => r.name === 'Chambre de Nolan')?.id);
    assert.equal(room('Établi'), rooms.find((r) => r.name === 'Atelier')?.id);
    assert.equal(room('Radio'), null);
  });

  it('sans foyer (avant l’onboarding) : la colonne est posée, rien d’autre', () => {
    const db = base(null);
    assert.equal(migrateEquipements(db), EQP_SCHEMA_VERSION);
    assert.ok((db.prepare('PRAGMA table_info(eqp_items)').all() as { name: string }[]).some((c) => c.name === 'room'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM household').get() && (db.prepare('SELECT COUNT(*) AS n FROM household').get() as { n: number }).n, 0);
  });

  it('rejouée, elle ne fait rien : la version est acquise', () => {
    const db = base({ rooms: [], taskLists: [] });
    migrateEquipements(db);
    const avant = JSON.stringify(docOf(db));
    assert.equal(migrateEquipements(db), EQP_SCHEMA_VERSION);
    assert.equal(JSON.stringify(docOf(db)), avant);
  });
});
