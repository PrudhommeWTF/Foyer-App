// La couture du canal push avec la base : abonnements, envoi idempotent par
// clé et par membre, appareils morts retirés, journal lisible, planificateur
// qui ne renvoie rien deux fois et note ce qu'il a manqué.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateHousehold } from '../src/storage/schema';
import { addDevice, initPush, isSubscription, listDevices, notify, publicKey, recentSends, removeDevice, setSender } from '../src/notify/push';
import { tick } from '../src/notify/scheduler';
import { applyTaskOps, initTasks, onAssigned } from '../src/tasks/repo';
import { TaskItem } from '../src/tasks/ops';

let db: Database.Database;
let sent: { endpoint: string; title: string; kind: string }[];
let failWith: Record<string, number> = {};

const sub = (n: string) => ({ endpoint: 'https://push.example/' + n, keys: { p256dh: 'p', auth: 'a' } });
const task = (over: Partial<TaskItem> = {}): TaskItem =>
  ({ id: 't1', listId: 'l1', text: 'Plombier', who: ['m1'], due: '2026-09-05', time: '18:00', done: false, remind: 'at', ...over });

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE household (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  migrateHousehold(db);
  initTasks(db);
  initPush(db);
  sent = [];
  failWith = {};
  setSender(async (d, p) => {
    const code = failWith[d.endpoint];
    if (code) { const e = new Error('push refusé') as Error & { statusCode: number }; e.statusCode = code; throw e; }
    sent.push({ endpoint: d.endpoint, title: p.title, kind: p.kind });
  });
});

describe('clés et abonnements', () => {
  it('les clés VAPID sont générées une fois et gardées en base', () => {
    const k1 = publicKey();
    const again = initPush(db);
    assert.equal(again.generated, false);
    assert.equal(again.publicKey, k1);
  });

  it('un abonnement ré-envoyé ne fait pas de doublon, et un membre ne retire que les siens', () => {
    addDevice('m1', sub('a'), 'iPhone');
    addDevice('m1', sub('a'), 'iPhone encore');
    addDevice('me', sub('b'), 'Mac');
    assert.equal(listDevices('m1').length, 1);
    assert.equal(removeDevice('me', listDevices('m1')[0].id), false, 'pas le sien');
    assert.equal(removeDevice('m1', listDevices('m1')[0].id), true);
    assert.equal(listDevices().length, 1);
  });

  it('un abonnement illisible est refusé avant d’atteindre la base', () => {
    assert.equal(isSubscription({ endpoint: 'http://pas-https', keys: { p256dh: 'p', auth: 'a' } }), false);
    assert.equal(isSubscription({ endpoint: 'https://ok', keys: { p256dh: 'p' } }), false);
    assert.equal(isSubscription(sub('x')), true);
  });
});

describe('envoi', () => {
  it('envoie à tous les appareils du membre, et pas deux fois pour la même clé', async () => {
    addDevice('m1', sub('a'), ''); addDevice('m1', sub('b'), '');
    const r1 = await notify('k1', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    assert.equal(r1.members[0].status, 'sent');
    assert.equal(r1.members[0].devices, 2);
    const r2 = await notify('k1', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    assert.equal(r2.members[0].status, 'skipped');
    assert.equal(sent.length, 2, 'un redémarrage au milieu de la minute ne renvoie rien');
  });

  it('un membre sans appareil est noté « aucun appareil », visiblement', async () => {
    const r = await notify('k2', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    assert.equal(r.members[0].status, 'no-device');
    assert.equal(recentSends()[0].status, 'no-device');
  });

  it('un appareil que le service déclare mort est retiré, et l’erreur reste lisible', async () => {
    addDevice('m1', sub('a'), 'iPhone'); addDevice('m1', sub('b'), 'iPad');
    failWith['https://push.example/a'] = 410;
    const r = await notify('k3', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    assert.equal(r.members[0].status, 'sent', 'l’iPad a reçu');
    assert.equal(listDevices('m1').length, 1, 'l’iPhone dont l’abonnement est mort a été retiré');
    failWith['https://push.example/b'] = 500;
    const r2 = await notify('k4', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    assert.equal(r2.members[0].status, 'failed');
    assert.match(r2.members[0].error!, /HTTP 500/);
    assert.equal(listDevices('m1').length, 1, 'une panne passagère ne retire pas l’appareil');
    assert.match(listDevices('m1')[0].lastError!, /500/);
  });
});

describe('planificateur', () => {
  const deps = (tasks: TaskItem[], log: string[]) => ({ tasks: () => tasks, accounts: () => ['me', 'm1'], url: () => '', log: (l: string) => log.push(l) });

  it('envoie ce qui est dû, note ce qui est manqué, et ne recommence pas au passage suivant', async () => {
    addDevice('m1', sub('a'), ''); addDevice('me', sub('b'), '');
    const log: string[] = [];
    const tasks = [task({ id: 'a', time: '18:00' }), task({ id: 'b', time: '12:00' }), task({ id: 'c', who: [], time: '17:45' })];
    await tick(deps(tasks, log), '2026-09-05T18:00');
    assert.deepEqual(sent.map((s) => s.endpoint.slice(-1)).sort(), ['a', 'a', 'b'], 'a → m1 ; c sans responsable → m1 et me');
    assert.ok(log.some((l) => l.includes('manqué') && l.includes('Plombier')), 'b est noté manqué, pas envoyé à 18 h');
    assert.ok(recentSends().some((s) => s.status === 'missed'));
    await tick(deps(tasks, log), '2026-09-05T18:01');
    assert.equal(sent.length, 3, 'rien de plus au passage suivant');
  });

  it('une tâche faite entre-temps n’est plus rappelée ; reportée, elle l’est à nouveau', async () => {
    addDevice('m1', sub('a'), '');
    const log: string[] = [];
    await tick(deps([task({ done: true })], log), '2026-09-05T18:00');
    assert.equal(sent.length, 0);
    await tick(deps([task()], log), '2026-09-05T18:00');
    await tick(deps([task({ due: '2026-09-06' })], log), '2026-09-06T18:00');
    assert.equal(sent.length, 2);
  });
});

describe('affectation par quelqu’un d’autre', () => {
  it('signale les membres nouvellement affectés, avec l’opération, et pas l’auteur', () => {
    db.prepare('INSERT INTO household (id, state, version) VALUES (1, ?, 1)').run(JSON.stringify({
      members: [{ id: 'me' }, { id: 'm1' }], taskLists: [{ id: 'l1' }], shopLists: [], tasks: [],
    }));
    const got: string[] = [];
    onAssigned((memberId, t, opId) => got.push(`${memberId}:${t.id}:${opId}`));
    applyTaskOps([{ opId: 'o1', op: 'add', id: 't1', listId: 'l1', text: 'x', who: ['me', 'm1'], by: 'me' }]);
    applyTaskOps([{ opId: 'o2', op: 'edit', id: 't1', who: ['me', 'm1'], by: 'm1' }]);
    // Retiré puis remis dans le même lot : aucun changement net, personne n'est prévenu.
    applyTaskOps([{ opId: 'o3', op: 'edit', id: 't1', who: ['m1'], by: 'm1' }, { opId: 'o4', op: 'edit', id: 't1', who: ['m1', 'me'], by: 'm1' }]);
    applyTaskOps([{ opId: 'o5', op: 'edit', id: 't1', who: ['m1'], by: 'm1' }]);
    applyTaskOps([{ opId: 'o6', op: 'edit', id: 't1', who: ['m1', 'me'], by: 'm1' }]);
    onAssigned(null);
    assert.deepEqual(got, ['m1:t1:o1', 'me:t1:o6']);
  });
});
