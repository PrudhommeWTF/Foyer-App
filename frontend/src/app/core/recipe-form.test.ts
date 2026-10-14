// Le formulaire de recette : ouvrir, Modifier, Enregistrer sans rien toucher ne change rien.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Recipe } from './models';
import { recipeChanges, recipeData, recipeFields } from './recipe-form';

let n = 0;
const rowId = (p: string): string => p + ++n;
const tarte: Recipe = { id: 'r1', name: 'Tarte aux pommes', level: 'Facile', color: '#7A9B76', photoId: 12, portions: 6, prepMin: 20, cookMin: 35,
  source: 'https://exemple.fr/tarte', tags: ['dessert'], rating: 4, ingr: ['4 pommes', '1 pâte'], steps: ['Éplucher', 'Cuire'] };

test('ouvert puis enregistré tel quel : rien ne change', () => {
  assert.equal(recipeChanges(tarte, recipeData(recipeFields(tarte, rowId))!), false);
  const ancienne: Recipe = { id: 'r2', name: 'Soupe', level: 'Moyen', color: '#C6492F', ingr: ['carottes'], steps: [] };
  assert.equal(recipeChanges(ancienne, recipeData(recipeFields(ancienne, rowId))!), false, 'champs absents sur une ancienne recette');
});

test('une ligne vide ou des blancs ne sont pas une modification', () => {
  const f = recipeFields(tarte, rowId);
  f.ingr.push({ id: 'x', val: '   ' });
  f.name = ' Tarte aux pommes ';
  assert.equal(recipeChanges(tarte, recipeData(f)!), false);
});

test('une vraie modification se voit', () => {
  const f = recipeFields(tarte, rowId);
  f.cookMin = '40';
  assert.equal(recipeChanges(tarte, recipeData(f)!), true);
});

test('sans nom, rien ne s’enregistre ; une recette neuve part d’une ligne de chaque', () => {
  const f = recipeFields(null, rowId);
  assert.equal(recipeData(f), null);
  assert.equal(f.ingr.length, 1); assert.equal(f.steps.length, 1);
  const d = recipeData({ ...f, name: 'Crêpes', portions: '0', prepMin: 'abc' })!;
  assert.equal(d.portions, null); assert.equal(d.prepMin, null);
  assert.deepEqual(d.ingr, []);
});
