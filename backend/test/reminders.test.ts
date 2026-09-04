// Quand une tâche rappelle, à qui, et une seule fois. Une tâche non rappelée
// est une tâche oubliée : ces tests fixent l'heure exacte du rappel dans les
// quatre réglages, le fuseau du foyer, la fenêtre de rattrapage après une
// coupure, et le partage entre membres affectés ou tout le foyer.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskItem } from '../src/tasks/ops';
import { assignedBy, dueReminders, fireAt, parisWall, wallAdd, whenLabel } from '../src/notify/reminders';

const task = (over: Partial<TaskItem> = {}): TaskItem =>
  ({ id: 't1', listId: 'l1', text: 'Rappeler le plombier', who: ['m1'], due: '2026-09-05', time: '18:00', done: false, remind: 'at', ...over });

test('l’heure du rappel selon le réglage : à l’heure, une heure avant, la veille à 18 h, le matin à 9 h', () => {
  assert.equal(fireAt(task()), '2026-09-05T18:00');
  assert.equal(fireAt(task({ remind: '1h' })), '2026-09-05T17:00');
  assert.equal(fireAt(task({ remind: 'eve' })), '2026-09-04T18:00');
  assert.equal(fireAt(task({ remind: 'morning' })), '2026-09-05T09:00');
});

test('sans heure, la référence est 9 h ; une heure avant, c’est 8 h', () => {
  assert.equal(fireAt(task({ time: null })), '2026-09-05T09:00');
  assert.equal(fireAt(task({ time: null, remind: '1h' })), '2026-09-05T08:00');
});

test('une heure avant 00:30, c’est la veille à 23:30 : l’arithmétique traverse le jour', () => {
  assert.equal(fireAt(task({ time: '00:30', remind: '1h' })), '2026-09-04T23:30');
  assert.equal(wallAdd('2026-03-01T00:10', -20), '2026-02-28T23:50');
  assert.equal(wallAdd('2026-12-31T23:50', 20), '2027-01-01T00:10');
});

test('sans échéance ou sans réglage, pas de rappel', () => {
  assert.equal(fireAt(task({ due: null })), null);
  assert.equal(fireAt(task({ remind: null })), null);
  assert.equal(fireAt({ due: '2026-09-05', remind: 'bizarre' as never }), null);
});

test('l’heure murale est celle du foyer, pas celle du serveur', () => {
  // 2026-07-14 20:30 UTC est 22:30 à Paris (heure d'été) ; le 14 janvier, 21:30.
  assert.equal(parisWall(new Date('2026-07-14T20:30:00Z')), '2026-07-14T22:30');
  assert.equal(parisWall(new Date('2026-01-14T20:30:00Z')), '2026-01-14T21:30');
  assert.equal(parisWall(new Date('2026-01-14T23:30:00Z')), '2026-01-15T00:30', 'minuit passé à Paris, pas encore en UTC');
});

test('un rappel dû dans la minute part ; un rappel de plus de deux heures est manqué, pas envoyé en retard', () => {
  const tasks = [
    task({ id: 'a', time: '18:00' }),                // 18:00 : maintenant
    task({ id: 'b', time: '17:30' }),                // il y a 30 min : encore dans la fenêtre
    task({ id: 'c', time: '15:00' }),                // il y a 3 h : manqué
    task({ id: 'd', time: '18:01' }),                // dans une minute : pas encore
    task({ id: 'e', time: '17:00', done: true }),    // faite : jamais
  ];
  const { hits, missed } = dueReminders(tasks, ['me', 'm1'], '2026-09-05T18:00');
  assert.deepEqual(hits.map((h) => h.taskId), ['a', 'b']);
  assert.deepEqual(missed.map((h) => h.taskId), ['c']);
});

test('les membres affectés reçoivent ; une tâche sans responsable rappelle tout le foyer', () => {
  const { hits } = dueReminders([task({ id: 'a', who: ['m1'] }), task({ id: 'b', who: [] })], ['me', 'm1'], '2026-09-05T18:00');
  assert.deepEqual(hits.find((h) => h.taskId === 'a')!.memberIds, ['m1']);
  assert.deepEqual(hits.find((h) => h.taskId === 'b')!.memberIds, ['me', 'm1']);
});

test('la clé porte l’échéance et le réglage : une tâche reportée rappelle à nouveau, un redémarrage non', () => {
  const k1 = dueReminders([task()], [], '2026-09-05T18:00').hits[0].key;
  const k2 = dueReminders([task({ due: '2026-09-06' })], [], '2026-09-06T18:00').hits[0].key;
  const k3 = dueReminders([task()], [], '2026-09-05T18:30').hits[0].key;
  assert.notEqual(k1, k2);
  assert.equal(k1, k3, 'la même occurrence, une minute plus tard, a la même clé');
});

test('le corps dit quand : aujourd’hui, demain, ou la date, avec l’heure et la catégorie', () => {
  assert.equal(whenLabel({ due: '2026-09-05', time: '18:00' }, '2026-09-05T17:00'), 'Aujourd’hui à 18:00');
  assert.equal(whenLabel({ due: '2026-09-06', time: null }, '2026-09-05T18:00'), 'Demain');
  assert.equal(whenLabel({ due: '2026-09-12', time: '09:00' }, '2026-09-05T18:00'), 'Le 12/09 à 09:00');
  const { hits } = dueReminders([task({ cat: 'Maison', remind: 'eve' })], [], '2026-09-04T18:00');
  assert.equal(hits[0].body, 'Demain à 18:00 · Maison');
});

test('affectation : les membres nouvellement affectés, sauf l’auteur du geste', () => {
  assert.deepEqual(assignedBy(task({ who: ['me'] }), task({ who: ['me', 'm1'] }), 'me'), ['m1']);
  assert.deepEqual(assignedBy(undefined, task({ who: ['me', 'm1'] }), 'me'), ['m1'], 'à la création aussi');
  assert.deepEqual(assignedBy(task({ who: ['m1'] }), task({ who: ['m1'] }), 'me'), [], 'rien de nouveau');
  assert.deepEqual(assignedBy(undefined, task({ who: ['me'] }), 'me'), [], 'je ne me notifie pas moi-même');
  assert.deepEqual(assignedBy(undefined, task({ who: ['m1'], done: true }), 'me'), [], 'une tâche faite n’affecte personne');
});
