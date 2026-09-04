// La disponibilité lue dans l'emploi du temps : ce qui compte est de ne rien
// dire quand il n'y a rien à dire, et de prévenir quand une heure tombe en
// plein cours.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SchedSlot } from './models';
import { busyMinutes, busyOn, conflictsAt, freestDay, slotLabel } from './availability';

// Le 2026-09-10 est un jeudi (dow 4), le 12 un samedi.
const slot = (over: Partial<SchedSlot> = {}): SchedSlot =>
  ({ id: 's1', who: ['m1'], dow: 4, start: '08:30', end: '16:30', label: 'École', k: 'ecole', rec: 'weekly', ...over });

test('sans membre affecté, rien : « le premier qui passe » n’a pas d’agenda', () => {
  assert.deepEqual(busyOn([slot()], '2026-09-10', []), []);
  assert.equal(freestDay([slot()], [], '2026-09-10'), null);
});

test('les créneaux du jour sont ceux des membres affectés, dans l’ordre des heures', () => {
  const sched = [
    slot({ id: 'foot', who: ['m1'], start: '17:00', end: '18:30', label: 'Foot', k: 'sport' }),
    slot(),
    slot({ id: 'autre', who: ['m2'], start: '09:00', end: '10:00', label: 'Dentiste' }),
  ];
  assert.deepEqual(busyOn(sched, '2026-09-10', ['m1']).map((s) => s.id), ['s1', 'foot']);
  assert.deepEqual(busyOn(sched, '2026-09-10', ['m1', 'm2']).map((s) => s.id), ['s1', 'autre', 'foot']);
  assert.deepEqual(busyOn(sched, '2026-09-12', ['m1']), [], 'le samedi, rien');
});

test('une heure en plein créneau est un conflit ; la fin du créneau et un créneau sans fin sont des instants', () => {
  const ecole = slot();
  const car = slot({ id: 'car', start: '07:50', end: '', label: 'Car' });
  assert.deepEqual(conflictsAt([ecole, car], '10:00').map((s) => s.id), ['s1']);
  assert.deepEqual(conflictsAt([ecole, car], '16:30'), [], 'à la fin du créneau, on est libre');
  assert.deepEqual(conflictsAt([ecole, car], '07:50').map((s) => s.id), ['car']);
  assert.deepEqual(conflictsAt([ecole, car], '08:00'), [], 'le car ne dure pas la matinée');
});

test('le jour le plus libre est celui qui a le moins d’heures prises, puis le plus tôt', () => {
  const sched = [
    slot({ dow: 4 }),
    slot({ id: 'lun', dow: 1 }), slot({ id: 'mar', dow: 2 }), slot({ id: 'mer', dow: 3, end: '12:00' }), slot({ id: 'ven', dow: 5 }),
  ];
  // À partir du jeudi 10 : samedi 12 et dimanche 13 sont vides ; le samedi vient en premier.
  assert.equal(freestDay(sched, ['m1'], '2026-09-10')?.date, '2026-09-12');
  // À partir du lundi 14, sur trois jours : le mercredi n'a qu'une demi-journée.
  assert.equal(freestDay(sched, ['m1'], '2026-09-14', 3)?.date, '2026-09-16');
});

test('quand tous les jours se valent, rien n’est proposé', () => {
  assert.equal(freestDay([], ['m1'], '2026-09-10'), null);
  const chaqueJour = [1, 2, 3, 4, 5, 6, 7].map((dow) => slot({ id: 'd' + dow, dow }));
  assert.equal(freestDay(chaqueJour, ['m1'], '2026-09-10'), null);
});

test('minutes et libellé', () => {
  assert.equal(busyMinutes([slot(), slot({ id: 'car', start: '07:50', end: '' })]), 480);
  assert.equal(slotLabel(slot()), 'École 08:30 à 16:30');
  assert.equal(slotLabel(slot({ start: '07:50', end: '', label: 'Car' })), 'Car 07:50');
});
