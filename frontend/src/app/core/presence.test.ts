// Le compte des couverts décide de la liste de courses, et la liste des présents
// décide de qui doit être alerté. Se tromper ici fait acheter trop ou trop peu,
// et alerte pour quelqu'un qui n'est pas là.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { expectedAt, paxLabel, presenceAt, weekSlot, weekdayOf } from './presence';
import { Member } from './models';

const m = (id: string, name: string, absent: string[] = []): Member =>
  ({ id, name, role: '', color: '#000', ini: name.slice(0, 2), absent });

// 2026-08-31 est un lundi, 2026-09-06 un dimanche.
const LUNDI = '2026-08-31';
const DIMANCHE = '2026-09-06';

test('le jour de la semaine se lit sans fuseau, lundi valant 1', () => {
  assert.equal(weekdayOf(LUNDI), 1);
  assert.equal(weekdayOf(DIMANCHE), 7);
  assert.equal(weekdayOf('2026-09-01'), 2);
  assert.equal(weekSlot(1, 'midi'), '1-midi');
});

test('sans rien savoir d’un membre, il est attendu', () => {
  // Une case vide veut dire « comme d'habitude », pas « personne ne mange ».
  assert.equal(expectedAt(m('a', 'Thomas'), 1, 'midi'), true);
  assert.equal(expectedAt(m('a', 'Thomas', ['1-midi']), 1, 'midi'), false);
  assert.equal(expectedAt(m('a', 'Thomas', ['1-midi']), 1, 'soir'), true);
});

const FOYER = [m('t', 'Thomas'), m('l', 'Lea', ['1-midi', '2-midi']), m('p', 'Paul')];

test('la semaine type retire les absents du jour, et d’eux seuls', () => {
  const lundiMidi = presenceAt(FOYER, LUNDI, 'midi');
  assert.deepEqual(lundiMidi.present.map((x) => x.name), ['Thomas', 'Paul']);
  assert.deepEqual(lundiMidi.away.map((x) => x.name), ['Lea']);
  assert.equal(lundiMidi.pax, 2);

  const lundiSoir = presenceAt(FOYER, LUNDI, 'soir');
  assert.equal(lundiSoir.pax, 3);
  assert.deepEqual(lundiSoir.away, []);
});

test('une dérogation du créneau s’ajoute à la semaine type', () => {
  const p = presenceAt(FOYER, LUNDI, 'soir', { items: [], away: ['p'] });
  assert.deepEqual(p.present.map((x) => x.name), ['Thomas', 'Lea']);
  assert.equal(p.pax, 2);
});

test('des couverts posés à la main l’emportent sur tout', () => {
  // C'est le seul moyen de compter des invités, que rien d'autre ne connaît.
  const p = presenceAt(FOYER, LUNDI, 'midi', { items: [], pax: 8 });
  assert.equal(p.pax, 8);
  assert.equal(p.manual, true);
  // Les présents restent justes : ils servent aux alertes, pas au décompte.
  assert.deepEqual(p.present.map((x) => x.name), ['Thomas', 'Paul']);
});

test('un créneau où tout le monde est marqué absent compte quand même un couvert', () => {
  // Une liste de courses pour zéro personne ne veut rien dire, et le cas arrive
  // dès qu'on coche tout le monde par erreur.
  const p = presenceAt(FOYER, LUNDI, 'soir', { items: [], away: ['t', 'l', 'p'] });
  assert.equal(p.present.length, 0);
  assert.equal(p.pax, 1);
});

test('un foyer sans membre ne fait rien tomber', () => {
  assert.equal(presenceAt([], LUNDI, 'midi').pax, 1);
});

test('le libellé dit pourquoi le compte a baissé, et se tait quand il n’a pas baissé', () => {
  assert.equal(paxLabel(presenceAt(FOYER, LUNDI, 'soir')), '3 couverts');
  // Tourné sans accord : l'application ne connaît pas le genre de ses membres,
  // et « Paul absente » décrédibiliserait tout le reste.
  assert.equal(paxLabel(presenceAt(FOYER, LUNDI, 'midi')), '2 couverts (sans Lea)');
  assert.equal(paxLabel(presenceAt(FOYER, LUNDI, 'midi', { items: [], away: ['p'] })), '1 couvert (sans Lea, Paul)');
  // Des couverts posés à la main ne s'expliquent pas par des absences.
  assert.equal(paxLabel(presenceAt(FOYER, LUNDI, 'midi', { items: [], pax: 6 })), '6 couverts');
});
