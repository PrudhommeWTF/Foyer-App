// Le formulaire d'un créneau : ouvrir, Modifier, Enregistrer sans rien toucher ne change rien.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SchedSlot } from './models';
import { periodShown, slotChanges, slotFields, slotOf } from './slot-form';

const piano: SchedSlot = { id: 's1', who: ['m2'], dow: 3, start: '17:00', end: '18:00', label: 'Piano', k: 'loisir', away: true, rec: 'weekly', from: '2026-09-01', skip: ['2026-10-21'] };
const def = { date: '2026-10-14', who: [], start: '08:30' };

test('ouvert puis enregistré tel quel : rien ne change, exceptions comprises', () => {
  const forme = slotOf(slotFields(piano, '2026-10-14', def), '2026-10-14');
  assert.notEqual(typeof forme, 'string');
  assert.equal(slotChanges(piano, forme as Exclude<typeof forme, string>), false);
  const once: SchedSlot = { id: 's2', who: ['m1', 'm2'], dow: 5, start: '09:00', end: '', label: 'Dentiste', k: 'sante', rec: 'once', date: '2026-10-16' };
  const f2 = slotOf(slotFields(once, '2026-10-16', def), '2026-10-16') as Omit<SchedSlot, 'id'>;
  assert.equal(slotChanges(once, f2), false);
});

test('une vraie modification se voit', () => {
  const f = slotFields(piano, '2026-10-14', def);
  assert.equal(slotChanges(piano, slotOf({ ...f, start: '17:30' }, '2026-10-14') as Omit<SchedSlot, 'id'>), true);
  assert.equal(slotChanges(piano, slotOf({ ...f, every: 2 }, '2026-10-14') as Omit<SchedSlot, 'id'>), true);
});

test('les refus sont dits', () => {
  const f = slotFields(null, '', def);
  assert.equal(slotOf(f, '2026-10-14'), 'Donne un intitulé');
  assert.equal(slotOf({ ...f, label: 'Judo', who: [] }, '2026-10-14'), 'Choisis au moins un membre');
  assert.equal(slotOf({ ...f, label: 'Judo', who: ['m1'], from: '2026-10-14', until: '2026-10-01' }, '2026-10-14'), 'La fin de période est avant son début');
});

test('une semaine sur deux s’ancre sur le lundi de l’occurrence ouverte', () => {
  const f = { ...slotFields(null, '', def), label: 'Judo', who: ['m1'], every: 2, from: '' };
  const s = slotOf(f, '2026-10-15') as Omit<SchedSlot, 'id'>;
  assert.equal(s.interval, 2); assert.equal(s.from, '2026-10-12');
});

test('création : jour, membres et heure proposés ; période repliée', () => {
  const f = slotFields(null, '', { date: '2026-10-15', who: ['m2'], start: '16:30' });
  assert.equal(f.dow, 4); assert.deepEqual(f.who, ['m2']); assert.equal(f.start, '16:30'); assert.equal(f.from, '2026-10-15');
  assert.equal(periodShown(f, '2026-10-14'), true, 'un démarrage futur se montre');
  assert.equal(periodShown({ ...f, from: '2026-10-01' }, '2026-10-14'), false, 'un début déjà passé ne se montre pas');
});
