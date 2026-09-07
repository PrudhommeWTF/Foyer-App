import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recentActivity, relTime } from './activity';
import { HouseholdState, Message, ShopItem, ShopList, TaskItem, TaskList } from './models';

// Fabriques typées : les fixtures ne portent que ce que le fil lit, mais restent
// de vrais objets du domaine (le typecheck de la CI, tsconfig.test.json, les vérifie).
const tList = (over: Partial<TaskList>): TaskList => ({ id: 'l1', name: 'Liste', color: '#111', icon: 'maison', kind: 'taches', scope: 'shared', position: 0, ...over });
const task = (over: Partial<TaskItem>): TaskItem => ({ id: 't', listId: 'l1', text: 'x', who: [], due: null, done: false, ...over });
const sList = (over: Partial<ShopList>): ShopList => ({ id: 's1', name: 'Courses', color: '#222', icon: 'panier', ...over });
const shop = (over: Partial<ShopItem>): ShopItem => ({ id: 'a', name: 'Article', qty: '', aisleId: 'x', state: 'a-prendre', listId: 's1', ...over });
const msg = (over: Partial<Message>): Message => ({ who: 'm1', text: '', time: '00:00', ...over });

// Un état minimal : seuls les champs que le fil lit comptent. Le reste est vide.
function state(over: Partial<HouseholdState>): HouseholdState {
  return { taskLists: [], tasks: [], shopLists: [], shop: [], msgs: [], ...over } as HouseholdState;
}

describe('recentActivity', () => {
  it('mêle tâches et courses, du plus récent au plus ancien', () => {
    const s = state({
      taskLists: [tList({ id: 'l1', name: 'Maison' })],
      tasks: [
        task({ id: 't1', text: 'Ranger', at: '2026-09-01T08:00:00.000Z', by: 'm1' }),
        task({ id: 't2', text: 'Balayer', at: '2026-09-03T08:00:00.000Z', by: 'm2', done: true, doneAt: '2026-09-04T09:00:00.000Z', doneBy: 'm2' }),
      ],
      shopLists: [sList({ id: 's1', name: 'Drive' })],
      shop: [shop({ id: 'a1', name: 'Lait', state: 'panier', at: '2026-09-05T10:00:00.000Z', by: 'm1' })],
    });
    const feed = recentActivity(s, 12);
    // 2 ajouts de tâche + 1 achèvement + 1 course = 4 entrées, triées desc.
    assert.deepEqual(feed.map((e) => e.at), [
      '2026-09-05T10:00:00.000Z', '2026-09-04T09:00:00.000Z', '2026-09-03T08:00:00.000Z', '2026-09-01T08:00:00.000Z',
    ]);
    assert.equal(feed[0].verb, 'a mis au panier');
    assert.equal(feed[0].where, 'Drive');
    assert.equal(feed[1].verb, 'a terminé');
    assert.equal(feed[2].verb, 'a ajouté');
  });

  it('déplie une ligne par achèvement d’une tâche récurrente', () => {
    const s = state({
      taskLists: [tList({ id: 'l1', name: 'Corvées' })],
      tasks: [
        task({ id: 't1', text: 'Poubelles', at: '2026-08-01T08:00:00.000Z', by: 'm1',
          history: [{ at: '2026-09-01T20:00:00.000Z', by: 'm1', due: '2026-09-01' }, { at: '2026-09-08T20:00:00.000Z', by: 'm2', due: '2026-09-08' }] }),
      ],
    });
    const feed = recentActivity(s, 12);
    const done = feed.filter((e) => e.verb === 'a terminé');
    assert.equal(done.length, 2);
    assert.equal(feed[0].at, '2026-09-08T20:00:00.000Z');
  });

  it('inclut les messages horodatés, tronque les longs, ignore ceux sans date', () => {
    const s = state({
      msgs: [
        msg({ who: 'm1', text: 'Le dîner est prêt !', time: '19:02', at: '2026-09-06T17:02:00.000Z' }),
        msg({ who: 'm2', text: 'x'.repeat(200), time: '08:00', at: '2026-09-06T06:00:00.000Z' }),
        msg({ who: 'm1', text: 'Ancien message', time: '10:00' }),
      ],
    });
    const feed = recentActivity(s, 12);
    assert.equal(feed.length, 2);
    assert.equal(feed[0].verb, 'a écrit');
    assert.equal(feed[0].what, 'Le dîner est prêt !');
    assert.equal(feed[0].where, 'Messagerie');
    assert.ok(feed[1].what.endsWith('…') && feed[1].what.length <= 121);
  });

  it('respecte la limite', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task({ id: 't' + i, at: `2026-09-${String(i + 1).padStart(2, '0')}T08:00:00.000Z`, by: 'm1' }));
    const s = state({ taskLists: [tList({ id: 'l1', name: 'L' })], tasks });
    assert.equal(recentActivity(s, 5).length, 5);
  });
});

describe('relTime', () => {
  const now = new Date('2026-09-07T12:00:00.000Z').getTime();
  it('classe les instants en tranches françaises', () => {
    assert.equal(relTime('2026-09-07T11:59:40.000Z', now), 'à l’instant');
    assert.equal(relTime('2026-09-07T11:45:00.000Z', now), 'il y a 15 min');
    assert.equal(relTime('2026-09-07T09:00:00.000Z', now), 'il y a 3 h');
    assert.equal(relTime('2026-09-06T12:00:00.000Z', now), 'hier');
    assert.equal(relTime('2026-09-04T12:00:00.000Z', now), 'il y a 3 j');
    assert.equal(relTime('2026-08-20T12:00:00.000Z', now), 'il y a 2 sem');
  });
  it('rend une date courte au-delà d’un mois', () => {
    assert.equal(relTime('2026-06-15T12:00:00.000Z', now), '15 juin');
  });
});
