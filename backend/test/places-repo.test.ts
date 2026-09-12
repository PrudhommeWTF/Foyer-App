// Le moteur d'opérations est testé à part (places-ops.test.ts). Ici on teste la
// couture avec la base : le journal des rejeux qui survit à un redémarrage, la
// transaction tout-ou-rien, et le fait qu'un enregistrement du document complet,
// aussi périmé soit-il, ne peut plus emporter les lieux ni leurs affaires.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateHousehold } from '../src/storage/schema';
import { applyPlaceOps, getPlaces, initPlaces, preservePlaces } from '../src/places/repo';

let db: Database.Database;

const doc = (over: Record<string, unknown> = {}) => ({
  places: [] as unknown[],
  placeItems: [] as unknown[],
  tasks: [],
  ...over,
});

const seed = (over: Record<string, unknown> = {}): void => {
  db.prepare('INSERT INTO household (id, state, version) VALUES (1, ?, 1)').run(JSON.stringify(doc(over)));
};

const stored = () => JSON.parse((db.prepare('SELECT state FROM household WHERE id = 1').get() as { state: string }).state);

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE household (
    id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  migrateHousehold(db);
  initPlaces(db);
});

describe('application d’un lot', () => {
  it('écrit lieux et affaires dans le document et fait avancer la version', () => {
    seed();
    const before = getPlaces().version;
    const out = applyPlaceOps([
      { opId: 'o1', op: 'place-add', id: 'p1', name: 'Montagne' },
      { opId: 'o2', op: 'add', id: 'i1', placeId: 'p1', name: 'Skis' },
    ]);
    assert.equal(out.applied.length, 2);
    assert.equal(out.version, before + 1);
    assert.equal(stored().places[0].name, 'Montagne');
    assert.equal(stored().placeItems[0].name, 'Skis');
    // Le reste du document est intact : lieux et affaires vivent dedans.
    assert.ok(Array.isArray(stored().tasks));
  });

  it('un lot sans effet ne fait pas tourner la version pour rien', () => {
    seed();
    const before = getPlaces().version;
    const out = applyPlaceOps([{ opId: 'o1', op: 'add', id: 'i1', placeId: 'inconnu', name: 'X' }]);
    assert.equal(out.applied.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.version, before);
  });

  it('le journal survit et rend le rejeu inoffensif', () => {
    seed();
    applyPlaceOps([{ opId: 'o0', op: 'place-add', id: 'p1', name: 'Montagne' }]);
    const add = { opId: 'o1', op: 'add' as const, id: 'i1', placeId: 'p1', name: 'Luge' };
    applyPlaceOps([add]);
    applyPlaceOps([{ opId: 'o2', op: 'remove', id: 'i1' }]);
    assert.equal(getPlaces().items.length, 0);

    // Le téléphone était hors ligne et renvoie sa file : sans le journal,
    // l'affaire supprimée réapparaîtrait.
    const out = applyPlaceOps([add]);
    assert.deepEqual(out.applied, ['o1']);
    assert.equal(getPlaces().items.length, 0);
  });

  it('un lot est tout ou rien : rien n’est écrit si l’écriture échoue', () => {
    seed();
    applyPlaceOps([{ opId: 'o1', op: 'place-add', id: 'p1', name: 'Montagne' }]);
    const snapshot = JSON.stringify(stored());
    db.pragma('query_only = ON');
    assert.throws(() => applyPlaceOps([{ opId: 'o2', op: 'place-add', id: 'p2', name: 'Mer' }]));
    db.pragma('query_only = OFF');
    assert.equal(JSON.stringify(stored()), snapshot);
    const journalled = db.prepare("SELECT COUNT(*) AS n FROM hh_place_ops WHERE op_id = 'o2'").get() as { n: number };
    assert.equal(journalled.n, 0);
  });

  it('supprimer un lieu emporte ses affaires, dans la même transaction', () => {
    seed();
    applyPlaceOps([
      { opId: 'o1', op: 'place-add', id: 'p1', name: 'Montagne' },
      { opId: 'o2', op: 'add', id: 'i1', placeId: 'p1', name: 'Skis' },
    ]);
    applyPlaceOps([{ opId: 'o3', op: 'place-remove', id: 'p1' }]);
    assert.deepEqual(stored().places, []);
    assert.deepEqual(stored().placeItems, []);
  });

  it('un document sans foyer ne fait pas tomber la lecture', () => {
    assert.deepEqual(getPlaces(), { places: [], items: [], version: 0 });
  });
});

describe('un enregistrement du document ne peut plus emporter les lieux', () => {
  it('lieux et affaires du client sont remplacés par ceux du serveur, si vieux soient-ils', () => {
    seed();
    applyPlaceOps([
      { opId: 'o1', op: 'place-add', id: 'p1', name: 'Montagne' },
      { opId: 'o2', op: 'add', id: 'i1', placeId: 'p1', name: 'Skis' },
      { opId: 'o3', op: 'set-state', id: 'i1', state: 'ici', by: 'm2' },
    ]);

    // Le téléphone renvoie l'état chargé il y a deux heures : rien du tout.
    const incoming = doc() as Record<string, any>;
    preservePlaces(incoming);
    assert.equal(incoming['places'].length, 1);
    assert.equal(incoming['placeItems'].length, 1);
    assert.equal(incoming['placeItems'][0].state, 'ici');
    assert.equal(incoming['placeItems'][0].by, 'm2');
  });

  it('un client qui invente des lieux ou des affaires ne les fait pas entrer par cette porte', () => {
    seed();
    const incoming = doc({
      places: [{ id: 'faux', name: 'Injecté', color: '#000', icon: 'map-pin', position: 0 }],
      placeItems: [{ id: 'x', placeId: 'faux', name: 'Injectée', qty: '', state: 'la-bas' }],
    }) as Record<string, any>;
    preservePlaces(incoming);
    assert.deepEqual(incoming['places'], []);
    assert.deepEqual(incoming['placeItems'], []);
  });
});
