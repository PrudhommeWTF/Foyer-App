// Ce que le module Tâches met en avant pour aujourd'hui.
//
// L'enjeu n'est pas le tri : c'est de ne pas transformer l'accueil en compteur
// d'arriéré, et de ne jamais faire disparaître une tâche en retard, seulement la
// laisser descendre.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskItem } from './models';
import { RELEGATION_DAYS, todayTasks } from './tasks';

const TODAY = '2026-09-02';

const tache = (id: string, over: Partial<TaskItem> = {}): TaskItem =>
  ({ id, text: id, who: 'me', due: '', done: false, listId: 'l1', prio: 'med', ...over });

const ids = (tasks: TaskItem[], max = 5): string[] => todayTasks(tasks, TODAY, max).lines.map((l) => l.task.id);

test('le compteur ne compte que le jour même et le retard', () => {
  const t = todayTasks([
    tache('aujourdhui', { planned: TODAY }),
    tache('retard', { planned: '2026-08-30' }),
    tache('plus-tard', { planned: '2026-09-20' }),
    tache('sans-date'),
    tache('faite', { planned: TODAY, done: true }),
  ], TODAY, 5);
  assert.equal(t.due, 2, 'une tâche sans date n’est due aucun jour en particulier');
});

test('le retard récent passe devant, puis le jour même, puis ce qui n’a pas de date', () => {
  assert.deepEqual(ids([
    tache('sans-date'),
    tache('aujourdhui', { planned: TODAY }),
    tache('retard', { planned: '2026-08-30' }),
  ]), ['retard', 'aujourdhui', 'sans-date']);
});

test('un retard ancien passe DERRIÈRE le jour même : c’est la relégation', () => {
  // Une tâche en retard de trois mois n'a rien à faire en tête de l’accueil.
  assert.deepEqual(ids([
    tache('trois-mois', { planned: '2026-06-01' }),
    tache('aujourdhui', { planned: TODAY }),
    tache('hier', { planned: '2026-09-01' }),
  ]), ['hier', 'aujourdhui', 'trois-mois']);
});

test('les retards se classent du plus récent au plus ancien, dans chaque groupe', () => {
  assert.deepEqual(ids([
    tache('six-mois', { planned: '2026-03-01' }),
    tache('deux-mois', { planned: '2026-07-01' }),
    tache('hier', { planned: '2026-09-01' }),
    tache('la-semaine-derniere', { planned: '2026-08-26' }),
  ]), ['hier', 'la-semaine-derniere', 'deux-mois', 'six-mois']);
});

test('le seuil de relégation est bien celui qui est déclaré', () => {
  const juste = new Date(Date.parse(TODAY + 'T00:00:00') - RELEGATION_DAYS * 86400000).toISOString().slice(0, 10);
  const au_dela = new Date(Date.parse(TODAY + 'T00:00:00') - (RELEGATION_DAYS + 1) * 86400000).toISOString().slice(0, 10);
  assert.deepEqual(ids([
    tache('au-dela', { planned: au_dela }),
    tache('aujourdhui', { planned: TODAY }),
    tache('au-seuil', { planned: juste }),
  ]), ['au-seuil', 'aujourdhui', 'au-dela']);
});

test('une tâche reléguée hors de la tuile n’est pas perdue, elle est dans son module', () => {
  const tasks = [
    tache('vieille', { planned: '2026-05-01' }),
    ...Array.from({ length: 5 }, (_, i) => tache('recente' + i, { planned: '2026-09-01' })),
  ];
  const t = todayTasks(tasks, TODAY, 5);
  assert.equal(t.lines.length, 5, 'la tuile est pleine');
  assert.ok(!t.lines.some((l) => l.task.id === 'vieille'), 'la plus ancienne sort de la tuile');
  assert.equal(t.due, 6, 'mais elle reste comptée : rien n’est effacé');
});

test('les jours de retard sont comptés en jours pleins', () => {
  const t = todayTasks([tache('a', { planned: '2026-08-30' })], TODAY, 5);
  assert.equal(t.lines[0].late, 3);
});

test('une tâche du jour ou sans date n’a pas de retard', () => {
  const t = todayTasks([tache('a', { planned: TODAY }), tache('b')], TODAY, 5);
  assert.deepEqual(t.lines.map((l) => l.late), [0, 0]);
});

test('une tâche planifiée plus tard ne s’affiche pas', () => {
  assert.deepEqual(ids([tache('plus-tard', { planned: '2026-09-20' })]), []);
});

test('« rien pour aujourd’hui » se distingue de « plus rien du tout »', () => {
  assert.equal(todayTasks([tache('plus-tard', { planned: '2026-09-20' })], TODAY, 5).onlyLater, true);
  assert.equal(todayTasks([tache('faite', { done: true })], TODAY, 5).onlyLater, false);
  assert.equal(todayTasks([], TODAY, 5).onlyLater, false);
});

test('une tâche faite ne compte ni ne s’affiche, même en retard', () => {
  const t = todayTasks([tache('a', { planned: '2026-08-01', done: true })], TODAY, 5);
  assert.equal(t.due, 0);
  assert.equal(t.lines.length, 0);
});
