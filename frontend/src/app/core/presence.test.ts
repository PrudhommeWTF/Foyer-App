// Le compte des couverts décide de la liste de courses, et la liste des présents
// décide de qui doit être alerté. Se tromper ici fait acheter trop ou trop peu,
// et alerte pour quelqu'un qui n'est pas là.
//
// Depuis que la présence se déduit de l'emploi du temps, un second risque
// s'ajoute : celui de retirer quelqu'un de la table pour un créneau qui ne
// couvre pas vraiment le repas. Le sens de l'erreur est choisi et testé : en cas
// de doute, on compte **présent**. Trop de couverts fait un reste au frigo, pas
// assez fait quelqu'un qui n'a rien dans son assiette.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { awayAt, paxLabel, presenceAt } from './presence';
import { calendarFacts } from './schedule';
import { Member, SchedSlot } from './models';

const m = (id: string, name: string): Member => ({ id, name, role: '', color: '#000', ini: name.slice(0, 2) });

const FOYER = [m('t', 'Thomas'), m('l', 'Lea'), m('p', 'Paul')];

const slot = (over: Partial<SchedSlot> = {}): SchedSlot =>
  ({ id: 's1', who: ['l'], dow: 1, start: '08:30', end: '17:00', label: 'Collège', k: 'ecole', rec: 'weekly', away: true, ...over });

// 2026-08-31 est un lundi, 2026-09-06 un dimanche.
const LUNDI = '2026-08-31';
const MARDI = '2026-09-01';

const foyer = (sched: SchedSlot[] = []) => ({ members: FOYER, sched });

// ---- ce que l'emploi du temps retire ---------------------------------------

test('un créneau hors du foyer qui couvre le repas en retire ceux qu’il porte', () => {
  const sched = [slot({ who: ['l', 'p'] })];
  assert.deepEqual([...awayAt(sched, LUNDI, 'midi')].sort(), ['l', 'p']);
  assert.deepEqual([...awayAt(sched, LUNDI, 'soir')], [], 'le collège finit à 17h : le dîner se prend à la maison');
});

test('un créneau à la maison ne retire personne', () => {
  // C'est la case du créneau qui décide, pas son type : le télétravail et le
  // sport à la maison existent.
  const sched = [slot({ away: false, label: 'Télétravail', k: 'travail' })];
  assert.deepEqual([...awayAt(sched, LUNDI, 'midi')], []);
});

test('un créneau sans heure de fin ne retire personne', () => {
  // On ne sait pas quand il finit ; le supposer long ferait sauter des repas
  // pour rien, et c'est le sens d'erreur qu'on refuse.
  assert.deepEqual([...awayAt([slot({ end: '' })], LUNDI, 'midi')], []);
});

test('un créneau qui s’arrête à l’heure du repas laisse le couvert', () => {
  // Une course de 12h à 12h30 ne fait pas sauter le déjeuner de 12h30 : la
  // borne de fin est exclue.
  assert.deepEqual([...awayAt([slot({ start: '12:00', end: '12:30' })], LUNDI, 'midi')], []);
  assert.deepEqual([...awayAt([slot({ start: '12:00', end: '12:31' })], LUNDI, 'midi')], ['l']);
});

test('un créneau d’un autre jour ne retire personne', () => {
  assert.deepEqual([...awayAt([slot({ dow: 2 })], LUNDI, 'midi')], []);
  assert.deepEqual([...awayAt([slot({ dow: 2 })], MARDI, 'midi')], ['l']);
});

test('les vacances remettent tout le monde à la maison', () => {
  // Le collège n'a pas lieu pendant les vacances : le déjeuner se prend ici.
  const cal = calendarFacts([{ start: '2026-08-24', end: '2026-08-31' }]);
  const sched = [slot({ when: 'school' })];
  assert.deepEqual([...awayAt(sched, LUNDI, 'midi', cal)], [], 'le 31 août tombe dans les vacances');
  assert.deepEqual([...awayAt(sched, '2026-09-07', 'midi', cal)], ['l'], 'la rentrée le ramène dehors');
});

test('une occurrence annulée ne retire personne ce jour-là', () => {
  const sched = [slot({ skip: [LUNDI] })];
  assert.deepEqual([...awayAt(sched, LUNDI, 'midi')], []);
  assert.deepEqual([...awayAt(sched, '2026-09-07', 'midi')], ['l']);
});

test('une période close ne retire plus personne', () => {
  // L'activité de l'an dernier ne doit pas continuer à vider la table.
  assert.deepEqual([...awayAt([slot({ until: '2026-06-30' })], LUNDI, 'midi')], []);
});

// ---- le compte des couverts -------------------------------------------------

test('l’emploi du temps retire les absents du jour, et d’eux seuls', () => {
  const sched = [slot({ who: ['l'] })];
  const midi = presenceAt(foyer(sched), LUNDI, 'midi');
  assert.deepEqual(midi.present.map((x) => x.id), ['t', 'p']);
  assert.deepEqual(midi.away.map((x) => x.id), ['l']);
  assert.equal(midi.pax, 2);

  const soir = presenceAt(foyer(sched), LUNDI, 'soir');
  assert.equal(soir.pax, 3, 'le soir, tout le monde est rentré');
});

test('la dérogation du créneau retire quelqu’un que l’emploi du temps attendait', () => {
  const p = presenceAt(foyer(), LUNDI, 'soir', { items: [], away: ['p'] });
  assert.deepEqual(p.present.map((x) => x.id), ['t', 'l']);
  assert.equal(p.pax, 2);
});

test('les couverts posés à la main priment sur tout', () => {
  const p = presenceAt(foyer([slot()]), LUNDI, 'midi', { items: [], pax: 8 });
  assert.equal(p.pax, 8);
  assert.equal(p.manual, true);
});

test('un créneau où tout le monde est marqué absent compte quand même un couvert', () => {
  // Une liste de courses pour zéro personne ne veut rien dire.
  const p = presenceAt(foyer(), LUNDI, 'soir', { items: [], away: ['t', 'l', 'p'] });
  assert.equal(p.pax, 1);
  assert.equal(p.present.length, 0);
});

test('un foyer sans membre compte quand même un couvert', () => {
  assert.equal(presenceAt({ members: [], sched: [] }, LUNDI, 'midi').pax, 1);
});

test('un emploi du temps absent ou biscornu ne fait pas tomber le compte', () => {
  assert.equal(presenceAt({ members: FOYER, sched: [] }, LUNDI, 'midi').pax, 3);
  const bancal = { ...slot(), who: undefined } as unknown as SchedSlot;
  assert.doesNotThrow(() => awayAt([bancal], LUNDI, 'midi'));
});

// ---- la phrase affichée ------------------------------------------------------

test('la phrase des couverts dit qui manque, sans accorder sur les prénoms', () => {
  const sched = [slot({ who: ['l'] })];
  assert.equal(paxLabel(presenceAt(foyer(sched), LUNDI, 'soir')), '3 couverts');
  // Tourné sans accord : l'application ne connaît pas le genre de ses membres,
  // et « Paul absente » décrédibiliserait tout le reste.
  assert.equal(paxLabel(presenceAt(foyer(sched), LUNDI, 'midi')), '2 couverts (sans Lea)');
  assert.equal(paxLabel(presenceAt(foyer(sched), LUNDI, 'midi', { items: [], away: ['p'] })), '1 couvert (sans Lea, Paul)');
  // Un chiffre posé à la main ne s'explique pas : il est ce qu'il est.
  assert.equal(paxLabel(presenceAt(foyer(sched), LUNDI, 'midi', { items: [], pax: 6 })), '6 couverts');
});
