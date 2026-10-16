// Réordonnancement des rayons par glisser-déposer : le repli reste en tête, les
// positions restent contiguës, et une entrée parasite (identifiant inconnu) ne
// casse pas l'ordre.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { reorderAisleIds } from './aisles';

// Un foyer type : le repli « À trier » en tête, puis quatre rayons.
const current = ['a-repli', 'a-legumes', 'a-viande', 'a-frais', 'a-monde'];

test('déplace un rayon de la fin vers le début sans bouger le repli', () => {
  // L'utilisateur glisse « a-monde » juste après le repli.
  const out = reorderAisleIds(current, 'a-repli', ['a-monde', 'a-legumes', 'a-viande', 'a-frais']);
  assert.deepEqual(out, ['a-repli', 'a-monde', 'a-legumes', 'a-viande', 'a-frais']);
  assert.equal(out[0], 'a-repli', 'le repli reste en tête');
});

test('positions contiguës et sans perte : le résultat est une permutation de l’entrée', () => {
  const out = reorderAisleIds(current, 'a-repli', ['a-frais', 'a-monde', 'a-legumes', 'a-viande']);
  assert.equal(out.length, current.length);
  assert.deepEqual([...out].sort(), [...current].sort(), 'aucun rayon perdu ni dupliqué');
  // Appliqué par index, cela donne des positions 0..n-1 contiguës.
  assert.deepEqual(out.map((_, i) => i), [0, 1, 2, 3, 4]);
});

test('le repli ne se déplace pas même si on tente de le glisser', () => {
  const out = reorderAisleIds(current, 'a-repli', ['a-repli', 'a-viande', 'a-legumes', 'a-frais', 'a-monde']);
  assert.equal(out[0], 'a-repli', 'le repli est ignoré dans l’ordre glissé et épinglé en tête');
  assert.deepEqual(out, ['a-repli', 'a-viande', 'a-legumes', 'a-frais', 'a-monde']);
});

test('un identifiant inconnu est ignoré, les rayons omis gardent leur ordre courant', () => {
  // « a-fantome » n'existe pas ; « a-frais » n'est pas mentionné.
  const out = reorderAisleIds(current, 'a-repli', ['a-fantome', 'a-monde', 'a-viande', 'a-legumes']);
  assert.ok(!out.includes('a-fantome'), 'l’identifiant inconnu est écarté');
  assert.deepEqual(out, ['a-repli', 'a-monde', 'a-viande', 'a-legumes', 'a-frais']);
});

test('sans repli dans la liste, rien n’est épinglé', () => {
  const out = reorderAisleIds(['a-legumes', 'a-viande'], 'a-repli', ['a-viande', 'a-legumes']);
  assert.deepEqual(out, ['a-viande', 'a-legumes']);
});
