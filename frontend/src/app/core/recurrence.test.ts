// Le moteur de récurrence : les deux modes, et les cas qui comptent vraiment
// chez nous. Le test de la piscine fait avec deux jours de retard doit
// revenir une semaine après la réalisation, pas après l'échéance initiale.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskItem, TaskRec } from './models';
import { addMonthsClamped, inSeason, isSeasonDay, nextOccurrence, occurrenceProgress, recLabel, seasonLabel, seasonStart, seasonWindow, skipOccurrence, taskOccursOn, windowEnd } from './recurrence';

const rec = (over: Partial<TaskRec> = {}): TaskRec => ({ freq: 'weekly', every: 1, base: 'due', ...over });

// ---- après la réalisation ----------------------------------------------------------

test('la barre de progression se remplit vers l’occurrence à venir', () => {
  const rec: TaskRec = { freq: 'weekly', every: 1, base: 'due' };
  const due = '2026-09-11'; // vendredi ; l'occurrence précédente est le 2026-09-04
  assert.equal(occurrenceProgress(rec, due, '2026-09-04'), 0, 'vide au jour de la précédente');
  assert.equal(occurrenceProgress(rec, due, '2026-09-11'), 1, 'pleine à l’échéance');
  assert.equal(occurrenceProgress(rec, due, '2026-09-15'), 1, 'pleine (bornée) au-delà de l’échéance');
  const mid = occurrenceProgress(rec, due, '2026-09-08'); // 4 jours sur 7
  assert.ok(mid > 0.5 && mid < 0.6, `mi-parcours attendu ~0,57, reçu ${mid}`);
});

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

// ---- projection au calendrier (taskOccursOn) --------------------------------

const task = (over: Partial<TaskItem> = {}): TaskItem =>
  ({ id: 't1', listId: 'l1', text: 'Poubelles', who: [], due: '2026-09-08', done: false, ...over });

test('sans récurrence, une tâche ne tombe qu’à son échéance', () => {
  const t = task({ rec: null });
  assert.equal(taskOccursOn(t, '2026-09-08'), true);
  assert.equal(taskOccursOn(t, '2026-09-15'), false);
});

test('une tâche hebdomadaire se projette sur chaque semaine, à partir de l’échéance', () => {
  // Mardi 8 sept. 2026, chaque mardi.
  const t = task({ rec: rec({ freq: 'weekly' }) });
  assert.equal(taskOccursOn(t, '2026-09-01'), false, 'avant l’échéance courante, rien');
  assert.equal(taskOccursOn(t, '2026-09-08'), true);
  assert.equal(taskOccursOn(t, '2026-09-15'), true);
  assert.equal(taskOccursOn(t, '2026-09-22'), true);
  assert.equal(taskOccursOn(t, '2026-09-16'), false, 'un autre jour, non');
});

test('« toutes les 2 semaines » ne se projette qu’une semaine sur deux', () => {
  const t = task({ rec: rec({ freq: 'weekly', every: 2 }) });
  assert.equal(taskOccursOn(t, '2026-09-08'), true);
  assert.equal(taskOccursOn(t, '2026-09-15'), false);
  assert.equal(taskOccursOn(t, '2026-09-22'), true);
});

test('la fin de série borne la projection', () => {
  const t = task({ rec: rec({ freq: 'weekly', until: '2026-09-15' }) });
  assert.equal(taskOccursOn(t, '2026-09-15'), true);
  assert.equal(taskOccursOn(t, '2026-09-22'), false);
});

test('le mode « après la réalisation » ne se projette pas : seule l’échéance courante', () => {
  // Le futur dépend du jour où on fait la tâche : on n’invente pas de dates.
  const t = task({ rec: rec({ base: 'done' }) });
  assert.equal(taskOccursOn(t, '2026-09-08'), true);
  assert.equal(taskOccursOn(t, '2026-09-15'), false);
});

// ---- saisons ------------------------------------------------------------------------

test('saison : la piscine chaque semaine de mai à septembre saute l’hiver', () => {
  const r = rec({ base: 'done', season: { from: '05-01', to: '09-30' } });
  assert.equal(nextOccurrence(r, '2026-09-20', '2026-09-20'), '2026-09-27', 'en saison, la cadence ordinaire');
  assert.equal(nextOccurrence(r, '2026-09-27', '2026-09-27'), '2027-05-01', 'le 4 octobre serait hors saison : reprise au 1er mai');
  assert.equal(skipOccurrence(r, '2026-09-27', '2026-09-27'), '2027-05-01');
  assert.match(recLabel(r), /de mai à septembre/);
});

test('saison à cheval sur le 31 décembre, et à date fixe', () => {
  const hiver = { from: '11-01', to: '03-31' };
  assert.equal(inSeason(hiver, '2027-01-15'), true);
  assert.equal(inSeason(hiver, '2026-06-15'), false);
  assert.equal(seasonStart(hiver, '2026-06-15'), '2026-11-01');
  assert.equal(seasonStart(hiver, '2027-02-01'), '2027-02-01', 'déjà dedans');
  // Chaque lundi, en hiver seulement : le dernier lundi de mars, puis le premier lundi de novembre.
  const r = rec({ days: [1], season: hiver });
  assert.equal(nextOccurrence(r, '2027-03-29', '2027-03-29'), '2027-11-01');
  assert.equal(taskOccursOn({ due: '2027-03-29', rec: r }, '2027-04-05'), false, 'hors saison, rien au calendrier');
  assert.equal(taskOccursOn({ due: '2027-03-29', rec: r }, '2027-11-08'), true);
  assert.equal(recLabel(r).includes("de novembre à mars"), true);
});

test('saison : bornes et libellés', () => {
  assert.equal(isSeasonDay('02-29'), true);
  assert.equal(isSeasonDay('02-30'), false);
  assert.equal(isSeasonDay('13-01'), false);
  assert.equal(seasonLabel({ from: '04-01', to: '10-31' }), "d'avril à octobre");
  assert.equal(seasonLabel({ from: '10-01', to: '10-31' }), 'en octobre');
  assert.equal(seasonLabel({ from: '04-15', to: '09-30' }), 'du 15 avril au 30 septembre');
  assert.equal(seasonLabel({ from: '12-01', to: '02-29' }), 'de décembre à février');
  assert.equal(seasonStart({ from: '02-29', to: '03-31' }, '2026-06-01'), '2027-02-28', 'le 29 février tombe le 28 les autres années');
});

test('fenêtre : une échéance et une souplesse tirées de la saison', () => {
  const s = { from: '09-01', to: '10-31' };
  assert.deepEqual(seasonWindow(s, '2026-10-17'), { due: '2026-09-01', grace: 60 });
  assert.deepEqual(seasonWindow(s, '2026-11-01'), { due: '2027-09-01', grace: 60 });
  assert.deepEqual(seasonWindow(s, '2026-03-01'), { due: '2026-09-01', grace: 60 });
  assert.deepEqual(seasonWindow({ from: '12-15', to: '01-15' }, '2027-01-10'), { due: '2026-12-15', grace: 31 }, 'à cheval, celle qui court');
  // Faite dans la fenêtre : la suivante, l'an prochain au début de la fenêtre.
  assert.equal(nextOccurrence(rec({ freq: 'yearly', grace: 60 }), '2026-09-01', '2026-10-17'), '2027-09-01');
});

test('la barre reste vide hors saison, jusqu’à la reprise', () => {
  const r = rec({ base: 'done', season: { from: '05-01', to: '09-30' } });
  assert.equal(occurrenceProgress(r, '2027-05-01', '2027-01-10'), 0);
  assert.ok(occurrenceProgress(r, '2027-05-08', '2027-05-05') > 0.5);
});
