import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shiftWeek } from './epopee';
import { LOIS, Pending, Quest, Routine, SEAL_LATCH_MS, SERMENT, bothSealed, breath, currentQuest, dailyEcus, daysToReach, longDay, missing, reachLine, doneCount, draftsError, earned, hourLabel, mmss, moved, newDraft, nextStep, pendingEcus, remaining, toDraft, withPending } from './epopee';

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

test('une étape se déplace d’un cran, et reste en place aux extrémités', () => {
  assert.deepEqual(moved(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moved(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
  const l = ['a', 'b']; assert.equal(moved(l, 0, -1), l); assert.equal(moved(l, 1, 1), l);
});

test('le brouillon d’une étape compte en minutes, jamais moins d’une', () => {
  assert.equal(toDraft(step('a')).minutes, 2);
  assert.equal(toDraft({ ...step('a'), seconds: 20 }).minutes, 1);
});

test('l’éditeur dit ce qui manque avant d’envoyer', () => {
  const ok = { ...newDraft(), title: 'Dents' };
  assert.equal(draftsError('Matin', '07:20', [ok]), '');
  assert.match(draftsError(' ', '07:20', [ok]), /nom à la routine/);
  assert.match(draftsError('Matin', '7h', [ok]), /heure/);
  assert.match(draftsError('Matin', '07:20', []), /au moins une étape/);
  assert.match(draftsError('Matin', '07:20', [ok, newDraft()]), /étape 2/);
  assert.match(draftsError('Matin', '07:20', [{ ...ok, minutes: 0 }]), /1 à 60 minutes/);
});

test('les écus possibles d’une journée s’additionnent sur toutes les routines', () => {
  assert.equal(dailyEcus([routine(step('a', null, 1), step('b', null, 2)), routine(step('c', null, 0), step('d', null, 3))]), 6);
});

test('la distance d’un trésor se compte en écus manquants, puis en jours de routines', () => {
  assert.equal(missing(20, 7), 13); assert.equal(missing(20, 25), 0);
  assert.equal(daysToReach(20, 7, 5), 3); assert.equal(daysToReach(20, 20, 5), 0); assert.equal(daysToReach(20, 7, 0), null);
  assert.equal(reachLine(20, 7, 5, true), 'Encore 13 écus, environ 3 jours de routines');
  assert.equal(reachLine(20, 19, 0, true), 'Encore 1 écu');
  assert.equal(reachLine(20, 20, 5, true), 'Tu as assez d’écus !'); assert.equal(reachLine(20, 30, 5, false), 'Les écus sont là.');
});

test('une date de pacte se lit en toutes lettres', () => {
  assert.equal(longDay('2026-12-05'), 'samedi 5 décembre');
});

test('la quête en cours est la proposée ou l’active, jamais un trésor déjà atteint', () => {
  const q = (status: Quest['status']): Quest => ({ id: status, rewardId: 'r', title: 't', cost: 10, status, proposedBy: null, createdAt: '', pact: null, reachedAt: null, honoredAt: null, memory: null, photo: null });
  assert.equal(currentQuest([q('atteinte'), q('active')])?.id, 'active');
  assert.equal(currentQuest([q('atteinte'), q('honoree')]), null);
});

test('le serment se scelle quand les deux sceaux sont posés en même temps', () => {
  const off = { down: false, tappedAt: 0 }, held = { down: true, tappedAt: 0 };
  assert.ok(bothSealed(held, held, 1000), 'deux pouces ensemble');
  assert.ok(!bothSealed(held, off, 1000), 'un seul sceau ne suffit pas');
  assert.ok(bothSealed({ down: false, tappedAt: 1000 }, held, 1000 + SEAL_LATCH_MS - 1), 'l’un après l’autre, à temps');
  assert.ok(!bothSealed({ down: false, tappedAt: 1000 }, held, 1000 + SEAL_LATCH_MS), 'trop tard : le premier sceau s’est relevé');
});

test('le serment est réciproque : trois lois, autant de promesses de chaque côté', () => {
  assert.equal(LOIS.length, 3); assert.equal(SERMENT.child.length, SERMENT.parent.length);
});

test('une semaine se décale d’un lundi au lundi voisin, même à cheval sur un mois ou un changement d’heure', () => {
  assert.equal(shiftWeek('2026-10-26', -1), '2026-10-19'); assert.equal(shiftWeek('2026-10-19', 1), '2026-10-26');
  assert.equal(shiftWeek('2026-12-28', 1), '2027-01-04'); assert.equal(shiftWeek('2026-03-30', -1), '2026-03-23');
});
