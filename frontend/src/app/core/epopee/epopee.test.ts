import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pending, Routine, breath, doneCount, earned, hourLabel, mmss, nextStep, pendingEcus, remaining, withPending } from './epopee';

const step = (id: string, status: 'fait' | 'saute' | null = null, ecus = 1) => ({ id, title: id, hint: '', icon: 'dent', seconds: 120, ecus, status });
const routine = (...steps: ReturnType<typeof step>[]): Routine => ({ id: 'r', kind: 'matin', title: 'Matin', time: '07:20', startedAt: null, endedAt: null, pauses: 0, steps });

test('la prochaine étape est la première non notée, -1 quand tout est noté', () => {
  assert.equal(nextStep(routine(step('a', 'fait'), step('b'), step('c'))), 1);
  assert.equal(nextStep(routine(step('a', 'fait'), step('b', 'saute'))), -1);
});

test('une étape passée compte comme notée, pas comme gagnée', () => {
  const r = routine(step('a', 'fait', 2), step('b', 'saute', 3), step('c'));
  assert.equal(earned(r), 2); assert.equal(doneCount(r), 2);
});

test('ce que l’appareil a noté s’ajoute à ce que le serveur sait, pour le jour affiché seulement', () => {
  const r = [routine(step('a', 'fait'), step('b'), step('c'))];
  const pending: Pending[] = [{ stepId: 'b', status: 'fait', day: '2026-03-01' }, { stepId: 'c', status: 'fait', day: '2026-02-28' }, { stepId: 'a', status: 'saute', day: '2026-03-01' }];
  assert.deepEqual(withPending(r, pending, '2026-03-01')[0].steps.map((s) => s.status), ['fait', 'fait', null], 'le serveur garde le dernier mot sur a');
  assert.equal(withPending(r, [], '2026-03-01'), r);
});

test('les écus en attente ne comptent ni une étape passée, ni une étape déjà connue du serveur', () => {
  const r = [routine(step('a', 'fait', 2), step('b', null, 2), step('c', null, 3))];
  assert.equal(pendingEcus(r, [{ stepId: 'a', status: 'fait', day: 'j' }, { stepId: 'b', status: 'fait', day: 'j' }, { stepId: 'c', status: 'saute', day: 'j' }, { stepId: 'c', status: 'fait', day: 'hier' }], 'j'), 2);
});

test('le sablier se calcule sur l’horloge, sans compter les pauses, et ne passe jamais sous zéro', () => {
  assert.equal(remaining(120, 0, 0, 0), 120);
  assert.equal(remaining(120, 0, 0, 30_500), 90);
  assert.equal(remaining(120, 0, 20_000, 50_000), 90, 'vingt secondes de pause ne sont pas décomptées');
  assert.equal(remaining(120, 0, 0, 10 * 60_000), 0, 'tablette endormie dix minutes : zéro, pas de dette');
});

test('durées et heures se lisent', () => {
  assert.equal(mmss(125), '2:05'); assert.equal(mmss(0), '0:00');
  assert.equal(hourLabel('07:20'), '7 h 20'); assert.equal(hourLabel('19:00'), '19 h');
});

test('la respiration tourne : inspirer 4 s, garder 2 s, souffler 4 s', () => {
  assert.deepEqual(breath(0), { phase: 0, label: 'Inspire', left: 4 });
  assert.deepEqual(breath(4500), { phase: 1, label: 'Garde', left: 2 });
  assert.deepEqual(breath(6000), { phase: 2, label: 'Souffle', left: 4 });
  assert.equal(breath(10_000).phase, 0); assert.equal(breath(-5).phase, 0);
});
