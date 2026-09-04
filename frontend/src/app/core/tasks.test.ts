// Les règles du module Tâches : ce qui se voit, dans quel ordre, ce qui se
// propose. L'enjeu n'est pas le tri, c'est de ne pas transformer l'accueil en
// compteur d'arriéré, de ne jamais cacher une tâche en silence, et de rendre la
// saisie plus courte que la tâche elle-même.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskItem, TaskList } from './models';
import { RELEGATION_DAYS, categories, dailyTasks, dueLabel, groupOpen, quickDates, suggestTexts, todayTasks, visibleLists } from './tasks';

const TODAY = '2026-09-02';

const tache = (id: string, over: Partial<TaskItem> = {}): TaskItem =>
  ({ id, text: id, who: [], due: null, done: false, listId: 'l1', ...over });
const liste = (id: string, over: Partial<TaskList> = {}): TaskList =>
  ({ id, name: id, color: '#000', icon: 'checklist', kind: 'taches', scope: 'shared', position: 0, ...over });

const ids = (tasks: TaskItem[], max = 5): string[] => todayTasks(tasks, TODAY, max).lines.map((l) => l.task.id);

// ---- l'accueil -----------------------------------------------------------------

test('le compteur ne compte que le jour même et le retard', () => {
  const t = todayTasks([
    tache('aujourdhui', { due: TODAY }),
    tache('retard', { due: '2026-08-30' }),
    tache('plus-tard', { due: '2026-09-20' }),
    tache('sans-date'),
    tache('faite', { due: TODAY, done: true }),
  ], TODAY, 5);
  assert.equal(t.due, 2, 'une tâche sans date n’est due aucun jour en particulier');
});

test('le retard récent passe devant, puis le jour même, puis ce qui n’a pas de date', () => {
  assert.deepEqual(ids([tache('sans-date'), tache('aujourdhui', { due: TODAY }), tache('retard', { due: '2026-08-30' })]),
    ['retard', 'aujourdhui', 'sans-date']);
});

test('un retard ancien passe DERRIÈRE le jour même : c’est la relégation', () => {
  assert.deepEqual(ids([tache('trois-mois', { due: '2026-06-01' }), tache('aujourdhui', { due: TODAY }), tache('hier', { due: '2026-09-01' })]),
    ['hier', 'aujourdhui', 'trois-mois']);
});

test('le seuil de relégation est bien celui qui est déclaré', () => {
  const juste = new Date(Date.parse(TODAY + 'T00:00:00') - RELEGATION_DAYS * 86400000).toISOString().slice(0, 10);
  const au_dela = new Date(Date.parse(TODAY + 'T00:00:00') - (RELEGATION_DAYS + 1) * 86400000).toISOString().slice(0, 10);
  assert.deepEqual(ids([tache('au-dela', { due: au_dela }), tache('aujourdhui', { due: TODAY }), tache('au-seuil', { due: juste })]),
    ['au-seuil', 'aujourdhui', 'au-dela']);
});

test('une tâche reléguée hors de la tuile n’est pas perdue, elle compte toujours', () => {
  const tasks = [tache('vieille', { due: '2026-05-01' }), ...Array.from({ length: 5 }, (_, i) => tache('recente' + i, { due: '2026-09-01' }))];
  const t = todayTasks(tasks, TODAY, 5);
  assert.equal(t.lines.length, 5);
  assert.ok(!t.lines.some((l) => l.task.id === 'vieille'));
  assert.equal(t.due, 6, 'rien n’est effacé');
});

test('« rien pour aujourd’hui » se distingue de « plus rien du tout »', () => {
  assert.equal(todayTasks([tache('plus-tard', { due: '2026-09-20' })], TODAY, 5).onlyLater, true);
  assert.equal(todayTasks([tache('faite', { done: true })], TODAY, 5).onlyLater, false);
  assert.equal(todayTasks([], TODAY, 5).onlyLater, false);
});

// ---- ce qui se voit ---------------------------------------------------------------

test('une liste privée à quelqu’un d’autre ne se voit pas ; une liste archivée non plus, sauf demande', () => {
  const lists = [liste('a'), liste('b', { scope: 'lea' }), liste('c', { scope: 'me' }), liste('d', { archived: true })];
  assert.deepEqual(visibleLists(lists, 'me').map((l) => l.id), ['a', 'c']);
  assert.deepEqual(visibleLists(lists, 'me', true).map((l) => l.id), ['a', 'c', 'd']);
  assert.deepEqual(visibleLists(lists, null).map((l) => l.id), ['a'], 'sans membre connu, seul le partagé se voit');
});

test('les listes se rangent par position', () => {
  assert.deepEqual(visibleLists([liste('b', { position: 2 }), liste('a', { position: 1 })], 'me').map((l) => l.id), ['a', 'b']);
});

test('seules les listes « tâches » sont l’affaire du jour ; une liste disparue montre quand même ses tâches', () => {
  const lists = [liste('jour'), liste('valise', { kind: 'checklist' }), liste('corvees', { kind: 'corvees' }), liste('privee', { scope: 'lea' }), liste('archivee', { archived: true })];
  const tasks = ['jour', 'valise', 'corvees', 'privee', 'archivee', 'disparue'].map((l) => tache(l, { listId: l }));
  assert.deepEqual(dailyTasks(tasks, lists, 'me').map((t) => t.id), ['jour', 'disparue']);
});

// ---- l'ordre de l'écran -------------------------------------------------------------

test('l’écran groupe : aujourd’hui, en retard (récent d’abord), à venir, sans date (récent d’abord)', () => {
  const g = groupOpen([
    tache('sans-vieille', { at: '2026-08-01T10:00:00Z' }),
    tache('sans-neuve', { at: '2026-09-01T10:00:00Z' }),
    tache('demain', { due: '2026-09-03' }),
    tache('retard-ancien', { due: '2026-08-01' }),
    tache('retard-hier', { due: '2026-09-01' }),
    tache('ce-soir', { due: TODAY, time: '19:00' }),
    tache('ce-matin', { due: TODAY, time: '08:00' }),
    tache('faite', { due: TODAY, done: true }),
  ], TODAY);
  assert.deepEqual(g.map((x) => [x.key, x.lines.map((l) => l.task.id)]), [
    ['today', ['ce-matin', 'ce-soir']],
    ['late', ['retard-hier', 'retard-ancien']],
    ['soon', ['demain']],
    ['undated', ['sans-neuve', 'sans-vieille']],
  ]);
  assert.equal(g[1].lines[1].late, 32);
});

test('un groupe vide n’apparaît pas', () => {
  assert.deepEqual(groupOpen([tache('a')], TODAY).map((g) => g.key), ['undated']);
});

test('une checklist se lit dans l’ordre où elle a été écrite, sans titre de groupe', () => {
  const g = groupOpen([tache('b', { at: '2', due: TODAY }), tache('a', { at: '1' })], TODAY, 'checklist');
  assert.equal(g.length, 1);
  assert.equal(g[0].label, '');
  assert.deepEqual(g[0].lines.map((l) => l.task.id), ['a', 'b']);
});

// ---- la saisie -----------------------------------------------------------------------

test('les suggestions viennent de l’historique de la liste, du plus fréquent au plus rare, dès deux lettres', () => {
  const tasks = [
    tache('1', { text: 'Sortir les poubelles', done: true }),
    tache('2', { text: 'Sortir les poubelles', done: true }),
    tache('3', { text: 'Sortir le verre', done: true }),
    tache('4', { text: 'Sortir le chien', done: true, listId: 'autre' }),
  ];
  assert.deepEqual(suggestTexts(tasks, 'l1', 'sor'), ['Sortir les poubelles', 'Sortir le verre']);
  assert.deepEqual(suggestTexts(tasks, 'l1', 's'), [], 'une lettre ne dit rien');
});

test('une tâche encore ouverte n’est pas proposée : le geste ferait un doublon', () => {
  const tasks = [tache('1', { text: 'Sortir les poubelles' }), tache('2', { text: 'Sortir le verre', done: true })];
  assert.deepEqual(suggestTexts(tasks, 'l1', 'sortir'), ['Sortir le verre']);
});

test('la suggestion identique à ce qui est tapé n’apprend rien, et les accents ne comptent pas', () => {
  const tasks = [tache('1', { text: 'Régler l’électricité', done: true })];
  assert.deepEqual(suggestTexts(tasks, 'l1', 'regler'), ['Régler l’électricité']);
  assert.deepEqual(suggestTexts(tasks, 'l1', 'régler l’électricité'), []);
});

test('les catégories proposées : celles de départ, puis celles que le foyer a écrites, sans doublon', () => {
  const c = categories([tache('1', { cat: 'Piscine' }), tache('2', { cat: 'maison' }), tache('3', { cat: 'Piscine' })]);
  assert.deepEqual(c, ['Maison', 'Enfants', 'Administratif', 'Courses', 'Travail', 'Piscine']);
});

test('les dates d’un tap : demain, le week-end qui vient, la semaine prochaine', () => {
  // Le 2 septembre 2026 est un mercredi.
  assert.deepEqual(quickDates(TODAY).map((q) => q.date), [TODAY, '2026-09-03', '2026-09-05', '2026-09-07']);
  // Un samedi : « ce week-end », c'est aujourd'hui, et la semaine prochaine commence lundi.
  assert.deepEqual(quickDates('2026-09-05').map((q) => q.date), ['2026-09-05', '2026-09-06', '2026-09-05', '2026-09-07']);
  assert.deepEqual(quickDates('2026-09-06').map((q) => q.date), ['2026-09-06', '2026-09-07', '2026-09-06', '2026-09-07']);
});

test('l’échéance se lit : aujourd’hui, demain, hier, le jour de la semaine, puis la date', () => {
  const fmt = (iso: string): string => iso.split('-').reverse().join('/');
  assert.equal(dueLabel(TODAY, null, TODAY, fmt), 'Aujourd’hui');
  assert.equal(dueLabel('2026-09-03', '18:00', TODAY, fmt), 'Demain · 18:00');
  assert.equal(dueLabel('2026-09-01', null, TODAY, fmt), 'Hier');
  assert.equal(dueLabel('2026-09-05', null, TODAY, fmt), 'samedi');
  assert.equal(dueLabel('2026-09-09', null, TODAY, fmt), '09/09/2026', 'à sept jours, le nom du jour serait ambigu');
  assert.equal(dueLabel('2026-08-20', null, TODAY, fmt), '20/08/2026');
  assert.equal(dueLabel(null, '18:00', TODAY, fmt), '', 'une heure sans date ne se dit pas');
});

// ---- la tolérance des séries saisonnières ---------------------------------------------

test('avec une tolérance, une occurrence est l’affaire du jour jusqu’à la fin de la fenêtre, puis en retard', () => {
  const rec = { freq: 'yearly' as const, every: 1, base: 'due' as const, grace: 15 };
  const piscine = tache('piscine', { due: '2026-08-25', rec });
  assert.equal(todayTasks([piscine], TODAY, 5).due, 1, 'à huit jours de l’échéance, dans la fenêtre : due aujourd’hui');
  assert.deepEqual(groupOpen([piscine], TODAY).map((g) => g.key), ['today']);
  const tard = tache('piscine', { due: '2026-08-10', rec });
  const g = groupOpen([tard], TODAY);
  assert.deepEqual(g.map((x) => x.key), ['late']);
  assert.equal(g[0].lines[0].late, 8, 'le retard se compte depuis la fin de la tolérance');
});

test('sans tolérance, rien ne change', () => {
  assert.deepEqual(groupOpen([tache('a', { due: '2026-09-01', rec: { freq: 'weekly', every: 1, base: 'done' } })], TODAY).map((g) => g.key), ['late']);
});

test('une échéance avec tolérance se dit « vers le »', () => {
  const fmt = (iso: string): string => iso.split('-').reverse().join('/');
  assert.equal(dueLabel('2026-09-02', null, TODAY, fmt, 15), 'vers le 02/09/2026');
  assert.equal(dueLabel('2026-09-02', '10:00', TODAY, fmt, 15), 'vers le 02/09/2026 · 10:00');
});
