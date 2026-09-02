// La semaine type de l'emploi du temps.
//
// Une règle est vérifiée par presque tous ces tests, parce que c'est elle qui
// décide si le module sert à quelque chose : **aucune sélection veut dire tout
// le foyer, jamais rien.** L'écran précédent s'ouvrait filtré sur un membre qui
// n'existait dans aucun foyer réel, et n'affichait donc rien tant qu'on n'avait
// pas cliqué. Un filtre vide qui viderait l'écran est un bug, pas un réglage.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WHO_SHOWN, dowLabel, filterSlots, matchesWho, slotsOn, slotsOnDow, sortSlots, whoBadges } from './schedule';
import { Member, SchedSlot } from './models';

const slot = (over: Partial<SchedSlot> = {}): SchedSlot =>
  ({ id: 's1', who: ['m1'], dow: 4, start: '08:30', end: '16:30', label: 'École', k: 'ecole', ...over });

const membre = (id: string, name: string, color: string): Member =>
  ({ id, name, role: 'Membre', color, ini: name.slice(0, 2).toUpperCase() });

const FOYER = [
  membre('me', 'Thomas', '#E56B4E'),
  membre('m1', 'Léa', '#7A9B76'),
  membre('m2', 'Paul', '#4E93B8'),
  membre('m3', 'Claire', '#9B6FA8'),
];

// ---- jours ------------------------------------------------------------------

test('les jours se nomment de lundi à dimanche, et rien d’autre ne passe', () => {
  assert.equal(dowLabel(1), 'Lundi');
  assert.equal(dowLabel(3), 'Mercredi');
  assert.equal(dowLabel(7), 'Dimanche');
  // Un numéro hors bornes ne doit pas rendre « undefined » dans l'interface.
  assert.equal(dowLabel(0), 'Lundi');
  assert.equal(dowLabel(9), 'Lundi');
});

test('une date se traduit en jour de la semaine type', () => {
  // Le 2026-09-03 est un jeudi, le 2026-09-06 un dimanche.
  const sched = [slot({ id: 'jeu', dow: 4 }), slot({ id: 'dim', dow: 7 })];
  assert.deepEqual(slotsOn(sched, '2026-09-03').map((s) => s.id), ['jeu']);
  assert.deepEqual(slotsOn(sched, '2026-09-06').map((s) => s.id), ['dim']);
});

test('le mercredi n’est un jour particulier pour personne dans le code', () => {
  // Il est le plus atypique du foyer (pas d'école pour l'un, pas de travail pour
  // l'autre, activités l'après-midi), et c'est justement pour cela qu'il ne doit
  // être nulle part un cas à part : il se lit exactement comme les six autres.
  const sched = [1, 2, 3, 4, 5, 6, 7].map((dow) => slot({ id: 'j' + dow, dow }));
  for (const dow of [1, 2, 3, 4, 5, 6, 7]) {
    assert.deepEqual(slotsOnDow(sched, dow).map((s) => s.id), ['j' + dow]);
  }
});

// ---- ordre ------------------------------------------------------------------

test('les créneaux sortent dans l’ordre des heures', () => {
  const sched = [
    slot({ id: 'soir', start: '17:00', end: '18:00' }),
    slot({ id: 'matin', start: '07:50', end: '08:20' }),
    slot({ id: 'midi', start: '12:00', end: '13:30' }),
  ];
  assert.deepEqual(slotsOnDow(sched, 4).map((s) => s.id), ['matin', 'midi', 'soir']);
});

test('deux créneaux à la même heure gardent un ordre stable', () => {
  // Chez nous deux enfants partent à 7h50 : sans critère de repli, ils
  // changeraient de place d'un rendu à l'autre.
  const a = slot({ id: 'a', start: '07:50', end: '08:20', label: 'Car de Paul' });
  const b = slot({ id: 'b', start: '07:50', end: '08:10', label: 'École de Léa' });
  assert.deepEqual(sortSlots([a, b]).map((s) => s.id), ['b', 'a'], 'à heure égale, la fin la plus tôt passe devant');
  assert.deepEqual(sortSlots([b, a]).map((s) => s.id), ['b', 'a'], 'l’ordre ne dépend pas de celui du document');
});

test('un créneau sans heure de fin ne perturbe pas l’ordre', () => {
  const sched = [slot({ id: 'fin', start: '09:00', end: '10:00' }), slot({ id: 'sans', start: '09:00', end: '' })];
  assert.deepEqual(sortSlots(sched).map((s) => s.id), ['sans', 'fin']);
});

// ---- le filtre est un affinage ---------------------------------------------

test('un filtre vide laisse passer tout le foyer', () => {
  const sched = [slot({ id: 'a', who: ['m1'] }), slot({ id: 'b', who: ['m2'] }), slot({ id: 'c', who: ['me', 'm3'] })];
  assert.deepEqual(filterSlots(sched, []).map((s) => s.id), ['a', 'b', 'c']);
});

test('un filtre vide laisse aussi passer les créneaux sans membre', () => {
  // Sinon ils seraient invisibles et donc irréparables : on ne peut pas
  // sélectionner un membre qui n'existe plus.
  const sched = [slot({ id: 'orphelin', who: [] })];
  assert.deepEqual(filterSlots(sched, []).map((s) => s.id), ['orphelin']);
  assert.deepEqual(filterSlots(sched, ['m1']), [], 'mais un filtre actif ne les réclame pas');
});

test('un filtre retient les créneaux d’au moins un des membres choisis', () => {
  const sched = [slot({ id: 'lea', who: ['m1'] }), slot({ id: 'paul', who: ['m2'] }), slot({ id: 'claire', who: ['m3'] })];
  assert.deepEqual(filterSlots(sched, ['m1', 'm2']).map((s) => s.id), ['lea', 'paul']);
});

test('un créneau partagé n’apparaît qu’une fois, quel que soit le filtre', () => {
  // La messe du dimanche concerne tout le monde : c'est une ligne, pas quatre.
  const messe = slot({ id: 'messe', who: ['me', 'm1', 'm2', 'm3'], dow: 7, start: '10:30', label: 'Messe', k: 'loisir' });
  assert.equal(filterSlots([messe], []).length, 1);
  assert.equal(filterSlots([messe], ['m1']).length, 1);
  assert.equal(filterSlots([messe], ['me', 'm1', 'm2', 'm3']).length, 1);
});

test('désélectionner tout le monde revient à la vue complète, pas à un écran vide', () => {
  // C'est la recette de l'utilisateur, écrite en test : je sélectionne un
  // enfant, puis je désélectionne, et je dois retrouver toute la famille.
  const sched = [slot({ id: 'a', who: ['m1'] }), slot({ id: 'b', who: ['m2'] })];
  const affine = filterSlots(sched, ['m1']);
  assert.equal(affine.length, 1);
  assert.equal(filterSlots(sched, []).length, sched.length);
});

test('matchesWho ne se laisse pas piéger par un créneau sans liste de membres', () => {
  const bancal = { ...slot(), who: undefined } as unknown as SchedSlot;
  assert.equal(matchesWho(bancal, []), true);
  assert.equal(matchesWho(bancal, ['m1']), false);
});

// ---- marqueurs d'identité ---------------------------------------------------

test('les marqueurs portent la couleur et les initiales du membre', () => {
  const b = whoBadges(slot({ who: ['m1'] }), FOYER);
  assert.equal(b.length, 1);
  assert.equal(b[0].color, '#7A9B76');
  assert.equal(b[0].ini, 'LÉ');
  assert.equal(b[0].name, 'Léa');
});

test('les marqueurs suivent l’ordre du foyer, pas celui du créneau', () => {
  // Une même personne doit se retrouver à la même place d'une ligne à l'autre.
  const a = whoBadges(slot({ who: ['m3', 'me'] }), FOYER).map((x) => x.id);
  const b = whoBadges(slot({ who: ['me', 'm3'] }), FOYER).map((x) => x.id);
  assert.deepEqual(a, ['me', 'm3']);
  assert.deepEqual(a, b);
});

test('un membre supprimé laisse une pastille grise plutôt que rien', () => {
  const b = whoBadges(slot({ who: ['m1', 'disparu'] }), FOYER);
  assert.deepEqual(b.map((x) => x.id), ['m1', 'disparu']);
  assert.equal(b[1].ini, '?');
  assert.equal(b[1].color, '#8A7E74');
});

test('un créneau sans membre ne rend aucun marqueur', () => {
  assert.deepEqual(whoBadges(slot({ who: [] }), FOYER), []);
});

test('le débordement se compte au-delà de trois membres', () => {
  const b = whoBadges(slot({ who: ['me', 'm1', 'm2', 'm3'] }), FOYER);
  assert.equal(b.length, 4);
  assert.equal(b.length - WHO_SHOWN, 1, 'quatre membres : trois pastilles et un « +1 »');
});
