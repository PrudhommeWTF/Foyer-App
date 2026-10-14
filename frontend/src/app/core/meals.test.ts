// Le créneau de repas : sa clé, et ce qui compte pour dire qu'il a changé.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sameMeal, splitMealKey } from './meals';

test('une clé de créneau se lit en jour et moment', () => {
  assert.deepEqual(splitMealKey('2026-10-20-soir'), { dateStr: '2026-10-20', slot: 'soir' });
  assert.deepEqual(splitMealKey('2026-10-20-matin'), { dateStr: '2026-10-20', slot: 'matin' });
});

test('enregistrer sans rien changer : le repas est le même', () => {
  const a = { items: [{ rid: 'r1' }, { text: 'Fromage' }], away: ['m2', 'm1'] };
  assert.equal(sameMeal(a, { items: [{ rid: 'r1' }, { text: 'Fromage' }], away: ['m1', 'm2'] }), true, 'l’ordre des absents ne compte pas');
  assert.equal(sameMeal(a, { items: [{ text: 'Fromage' }, { rid: 'r1' }], away: ['m1', 'm2'] }), false, 'l’ordre des plats compte');
  assert.equal(sameMeal(a, { ...a, pax: 6 }), false, 'des couverts posés comptent');
  assert.equal(sameMeal({ items: [{ rid: 'r1' }], pax: null, away: [] }, { items: [{ rid: 'r1' }] }), true, 'vide ou absent, c’est pareil');
});

test('un créneau vide et un créneau absent se valent', () => {
  assert.equal(sameMeal(undefined, { items: [] }), true);
  assert.equal(sameMeal(undefined, { items: [{ rid: 'r1' }] }), false);
});
