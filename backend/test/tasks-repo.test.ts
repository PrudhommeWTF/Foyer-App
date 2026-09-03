// Le moteur d'opérations est testé à part (tasks-ops.test.ts). Ici on teste la
// couture avec la base : le journal des rejeux qui survit à un redémarrage, et
// surtout le fait qu'un enregistrement du document complet, aussi périmé soit-il,
// ne peut plus emporter une coche ni une tâche.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateHousehold } from '../src/storage/schema';
import { applyTaskOps, getTasks, initTasks, preserveTasks } from '../src/tasks/repo';
import { TaskItem } from '../src/tasks/ops';

let db: Database.Database;

const doc = (over: Record<string, unknown> = {}) => ({
  members: [{ id: 'me', name: 'Thomas' }, { id: 'm1', name: 'Léa' }],
  taskLists: [{ id: 'l1', name: 'Maison', kind: 'taches', scope: 'shared', position: 0 }],
  shopLists: [{ id: 'cl1', name: 'Semaine' }],
  shop: [],
  tasks: [] as TaskItem[],
  ...over,
});

const seed = (over: Record<string, unknown> = {}): void => {
  db.prepare('INSERT INTO household (id, state, version) VALUES (1, ?, 1)').run(JSON.stringify(doc(over)));
};

const stored = () => JSON.parse((db.prepare('SELECT state FROM household WHERE id = 1').get() as { state: string }).state);
const add = (opId: string, id: string, text: string) => ({ opId, op: 'add', id, listId: 'l1', text });

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE household (
    id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  migrateHousehold(db);
  initTasks(db);
});

describe('application d’un lot', () => {
  it('écrit les tâches dans le document et fait avancer la version', () => {
    seed();
    const before = getTasks().version;
    const out = applyTaskOps([add('o1', 't1', 'Poubelles')]);
    assert.equal(out.applied.length, 1);
    assert.equal(out.version, before + 1);
    assert.equal(stored().tasks[0].text, 'Poubelles');
  });

  it('un lot entièrement écarté ne fait pas tourner la version', () => {
    seed();
    const before = getTasks().version;
    const out = applyTaskOps([{ opId: 'o1', op: 'add', id: 't1', listId: 'perdue', text: 'x' }]);
    assert.equal(out.applied.length, 0);
    assert.equal(out.version, before, 'les autres téléphones n’ont aucune raison de se recharger');
  });

  it('le journal retient les opérations appliquées : un rejeu ne refait rien', () => {
    seed();
    applyTaskOps([add('o1', 't1', 'Poubelles')]);
    applyTaskOps([{ opId: 'o2', op: 'remove', id: 't1' }]);
    // La file du premier téléphone repart après une coupure : l'ajout est déjà passé.
    const out = applyTaskOps([add('o1', 't1', 'Poubelles')]);
    assert.deepEqual(out.applied, ['o1'], 'acquitté, pour sortir de la file');
    assert.equal(stored().tasks.length, 0, 'mais la tâche supprimée entre-temps ne revient pas');
  });

  it('deux téléphones qui cochent la même tâche : elle reste cochée, une seule fois', () => {
    seed({ tasks: [{ id: 't1', listId: 'l1', text: 'Poubelles', who: [], due: null, done: false }] });
    applyTaskOps([{ opId: 'a', op: 'done', id: 't1', by: 'me', at: '2026-09-05T10:00:00Z' }]);
    applyTaskOps([{ opId: 'b', op: 'done', id: 't1', by: 'm1', at: '2026-09-05T10:00:03Z' }]);
    const t = stored().tasks[0];
    assert.equal(t.done, true);
    assert.equal(t.doneBy, 'me');
  });
});

describe('enregistrement du document complet', () => {
  it('un client périmé ne peut plus emporter les tâches : ce sont celles du serveur qui restent', () => {
    seed();
    applyTaskOps([add('o1', 't1', 'Poubelles')]);
    applyTaskOps([{ opId: 'o2', op: 'done', id: 't1', by: 'me' }]);
    // Le second téléphone enregistre un document vieux d'une heure : t1 pas
    // cochée, et une tâche « t0 » que le premier a supprimée depuis.
    const incoming = doc({ tasks: [{ id: 't1', listId: 'l1', text: 'Poubelles', who: [], due: null, done: false }, { id: 't0', listId: 'l1', text: 'Fantôme', who: [], due: null, done: false }] });
    preserveTasks(incoming);
    assert.equal(incoming.tasks.length, 1, 'le fantôme ne revient pas');
    assert.equal(incoming.tasks[0].done, true, 'et la coche ne se défait pas');
  });

  it('une liste supprimée par le document entrant emporte ses tâches, et le dit', () => {
    seed({ taskLists: [{ id: 'l1', name: 'Maison' }, { id: 'l2', name: 'Valise' }] });
    applyTaskOps([add('o1', 't1', 'Poubelles'), { opId: 'o2', op: 'add', id: 't2', listId: 'l2', text: 'Maillots' }]);
    const incoming = doc();
    const kept = preserveTasks(incoming);
    assert.equal(kept.dropped, 1);
    assert.deepEqual(incoming.tasks.map((t: TaskItem) => t.id), ['t1']);
  });

  it('un membre retiré du foyer quitte les affectations ; la tâche reste', () => {
    seed();
    applyTaskOps([{ opId: 'o1', op: 'add', id: 't1', listId: 'l1', text: 'Poubelles', who: ['me', 'm1'] }]);
    const incoming = doc({ members: [{ id: 'me', name: 'Thomas' }] });
    const kept = preserveTasks(incoming);
    assert.equal(kept.unassigned, 1);
    assert.deepEqual(incoming.tasks[0].who, ['me']);
  });
});
