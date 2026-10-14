// Le formulaire d'une liste : ouvrir puis enregistrer sans rien toucher ne change rien.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskList } from './models';
import { taskListChanges, taskListData, taskListFields } from './task-list-form';

const valise: TaskList = { id: 'l1', name: 'Valise de Léo', color: '#4E93B8', icon: 'valise', kind: 'preparation', scope: 'shared', position: 2, forMember: 'm2', departure: '2026-11-02', remindDaysBefore: 3, placeId: 'lchalet' };
const maison: TaskList = { id: 'l2', name: 'Maison', color: '#E56B4E', icon: 'maison', kind: 'taches', scope: 'shared', position: 0 };
const data = (l: TaskList, p = {}) => taskListData({ ...taskListFields(l), ...p }) as Exclude<ReturnType<typeof taskListData>, string>;

test('ouverte puis enregistrée telle quelle : rien ne change', () => {
  assert.equal(taskListChanges(valise, data(valise)), false);
  assert.equal(taskListChanges(maison, data(maison)), false);
});

test('une préparation reste partagée, ses champs s’effacent si elle change de type', () => {
  assert.equal(data(valise, { scope: 'm1' }).scope, 'shared');
  const d = data(valise, { kind: 'checklist' });
  assert.equal(d.departure, null); assert.equal(d.placeId, null);
  assert.equal(taskListChanges(valise, d), true);
});

test('le mode manuel ne vaut que pour les tâches et les corvées ; un nom vide est refusé', () => {
  assert.equal(data(maison, { order: 'manuel' }).order, 'manuel');
  assert.equal(data(maison, { kind: 'checklist', order: 'manuel' }).order, undefined);
  assert.equal(taskListData({ ...taskListFields(null), name: ' ' }), 'Donne un nom à la liste');
});
