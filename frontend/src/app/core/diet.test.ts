// Une alerte d'allergène fausse est pire que pas d'alerte : on cesse de la lire,
// y compris le jour où elle est juste. Les tests ci-dessous portent donc autant
// sur ce qui doit alerter que sur ce qui ne doit surtout pas, et sur ce que le
// moteur avoue ne pas avoir vérifié.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { checkRecipe, conflictLabel, conflicts, dietOf, hasDiet, mealConflicts, recipeContent } from './diet';
import { buildArticleIndex } from './ingredients';
import { Member, Recipe } from './models';

const idx = buildArticleIndex([]);
const recette = (id: string, name: string, ingr: string[]): Recipe =>
  ({ id, name, level: 'Facile', color: '#E56B4E', ingr, steps: [] });
const membre = (id: string, name: string, allerg: string[] = [], refuse: string[] = []): Member =>
  ({ id, name, role: '', color: '#9B6FA8', ini: name.slice(0, 2).toUpperCase(), allerg, refuse });

// ---- contenu d'une recette --------------------------------------------------

test('les allergènes d’une recette viennent des articles rattachés', () => {
  const c = recipeContent(recette('r1', 'Crêpes', ['250 g de farine', '2 œufs', '50 cl de lait']), idx);
  assert.deepEqual(c.allerg, ['gluten', 'oeuf', 'lait']);
  assert.equal(c.unchecked.length, 0);
});

test('l’ordre des allergènes est celui du référentiel, pas celui de la recette', () => {
  // La même recette doit s'afficher pareil d'une session à l'autre.
  const a = recipeContent(recette('r1', 'A', ['50 cl de lait', '250 g de farine']), idx);
  const b = recipeContent(recette('r2', 'B', ['250 g de farine', '50 cl de lait']), idx);
  assert.deepEqual(a.allerg, b.allerg);
});

test('un allergène présent deux fois n’est compté qu’une', () => {
  const c = recipeContent(recette('r1', 'Gâteau', ['200 g de farine', '100 g de pâtes']), idx);
  assert.deepEqual(c.allerg, ['gluten']);
});

test('une ligne non rattachée est signalée comme non vérifiée, pas ignorée', () => {
  // C'est la propriété qui rend l'écran honnête : sans elle, l'absence
  // d'allergène se lirait comme une garantie.
  const c = recipeContent(recette('r1', 'Ramen', ['150 g de nouilles soba', '2 œufs']), idx);
  assert.deepEqual(c.allerg, ['oeuf']);
  assert.deepEqual(c.unchecked, ['150 g de nouilles soba']);
});

test('la même ligne non rattachée n’est signalée qu’une fois', () => {
  const c = recipeContent(recette('r1', 'Ramen', ['du gomasio', 'du gomasio']), idx);
  assert.equal(c.unchecked.length, 1);
});

// ---- conflits ---------------------------------------------------------------

test('un membre allergique à un ingrédient présent est signalé', () => {
  const r = recette('r1', 'Crêpes', ['250 g de farine', '50 cl de lait']);
  const out = checkRecipe(r, [membre('m1', 'Léa', ['lait'])], idx);
  assert.equal(out.conflicts.length, 1);
  assert.deepEqual(out.conflicts[0].allerg, ['lait']);
  assert.equal(conflictLabel(out.conflicts[0]), 'Léa : lait');
});

test('un membre sans contrainte déclarée n’est jamais signalé', () => {
  // Ne rien savoir de quelqu'un n'est pas une raison de l'alerter.
  const r = recette('r1', 'Crêpes', ['250 g de farine', '50 cl de lait']);
  assert.deepEqual(checkRecipe(r, [membre('m1', 'Thomas')], idx).conflicts, []);
});

test('un allergène déclaré mais absent du plat ne déclenche rien', () => {
  const r = recette('r1', 'Salade', ['2 carottes', '1 concombre']);
  assert.deepEqual(checkRecipe(r, [membre('m1', 'Léa', ['lait', 'gluten'])], idx).conflicts, []);
});

test('un aliment refusé est nommé comme le référentiel le nomme', () => {
  const cle = idx.forms.get('champignon')!;
  // « champignons de Paris » au pluriel : la forme que tout le monde écrit.
  const r = recette('r1', 'Poêlée', ['300 g de champignons de Paris', '2 carottes']);
  const out = checkRecipe(r, [membre('m1', 'Paul', [], [cle])], idx);
  assert.equal(out.conflicts.length, 1);
  assert.deepEqual(out.conflicts[0].allerg, []);
  assert.equal(out.conflicts[0].refused.length, 1);
  assert.equal(conflictLabel(out.conflicts[0]), 'Paul : champignon');
});

test('un même plat peut heurter plusieurs personnes, chacune pour sa raison', () => {
  const r = recette('r1', 'Quiche', ['250 g de farine', '3 œufs', '200 g de lardons']);
  const out = checkRecipe(r, [
    membre('m1', 'Léa', ['oeuf']),
    membre('m2', 'Paul', [], [idx.forms.get('lardon')!]),
    membre('m3', 'Thomas'),
  ], idx);
  assert.deepEqual(out.conflicts.map((c) => c.name), ['Léa', 'Paul']);
});

test('une ligne non rattachée ne fabrique pas de conflit, et n’en dissimule pas la cause', () => {
  // Le plat contient peut-être du lait, mais le moteur n'en sait rien : il se
  // tait sur le conflit et le dit dans `unchecked`.
  const r = recette('r1', 'Ramen', ['150 g de nouilles soba']);
  const out = checkRecipe(r, [membre('m1', 'Léa', ['gluten'])], idx);
  assert.deepEqual(out.conflicts, []);
  assert.equal(out.content.unchecked.length, 1);
});

test('conflicts se lit sans recette, à partir d’un contenu déjà calculé', () => {
  const c = recipeContent(recette('r1', 'Crêpes', ['50 cl de lait']), idx);
  assert.equal(conflicts(c, [membre('m1', 'Léa', ['lait'])], idx).length, 1);
  assert.deepEqual(conflicts(c, [], idx), []);
});

// ---- créneau de repas -------------------------------------------------------

const CARNET = [
  recette('r1', 'Crêpes', ['250 g de farine', '50 cl de lait']),
  recette('r2', 'Salade', ['2 carottes']),
  recette('r3', 'Omelette', ['4 œufs']),
];

test('un créneau signale ce qui heurte, quel que soit le plat en cause', () => {
  const out = mealConflicts([{ rid: 'r2' }, { rid: 'r1' }], CARNET, [membre('m1', 'Léa', ['lait'])], idx);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].allerg, ['lait']);
});

test('deux plats qui heurtent la même personne ne la nomment qu’une fois', () => {
  // Sinon la grille du planning afficherait le même prénom deux fois.
  const out = mealConflicts([{ rid: 'r1' }, { rid: 'r3' }], CARNET, [membre('m1', 'Léa', ['lait', 'oeuf'])], idx);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].allerg, ['lait', 'oeuf']);
});

test('un plat en texte libre ne prétend rien', () => {
  // Il n'a pas d'ingrédients à lire : l'inventer serait pire que se taire.
  assert.deepEqual(mealConflicts([{ text: 'Restes du midi' }], CARNET, [membre('m1', 'Léa', ['lait'])], idx), []);
});

test('un créneau vide ou pointant sur une recette effacée ne fait rien tomber', () => {
  assert.deepEqual(mealConflicts([], CARNET, [membre('m1', 'Léa', ['lait'])], idx), []);
  assert.deepEqual(mealConflicts([{ rid: 'disparue' }], CARNET, [membre('m1', 'Léa', ['lait'])], idx), []);
});

test('le conflit rendu ne partage pas ses tableaux avec l’appelant', () => {
  const out = mealConflicts([{ rid: 'r1' }], CARNET, [membre('m1', 'Léa', ['lait'])], idx);
  out[0].allerg.push('gluten');
  const encore = mealConflicts([{ rid: 'r1' }], CARNET, [membre('m1', 'Léa', ['lait'])], idx);
  assert.deepEqual(encore[0].allerg, ['lait']);
});

// ---- lecture d'un membre ----------------------------------------------------

test('un membre sans contrainte se lit sans faire d’histoires', () => {
  assert.deepEqual(dietOf(membre('m1', 'Thomas')), { allerg: [], refuse: [] });
  assert.equal(hasDiet(membre('m1', 'Thomas')), false);
  assert.equal(hasDiet(membre('m2', 'Léa', ['lait'])), true);
  assert.equal(hasDiet(membre('m3', 'Paul', [], ['champignon'])), true);
});

// ---- sur le carnet réel -----------------------------------------------------

const etat = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'cuisine-reelle.json'), 'utf8',
)) as { recipes: Recipe[] };

test('le carnet réel produit des allergènes plausibles, pas du bruit', () => {
  const par = new Map<string, number>();
  for (const r of etat.recipes) for (const a of recipeContent(r, idx).allerg) par.set(a, (par.get(a) || 0) + 1);
  // Un carnet familial français : farine, lait et œufs partout, le reste rare.
  // C'est la forme de la distribution qui dit si le moteur lit ou s'il crie.
  assert.ok((par.get('gluten') || 0) >= 12, 'gluten trouvé ' + par.get('gluten') + ' fois');
  assert.ok((par.get('lait') || 0) >= 10, 'lait trouvé ' + par.get('lait') + ' fois');
  assert.ok((par.get('poisson') || 0) <= 3, 'poisson partout : le moteur crie');
  assert.ok((par.get('arachide') || 0) === undefined || (par.get('arachide') || 0) <= 1);
});

test('un allergène trop prudent se corrige par un article du foyer', () => {
  // Le chocolat pâtissier porte « lait » dans la base, par prudence. Sur une
  // recette explicitement sans lait, l'alerte est de trop : elle se retire en
  // créant l'article du foyer qui convient, sans toucher à l'application.
  const r = etat.recipes.find((x) => x.name.includes('sans lait') && x.name.includes('chocolat'))
    ?? etat.recipes.find((x) => recipeContent(x, idx).allerg.includes('lait'))!;
  assert.ok(recipeContent(r, idx).allerg.includes('lait'));

  const cle = idx.forms.get('chocolat')!;
  const corrige = buildArticleIndex([{ key: cle, name: 'Chocolat noir sans lait', syn: [], rayon: 'epicerie', allerg: ['soja'] }]);
  assert.equal(recipeContent(r, corrige).allerg.includes('lait'), r.ingr.some((l) => /lait|beurre|crème/i.test(l)));
});

test('une allergie au lait sur le carnet réel ne condamne pas tout le carnet', () => {
  const lea = [membre('m1', 'Léa', ['lait'])];
  const heurtees = etat.recipes.filter((r) => checkRecipe(r, lea, idx).conflicts.length);
  assert.ok(heurtees.length > 0, 'aucune recette au lait dans un carnet familial : suspect');
  assert.ok(heurtees.length < etat.recipes.length, 'tout le carnet signalé : le moteur crie');
});
