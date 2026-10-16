// Le thème effectif pour les trois choix, et le suivi du média (le soir, iOS
// passe en sombre : « systeme » doit suivre sans changer le choix).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { effectiveDark } from './theme';

test('clair et sombre ignorent le média', () => {
  assert.equal(effectiveDark('clair', true), false);
  assert.equal(effectiveDark('clair', false), false);
  assert.equal(effectiveDark('sombre', false), true);
  assert.equal(effectiveDark('sombre', true), true);
});

test('systeme suit le média, dans les deux sens', () => {
  assert.equal(effectiveDark('systeme', true), true, 'média sombre -> sombre');
  assert.equal(effectiveDark('systeme', false), false, 'média clair -> clair');
});

test('un changement du média bascule « systeme » sans toucher au choix', () => {
  const choix = 'systeme';
  // Journée : le média est clair.
  assert.equal(effectiveDark(choix, false), false);
  // Le soir : le média passe en sombre, le choix n'a pas bougé.
  assert.equal(effectiveDark(choix, true), true);
});

test('une valeur inconnue est traitée comme systeme', () => {
  assert.equal(effectiveDark('', true), true);
  assert.equal(effectiveDark('nimporte', false), false);
});
