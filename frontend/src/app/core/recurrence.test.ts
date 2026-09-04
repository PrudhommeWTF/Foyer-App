// Le moteur de récurrence : les deux modes, et les cas qui comptent vraiment
// chez nous. Le test de la piscine fait avec deux jours de retard doit
// revenir une semaine après la réalisation, pas après l'échéance initiale.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskRec } from './models';
import { addMonthsClamped, nextOccurrence, recLabel, skipOccurrence, windowEnd } from './recurrence';

const rec = (over: Partial<TaskRec> = {}): TaskRec => ({ freq: 'weekly', every: 1, base: 'due', ...over });

// ---- après la réalisation ----------------------------------------------------------

test('la piscine : prévue samedi, faite dimanche avec deux jours de retard, la suivante tombe le dimanche d’après', () => {
  // 2026-09-05 est un samedi, 2026-09-07 un lundi (deux jours de retard).
  assert.equal(nextOccurrence(rec({ base: 'done' }), '2026-09-05', '2026-09-07'), '2026-09-14');
});

test('après la réalisation, faite en avance : la suivante part quand même du geste', () => {
  assert.equal(nextOccurrence(rec({ base: 'done' }), '2026-09-05', '2026-09-03'), '2026-09-10');
});

test('après la réalisation : la cadence est N jours, N semaines, N mois, N ans à partir du geste', () => {
  assert.equal(nextOccurrence(rec({ freq: 'daily', every: 3, base: 'done' }), '2026-09-05', '2026-09-05'), '2026-09-08');
  assert.equal(nextOccurrence(rec({ freq: 'weekly', every: 2, base: 'done' }), '2026-09-05', '2026-09-05'), '2026-09-19');
  assert.equal(nextOccurrence(rec({ freq: 'monthly', every: 1, base: 'done' }), '2026-09-05', '2026-09-05'), '2026-10-05');
  assert.equal(nextOccurrence(rec({ freq: 'yearly', every: 1, base: 'done' }), '2026-09-05', '2026-09-05'), '2027-09-05');
});

test('après la réalisation, les jours de la semaine n’ont pas de sens : ils sont ignorés', () => {
  assert.equal(nextOccurrence(rec({ base: 'done', days: [1, 3] }), '2026-09-05', '2026-09-07'), '2026-09-14');
});

// ---- à date fixe -----------------------------------------------------------------------

test('les poubelles du mardi, faites le mercredi : la suivante est le mardi d’après, pas un rattrapage', () => {
  // 2026-09-01 est un mardi ; faites le 2.
  assert.equal(nextOccurrence(rec(), '2026-09-01', '2026-09-02'), '2026-09-08');
});

test('à date fixe, faites avec trois semaines de retard : les occurrences manquées ne sont pas rattrapées', () => {
  assert.equal(nextOccurrence(rec(), '2026-09-01', '2026-09-23'), '2026-09-29');
});

test('à date fixe, faites en avance : la suivante reste la suivante de l’échéance', () => {
  assert.equal(nextOccurrence(rec(), '2026-09-08', '2026-09-02'), '2026-09-15');
});

test('hebdomadaire sur certains jours : lundi et jeudi', () => {
  // Le 2026-09-07 est un lundi.
  const r = rec({ days: [1, 4] });
  assert.equal(nextOccurrence(r, '2026-09-07', '2026-09-07'), '2026-09-10');
  assert.equal(nextOccurrence(r, '2026-09-10', '2026-09-10'), '2026-09-14');
});

test('toutes les deux semaines, le samedi : la semaine intermédiaire est sautée', () => {
  assert.equal(nextOccurrence(rec({ every: 2 }), '2026-09-05', '2026-09-05'), '2026-09-19');
  assert.equal(nextOccurrence(rec({ every: 2 }), '2026-09-05', '2026-09-20'), '2026-10-03', 'faite en retard, la cadence reste calée sur la série');
});

test('tous les N jours à date fixe', () => {
  assert.equal(nextOccurrence(rec({ freq: 'daily', every: 3 }), '2026-09-05', '2026-09-05'), '2026-09-08');
  assert.equal(nextOccurrence(rec({ freq: 'daily', every: 3 }), '2026-09-05', '2026-09-09'), '2026-09-11');
});

test('mensuel : le jour du mois est gardé, borné à la fin d’un mois plus court', () => {
  assert.equal(nextOccurrence(rec({ freq: 'monthly' }), '2026-01-31', '2026-01-31'), '2026-02-28');
  assert.equal(nextOccurrence(rec({ freq: 'monthly' }), '2026-02-28', '2026-02-28'), '2026-03-28', 'la série suit le jour de l’échéance courante');
  assert.equal(nextOccurrence(rec({ freq: 'monthly', every: 3 }), '2026-09-15', '2026-09-16'), '2026-12-15');
});

test('annuel : l’ouverture de la piscine revient chaque année, et le 29 février tombe le 28', () => {
  assert.equal(nextOccurrence(rec({ freq: 'yearly' }), '2026-04-15', '2026-04-20'), '2027-04-15');
  assert.equal(nextOccurrence(rec({ freq: 'yearly' }), '2028-02-29', '2028-02-29'), '2029-02-28');
});

test('une fin de série arrête la récurrence : la coche suivante est la dernière', () => {
  assert.equal(nextOccurrence(rec({ until: '2026-09-10' }), '2026-09-01', '2026-09-01'), '2026-09-08');
  assert.equal(nextOccurrence(rec({ until: '2026-09-10' }), '2026-09-08', '2026-09-08'), null);
});

// ---- passer une occurrence, tolérance, libellés -------------------------------------------

test('passer une occurrence à date fixe avance à la suivante de l’échéance ; après réalisation, à partir d’aujourd’hui', () => {
  assert.equal(skipOccurrence(rec(), '2026-09-01', '2026-09-20'), '2026-09-08');
  assert.equal(skipOccurrence(rec({ base: 'done' }), '2026-09-05', '2026-09-07'), '2026-09-14');
  assert.equal(skipOccurrence(rec({ base: 'done' }), '2026-09-12', '2026-09-07'), '2026-09-19', 'une occurrence encore à venir se décale d’un pas');
});

test('la tolérance repousse le moment où une occurrence est en retard', () => {
  assert.equal(windowEnd('2026-04-15', rec({ freq: 'yearly', grace: 15 })), '2026-04-30');
  assert.equal(windowEnd('2026-04-15', rec()), '2026-04-15');
  assert.equal(windowEnd('2026-04-15', null), '2026-04-15');
});

test('addMonthsClamped traverse les années et borne au dernier jour', () => {
  assert.equal(addMonthsClamped('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonthsClamped('2026-12-31', 1), '2027-01-31');
});

test('le libellé dit la règle telle qu’on la lirait', () => {
  const fmt = (iso: string): string => iso.split('-').reverse().join('/');
  assert.equal(recLabel(rec()), 'Chaque semaine');
  assert.equal(recLabel(rec({ every: 2, days: [1, 4] })), 'Toutes les 2 semaines (lun., jeu.)');
  assert.equal(recLabel(rec({ base: 'done' })), 'Chaque semaine après la réalisation');
  assert.equal(recLabel(rec({ freq: 'yearly', grace: 15 })), 'Chaque année, souplesse 15 j');
  assert.equal(recLabel(rec({ freq: 'daily', every: 3, until: '2026-12-31' }), fmt), 'Tous les 3 jours, jusqu\'au 31/12/2026');
  assert.equal(recLabel(rec({ freq: 'monthly', every: 2 })), 'Tous les 2 mois');
});
