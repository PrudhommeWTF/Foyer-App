import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recentActivity, relTime } from './activity';
import { HouseholdState } from './models';

// Un état minimal : seuls les champs que le fil lit comptent. Le reste est vide.
function state(over: Partial<HouseholdState>): HouseholdState {
  return {
    taskLists: [], tasks: [], shopLists: [], shop: [],
    ...over,
  } as unknown as HouseholdState;
}

describe('recentActivity', () => {
  it('mêle tâches et courses, du plus récent au plus ancien', () => {
    const s = state({
      taskLists: [{ id: 'l1', name: 'Maison', color: '#111' }] as HouseholdState['taskLists'],
      tasks: [
        { id: 't1', listId: 'l1', text: 'Ranger', at: '2026-09-01T08:00:00.000Z', by: 'm1' },
        { id: 't2', listId: 'l1', text: 'Balayer', at: '2026-09-03T08:00:00.000Z', by: 'm2', done: true, doneAt: '2026-09-04T09:00:00.000Z', doneBy: 'm2' },
      ] as HouseholdState['tasks'],
      shopLists: [{ id: 's1', name: 'Drive', color: '#222' }] as HouseholdState['shopLists'],
      shop: [
        { id: 'a1', name: 'Lait', listId: 's1', state: 'panier', at: '2026-09-05T10:00:00.000Z', by: 'm1' },
      ] as HouseholdState['shop'],
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
      taskLists: [{ id: 'l1', name: 'Corvées', color: '#111' }] as HouseholdState['taskLists'],
      tasks: [
        { id: 't1', listId: 'l1', text: 'Poubelles', at: '2026-08-01T08:00:00.000Z', by: 'm1', rec: 'weekly',
          history: [{ at: '2026-09-01T20:00:00.000Z', by: 'm1', due: '2026-09-01' }, { at: '2026-09-08T20:00:00.000Z', by: 'm2', due: '2026-09-08' }] },
      ] as HouseholdState['tasks'],
    });
    const feed = recentActivity(s, 12);
    const done = feed.filter((e) => e.verb === 'a terminé');
    assert.equal(done.length, 2);
    assert.equal(feed[0].at, '2026-09-08T20:00:00.000Z');
  });

  it('inclut les messages horodatés, tronque les longs, ignore ceux sans date', () => {
    const s = state({
      msgs: [
        { who: 'm1', text: 'Le dîner est prêt !', time: '19:02', at: '2026-09-06T17:02:00.000Z' },
        { who: 'm2', text: 'x'.repeat(200), time: '08:00', at: '2026-09-06T06:00:00.000Z' },
        { who: 'm1', text: 'Ancien message', time: '10:00' },
      ] as HouseholdState['msgs'],
    });
    const feed = recentActivity(s, 12);
    assert.equal(feed.length, 2);
    assert.equal(feed[0].verb, 'a écrit');
    assert.equal(feed[0].what, 'Le dîner est prêt !');
    assert.equal(feed[0].where, 'Messagerie');
    assert.ok(feed[1].what.endsWith('…') && feed[1].what.length <= 121);
  });

  it('respecte la limite', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({ id: 't' + i, listId: 'l1', text: 'x', at: `2026-09-${String(i + 1).padStart(2, '0')}T08:00:00.000Z`, by: 'm1' }));
    const s = state({ taskLists: [{ id: 'l1', name: 'L', color: '#111' }] as HouseholdState['taskLists'], tasks: tasks as HouseholdState['tasks'] });
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
