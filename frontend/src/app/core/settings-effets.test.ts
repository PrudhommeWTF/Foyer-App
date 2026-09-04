// Ce que les réglages changent réellement, module par module.
//
// Le garde-fou de la CI vérifie qu'un réglage est **lu** quelque part. Il ne
// peut pas vérifier qu'il change quelque chose : c'est ce que fait ce fichier,
// une assertion par réglage, sur la fonction qui le consomme. Sans lui, un
// réglage pourrait être lu et jeté, ce qui reviendrait au même mensonge.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setting } from './settings/registry';
import { todayTasks } from './tasks';
import { upcomingDeadlines } from './deadlines';
import { awayAt } from './presence';
import type { TaskItem } from './models';
import type { SchedSlot } from './models';
import type { FinDeadline } from './finances.api';

const TODAY = '2026-09-04';

const tache = (id: string, o: Partial<TaskItem> = {}): TaskItem =>
  ({ id, listId: 'l1', text: id, who: [], due: null, done: false, ...o } as TaskItem);

describe('Tâches : le seuil de relégation', () => {
  // Une tâche en retard de 40 jours, et une pour aujourd'hui.
  const tasks = [tache('vieille', { due: '2026-07-26' }), tache('aujourdhui', { due: TODAY })];

  it('au réglage par défaut, une tâche en retard de 40 jours passe derrière celle du jour', () => {
    const ordre = todayTasks(tasks, TODAY, 5).lines.map((l) => l.task.id);
    assert.deepEqual(ordre, ['aujourdhui', 'vieille']);
  });

  it('en relevant le seuil, elle repasse devant : le réglage a bien un effet', () => {
    const ordre = todayTasks(tasks, TODAY, 5, 60).lines.map((l) => l.task.id);
    assert.deepEqual(ordre, ['vieille', 'aujourdhui']);
  });
});

describe('Finances : l’horizon des échéances', () => {
  const echeances = [
    { contractId: 1, daysAway: 30 }, { contractId: 2, daysAway: 90 },
  ] as unknown as FinDeadline[];

  it('à 60 jours, seule la plus proche remonte', () => {
    assert.deepEqual(upcomingDeadlines(echeances, 60).map((d) => d.contractId), [1]);
  });

  it('à 120 jours, les deux remontent', () => {
    assert.deepEqual(upcomingDeadlines(echeances, 120).map((d) => d.contractId), [1, 2]);
  });
});

describe('Repas : les heures de créneau', () => {
  // Un créneau hors du foyer de 12:00 à 13:00, le vendredi.
  const cantine: SchedSlot = {
    id: 's1', who: ['lea'], dow: 5, start: '12:00', end: '13:00', label: 'Cantine', k: 'ecole', away: true, rec: 'weekly',
  } as SchedSlot;

  it('avec le déjeuner à 12:30, la cantine retire Léa de la table', () => {
    assert.deepEqual([...awayAt([cantine], TODAY, 'midi', undefined, { midi: '12:30' })], ['lea']);
  });

  it('en déplaçant le déjeuner à 13:30, elle est de nouveau comptée', () => {
    assert.deepEqual([...awayAt([cantine], TODAY, 'midi', undefined, { midi: '13:30' })], [],
      'le créneau ne couvre plus l’heure du repas : c’est bien l’heure réglée qui décide');
  });
});

describe('les valeurs par défaut du registre sont celles du code d’avant', () => {
  // Une régression silencieuse ici changerait le comportement de tout le monde
  // à la mise à jour, sans que personne n'ait rien demandé.
  const vide = { settings: {} };
  it('reprend les constantes que le code portait en dur', () => {
    assert.equal(setting('taskLateDays', vide), 30);
    assert.equal(setting('deadlineHorizonDays', vide), 60);
    assert.equal(setting('stockDays', vide), 21);
    assert.equal(setting('suggestRepeatDays', vide), 15);
    assert.equal(setting('suggestForgottenDays', vide), 21);
    assert.equal(setting('suggestQuickMin', vide), 25);
    assert.equal(setting('mealTimeMorning', vide), '08:00');
    assert.equal(setting('mealTimeNoon', vide), '12:30');
    assert.equal(setting('mealTimeEvening', vide), '19:30');
    assert.equal(setting('sessionDays', vide), 30);
    assert.equal(setting('passwordMinLength', vide), 6);
    assert.equal(setting('maxUploadMb', vide), 20);
    assert.equal(setting('readingDueDays', vide), 30);
  });
});
