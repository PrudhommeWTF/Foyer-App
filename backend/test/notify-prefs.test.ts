// Les rappels ne partent plus sans qu'on l'ait voulu.
//
// Trois règles, et chacune répond à un cas réel :
//
//   - « On part en vacances, je coupe les rappels » : un geste, pour tout le
//     foyer, sans avoir à toucher aux réglages de chacun.
//   - « Le téléphone ne sonne pas la nuit » : les heures de silence reportent,
//     elles ne suppriment pas. Un rappel perdu ferait rater une échéance.
//   - « Moi je veux les affectations, pas les rappels » : chacun coupe les
//     siens sans rien imposer aux autres.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deferPastQuiet, dueReminders, fireAt, inQuiet } from '../src/notify/reminders';
import type { TaskItem } from '../src/tasks/ops';

const nuit = { from: '21:30', to: '07:00' };
const sieste = { from: '13:00', to: '15:00' };

const tache = (o: Partial<TaskItem>): TaskItem => ({
  id: 't1', listId: 'l1', text: 'Sortir les poubelles', who: [], due: '2026-09-04', done: false, ...o,
} as TaskItem);

describe('heures de silence : la fenêtre', () => {
  it('reconnaît une fenêtre à cheval sur minuit', () => {
    assert.equal(inQuiet('2026-09-04T22:00', nuit), true);
    assert.equal(inQuiet('2026-09-04T03:00', nuit), true);
    assert.equal(inQuiet('2026-09-04T21:30', nuit), true, 'la borne de début est dans le silence');
    assert.equal(inQuiet('2026-09-04T07:00', nuit), false, 'la borne de fin est déjà la reprise');
    assert.equal(inQuiet('2026-09-04T12:00', nuit), false);
  });

  it('reconnaît une fenêtre dans la journée', () => {
    assert.equal(inQuiet('2026-09-04T14:00', sieste), true);
    assert.equal(inQuiet('2026-09-04T22:00', sieste), false);
  });

  it('deux bornes identiques ou vides ne font pas de silence', () => {
    assert.equal(inQuiet('2026-09-04T22:00', { from: '08:00', to: '08:00' }), false);
    assert.equal(inQuiet('2026-09-04T22:00', { from: '', to: '' }), false);
  });
});

describe('heures de silence : le report', () => {
  it('un rappel du soir attend le matin, le lendemain', () => {
    assert.equal(deferPastQuiet('2026-09-04T22:15', nuit), '2026-09-05T07:00');
  });

  it('un rappel de la nuit attend le matin, le jour même', () => {
    assert.equal(deferPastQuiet('2026-09-05T03:00', nuit), '2026-09-05T07:00');
  });

  it('un rappel hors silence n’est pas touché', () => {
    assert.equal(deferPastQuiet('2026-09-04T18:00', nuit), '2026-09-04T18:00');
  });

  it('une fenêtre de journée reporte à sa fin, le jour même', () => {
    assert.equal(deferPastQuiet('2026-09-04T14:00', sieste), '2026-09-04T15:00');
  });

  it('le rappel n’est jamais perdu, seulement décalé', () => {
    const t = tache({ time: '22:00', remind: 'at' });
    assert.equal(fireAt(t), '2026-09-04T22:00', 'sans silence, à l’heure dite');
    assert.equal(fireAt(t, nuit), '2026-09-05T07:00', 'avec silence, à la reprise');
  });
});

describe('les rappels dus, avec et sans silence', () => {
  it('un rappel de nuit ne tombe pas dans la nuit', () => {
    const t = tache({ time: '22:00', remind: 'at', who: ['me'] });
    assert.equal(dueReminders([t], ['me'], '2026-09-04T22:05', nuit).hits.length, 0, 'la nuit, rien ne part');
    assert.equal(dueReminders([t], ['me'], '2026-09-05T07:00', nuit).hits.length, 1, 'au réveil, il est là');
  });

  it('la clé d’idempotence ne dépend pas du report : le rappel ne part pas deux fois', () => {
    const t = tache({ time: '22:00', remind: 'at', who: ['me'] });
    const avec = dueReminders([t], ['me'], '2026-09-05T07:00', nuit).hits[0];
    const sans = dueReminders([t], ['me'], '2026-09-04T22:05').hits[0];
    assert.equal(avec.key, sans.key);
  });

  it('sans silence, rien ne change au comportement d’avant', () => {
    const t = tache({ time: '18:00', remind: 'at', who: ['me'] });
    assert.deepEqual(dueReminders([t], ['me'], '2026-09-04T18:00').hits.map((h) => h.fireAt), ['2026-09-04T18:00']);
  });
});
