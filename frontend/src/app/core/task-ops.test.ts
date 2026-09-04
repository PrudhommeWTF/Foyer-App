// Les gestes sur les tâches, tels que l'écran les applique avant que le serveur
// ne réponde, et ce que « Annuler » envoie. Ce qui est vérifié : une intention
// n'est jamais une bascule, et une annulation ne vise que ce qu'elle défait.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { addDaysIso } from './helpers';
import { TaskItem } from './models';
import { TaskOp, TaskOpDraft, applyTaskOp, inverseOf } from './task-ops';

const TODAY = '2026-09-02';
const task = (over: Partial<TaskItem> = {}): TaskItem =>
  ({ id: 't1', listId: 'l1', text: 'Notaire', who: ['me'], due: TODAY, done: false, ...over });
const op = (o: TaskOpDraft): TaskOp => ({ opId: 'op', by: 'me', at: '2026-09-02T10:00:00Z', ...o }) as TaskOp;

test('« faite » deux fois laisse la tâche faite : pas de bascule', () => {
  const une = applyTaskOp([task()], op({ op: 'done', id: 't1' }));
  const deux = applyTaskOp(une, { ...op({ op: 'done', id: 't1' }), by: 'lea', at: '2026-09-02T10:00:05Z' });
  assert.equal(deux[0].done, true);
  assert.equal(deux[0].doneBy, 'me', 'la première coche reste l’information vraie');
});

test('reporter à demain déplace l’échéance et rien d’autre', () => {
  const demain = addDaysIso(TODAY, 1);
  const out = applyTaskOp([task({ note: 'Apporter la pièce d’identité', time: '18:00' })], op({ op: 'edit', id: 't1', due: demain }));
  assert.equal(out[0].due, demain);
  assert.equal(out[0].note, 'Apporter la pièce d’identité', 'l’application ne réécrit pas les mots de l’utilisateur');
  assert.equal(out[0].time, '18:00');
});

test('annuler un report ramène exactement l’état d’avant, y compris « pas de date »', () => {
  const avant = task({ due: null });
  const report: TaskOpDraft = { op: 'edit', id: 't1', due: addDaysIso(TODAY, 1) };
  const retour = inverseOf(report, avant);
  assert.deepEqual(retour, { op: 'edit', id: 't1', due: null });
  const apres = applyTaskOp(applyTaskOp([avant], op(report)), op(retour!));
  assert.equal(apres[0].due, null, 'une tâche sans date le redevient, elle ne garde pas la date du report');
});

test('annuler une coche est une réouverture, annuler une réouverture est une coche', () => {
  assert.deepEqual(inverseOf({ op: 'done', id: 't1' }, task()), { op: 'reopen', id: 't1' });
  assert.deepEqual(inverseOf({ op: 'reopen', id: 't1' }, task({ done: true })), { op: 'done', id: 't1' });
  assert.equal(inverseOf({ op: 'done', id: 't1' }, task({ done: true })), null, 'cocher une tâche déjà faite n’a rien à défaire');
});

test('annuler une suppression remet la tâche telle qu’elle était, coche et auteur compris', () => {
  const avant = task({ done: true, doneAt: '2026-09-01T09:00:00Z', doneBy: 'lea', cat: 'Maison', shopListId: 'cl1' });
  const retour = inverseOf({ op: 'remove', id: 't1' }, avant)!;
  const apres = applyTaskOp([], op(retour));
  assert.equal(apres.length, 1);
  assert.equal(apres[0].done, true);
  assert.equal(apres[0].doneBy, 'lea');
  assert.equal(apres[0].doneAt, '2026-09-01T09:00:00Z');
  assert.equal(apres[0].cat, 'Maison');
  assert.equal(apres[0].shopListId, 'cl1');
});

test('annuler un ajout est une suppression', () => {
  assert.deepEqual(inverseOf({ op: 'add', id: 't9', listId: 'l1', text: 'x' }, undefined), { op: 'remove', id: 't9' });
});

test('annuler une modification ne touche qu’aux champs modifiés', () => {
  const avant = task({ cat: 'Maison' });
  const retour = inverseOf({ op: 'edit', id: 't1', text: 'Notaire (urgent)', cat: 'Administratif', note: 'x' }, avant);
  assert.deepEqual(retour, { op: 'edit', id: 't1', text: 'Notaire', cat: 'Maison', note: '' });
});

test('un ajout rejoué sur une tâche déjà là ne fait pas de doublon', () => {
  const out = applyTaskOp([task()], op({ op: 'add', id: 't1', listId: 'l1', text: 'Notaire' }));
  assert.equal(out.length, 1);
});

test('vider une note ou une heure retire la clé', () => {
  const out = applyTaskOp([task({ note: 'x', time: '18:00' })], op({ op: 'edit', id: 't1', note: '', time: null }));
  assert.equal('note' in out[0], false);
  assert.equal('time' in out[0], false);
});

test('l’application locale ne modifie jamais le tableau reçu', () => {
  const src = [task()];
  applyTaskOp(src, op({ op: 'done', id: 't1' }));
  assert.equal(src[0].done, false);
});

// ---- les séries ---------------------------------------------------------------------------

const serie = (over: Partial<TaskItem> = {}): TaskItem =>
  task({ id: 'p1', text: 'Piscine', due: '2026-09-05', rec: { freq: 'weekly', every: 1, base: 'done' }, ...over });

test('cocher une série solde l’occurrence, garde une trace et avance', () => {
  const out = applyTaskOp([serie()], op({ op: 'done', id: 'p1', occ: '2026-09-05', next: '2026-09-14' }));
  assert.equal(out[0].done, false);
  assert.equal(out[0].due, '2026-09-14');
  assert.deepEqual(out[0].history, [{ at: '2026-09-02T10:00:00Z', by: 'me', due: '2026-09-05' }]);
});

test('une coche pour une occurrence qui n’est plus la courante est sans effet', () => {
  const out = applyTaskOp([serie({ due: '2026-09-14' })], op({ op: 'done', id: 'p1', occ: '2026-09-05', next: '2026-09-14' }));
  assert.equal(out[0].due, '2026-09-14');
  assert.equal(out[0].history, undefined);
});

test('annuler la coche d’une série rétablit l’occurrence soldée, et elle seule', () => {
  const avant = serie();
  const coche: TaskOpDraft = { op: 'done', id: 'p1', occ: '2026-09-05', next: '2026-09-14' };
  const retour = inverseOf(coche, avant);
  assert.deepEqual(retour, { op: 'reopen', id: 'p1', occ: '2026-09-05' });
  const apres = applyTaskOp(applyTaskOp([avant], op(coche)), op(retour!));
  assert.equal(apres[0].due, '2026-09-05');
  assert.deepEqual(apres[0].history, []);
});

test('la coche qui arrête une série la marque faite ; annuler la relance', () => {
  const coche: TaskOpDraft = { op: 'done', id: 'p1', occ: '2026-09-05', next: null };
  const fini = applyTaskOp([serie()], op(coche));
  assert.equal(fini[0].done, true);
  const retour = applyTaskOp(fini, op(inverseOf(coche, serie())!));
  assert.equal(retour[0].done, false);
  assert.equal(retour[0].due, '2026-09-05');
});

test('passer une occurrence avance sans trace ; l’annuler remet l’échéance', () => {
  const saut: TaskOpDraft = { op: 'skip', id: 'p1', occ: '2026-09-05', next: '2026-09-12' };
  const apres = applyTaskOp([serie()], op(saut));
  assert.equal(apres[0].due, '2026-09-12');
  assert.equal(apres[0].history, undefined);
  assert.deepEqual(inverseOf(saut, serie()), { op: 'edit', id: 'p1', due: '2026-09-05' });
});

test('annuler la suppression d’une série remet sa règle et son historique', () => {
  const avant = serie({ history: [{ at: 'x', by: 'me', due: '2026-08-29' }] });
  const retour = inverseOf({ op: 'remove', id: 'p1' }, avant)!;
  const apres = applyTaskOp([], op(retour));
  assert.deepEqual(apres[0].rec, avant.rec);
  assert.deepEqual(apres[0].history, avant.history);
});

test('retirer la règle d’une série la rend ponctuelle, et l’annulation la remet', () => {
  const avant = serie();
  const off: TaskOpDraft = { op: 'edit', id: 'p1', rec: null };
  const apres = applyTaskOp([avant], op(off));
  assert.equal('rec' in apres[0], false);
  assert.deepEqual(inverseOf(off, avant), { op: 'edit', id: 'p1', rec: avant.rec });
});
