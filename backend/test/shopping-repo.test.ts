// Le moteur d'opérations est testé à part (shopping-ops.test.ts). Ici on teste
// la couture avec la base : le journal des rejeux qui survit à un redémarrage,
// et surtout le fait qu'un enregistrement du document complet, aussi périmé
// soit-il, ne peut plus emporter la liste de courses.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateHousehold } from '../src/storage/schema';
import { applyShoppingOps, getShopping, initShopping, preserveShopping } from '../src/shopping/repo';
import { ShopItem } from '../src/shopping/ops';

let db: Database.Database;

const doc = (over: Record<string, unknown> = {}) => ({
  aisles: [
    { id: 'a1', name: 'Frais', color: '#4E93B8', position: 0 },
    { id: 'a-tri', name: 'À trier', color: '#8A7E74', position: 1 },
  ],
  shopLists: [{ id: 'cl1', name: 'Semaine', color: '#7A9B76', icon: 'panier' }],
  shop: [] as ShopItem[],
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
  initShopping(db);
});

describe('application d’un lot', () => {
  it('écrit les articles dans le document et fait avancer la version', () => {
    seed();
    const before = getShopping().version;
    const out = applyShoppingOps([{ opId: 'o1', op: 'add', id: 's1', name: 'Beurre', aisleId: 'a1', listId: 'cl1' }]);
    assert.equal(out.applied.length, 1);
    assert.equal(out.version, before + 1);
    assert.equal(stored().shop[0].name, 'Beurre');
    // Le reste du document est intact : la liste vit dedans, elle ne le remplace pas.
    assert.ok(Array.isArray(stored().tasks));
  });

  it('un lot sans effet ne fait pas tourner la version pour rien', () => {
    seed();
    const before = getShopping().version;
    // Que du refusé : les autres téléphones n'ont aucune raison de se recharger.
    const out = applyShoppingOps([{ opId: 'o1', op: 'add', id: 's1', name: 'X', aisleId: 'inconnu', listId: 'cl1' }]);
    assert.equal(out.applied.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.version, before);
  });

  it('le journal survit et rend le rejeu inoffensif', () => {
    seed();
    const add = { opId: 'o1', op: 'add' as const, id: 's1', name: 'Coriandre', aisleId: 'a1', listId: 'cl1' };
    applyShoppingOps([add]);
    applyShoppingOps([{ opId: 'o2', op: 'remove', id: 's1' }]);
    assert.equal(getShopping().items.length, 0);

    // Le téléphone était hors ligne et renvoie sa file : sans le journal,
    // l'article supprimé réapparaîtrait.
    const out = applyShoppingOps([add]);
    assert.deepEqual(out.applied, ['o1']);
    assert.equal(getShopping().items.length, 0);
  });

  it('un lot est tout ou rien : rien n’est écrit si l’écriture échoue', () => {
    seed();
    applyShoppingOps([{ opId: 'o1', op: 'add', id: 's1', name: 'Beurre', aisleId: 'a1', listId: 'cl1' }]);
    const snapshot = JSON.stringify(stored());
    // Une base en lecture seule fait échouer l'écriture au milieu de la transaction.
    db.pragma('query_only = ON');
    assert.throws(() => applyShoppingOps([{ opId: 'o2', op: 'add', id: 's2', name: 'Lait', aisleId: 'a1', listId: 'cl1' }]));
    db.pragma('query_only = OFF');
    assert.equal(JSON.stringify(stored()), snapshot);
    // Le journal non plus n'a rien retenu : l'opération repartira intacte.
    const journalled = db.prepare("SELECT COUNT(*) AS n FROM hh_shop_ops WHERE op_id = 'o2'").get() as { n: number };
    assert.equal(journalled.n, 0);
  });

  it('un document sans foyer ne fait pas tomber la lecture', () => {
    assert.deepEqual(getShopping(), { items: [], version: 0 });
  });
});

describe('un enregistrement du document ne peut plus emporter la liste', () => {
  it('la liste du client est remplacée par celle du serveur, si vieille soit-elle', () => {
    seed();
    applyShoppingOps([
      { opId: 'o1', op: 'add', id: 's1', name: 'Beurre', aisleId: 'a1', listId: 'cl1' },
      { opId: 'o2', op: 'set-state', id: 's1', state: 'panier', by: 'm2' },
    ]);

    // Le téléphone de la maison renvoie l'état qu'il a chargé il y a deux heures :
    // pas d'article du tout. C'est exactement le scénario qui décochait tout.
    const incoming = doc({ shop: [] }) as Record<string, any>;
    preserveShopping(incoming);
    assert.equal(incoming['shop'].length, 1);
    assert.equal(incoming['shop'][0].state, 'panier');
    assert.equal(incoming['shop'][0].by, 'm2');
  });

  it('un client qui invente des articles ne les fait pas entrer par cette porte', () => {
    seed();
    const incoming = doc({ shop: [{ id: 'faux', name: 'Injecté', qty: '', aisleId: 'a1', state: 'a-prendre', listId: 'cl1' }] }) as Record<string, any>;
    preserveShopping(incoming);
    assert.deepEqual(incoming['shop'], []);
  });

  it('supprimer un rayon renvoie ses articles dans « À trier »', () => {
    seed();
    applyShoppingOps([{ opId: 'o1', op: 'add', id: 's1', name: 'Beurre', aisleId: 'a1', listId: 'cl1' }]);
    // Les rayons, eux, s'éditent bien par le document complet.
    const incoming = doc({ aisles: [{ id: 'a-tri', name: 'À trier', color: '#8A7E74', position: 0 }] }) as Record<string, any>;
    const res = preserveShopping(incoming);
    assert.equal(res.movedToFallback, 1);
    assert.equal(incoming['shop'][0].aisleId, 'a-tri');
  });

  it('supprimer une liste emporte ses articles', () => {
    seed();
    applyShoppingOps([{ opId: 'o1', op: 'add', id: 's1', name: 'Beurre', aisleId: 'a1', listId: 'cl1' }]);
    const incoming = doc({ shopLists: [] }) as Record<string, any>;
    const res = preserveShopping(incoming);
    assert.equal(res.dropped, 1);
    assert.deepEqual(incoming['shop'], []);
  });

  it('le rayon de repli est recréé s’il a été supprimé, pour ne perdre personne', () => {
    seed();
    applyShoppingOps([{ opId: 'o1', op: 'add', id: 's1', name: 'Beurre', aisleId: 'a1', listId: 'cl1' }]);
    const incoming = doc({ aisles: [] }) as Record<string, any>;
    preserveShopping(incoming);
    const tri = incoming['aisles'].find((a: any) => a.name === 'À trier');
    assert.ok(tri, 'sans rayon de repli, l’article atterrirait dans un rayon que l’écran ignore');
    assert.equal(incoming['shop'][0].aisleId, tri.id);
  });
});
