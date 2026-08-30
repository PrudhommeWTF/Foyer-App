// « Qu'est-ce que je fais avec des courgettes et vingt minutes » : la question
// qu'on se pose à dix-neuf heures. Un filtre qui promet vingt minutes sans le
// savoir se paie devant les fourneaux, d'où l'insistance sur ce que la
// recherche écarte faute d'information.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseQuery, searchRecipes, searchText, totalMin } from './recipe-search';
import { buildArticleIndex } from './ingredients';
import { Recipe } from './models';

const idx = buildArticleIndex([]);
const r = (name: string, ingr: string[], prep?: number, cook?: number, tags?: string[], rating?: number): Recipe =>
  ({ id: name, name, level: 'Facile', color: '#000', ingr, steps: [],
     ...(prep ? { prepMin: prep } : {}), ...(cook ? { cookMin: cook } : {}),
     ...(tags ? { tags } : {}), ...(rating ? { rating } : {}) });

const CARNET = [
  r('Gratin de courgettes', ['4 courgettes', '200 g de crème'], 15, 40, ['végétarien']),
  r('Omelette', ['4 œufs', '50 g de gruyère'], 5, 5, [], 5),
  r('Poêlée de patates', ['4 pommes de terre', '1 oignon'], 10, 20),
  r('Sans durée', ['2 carottes']),
];
const noms = (rs: { recipe: Recipe }[]) => rs.map((x) => x.recipe.name);

test('la ligne de recherche mêle mots, durée et note', () => {
  const q = parseQuery('courgette 20min 4*');
  assert.deepEqual(q.words, ['courgette']);
  assert.equal(q.maxMin, 20);
  assert.equal(q.minRating, 4);
});

test('les durées s’écrivent comme on les dit', () => {
  assert.equal(parseQuery('30 min').maxMin, 30);
  assert.equal(parseQuery('-20min').maxMin, 20);
  assert.equal(parseQuery('1h30').maxMin, 90);
  assert.equal(parseQuery('2h').maxMin, 120);
  assert.equal(parseQuery('moins de 15 minutes').maxMin, 15);
  // Deux durées : la plus serrée gagne, c'est celle qu'on voulait dire.
  assert.equal(parseQuery('30min 20min').maxMin, 20);
});

test('ce qui n’est ni durée ni note reste un mot à chercher', () => {
  // Mieux vaut un filtre ignoré qu'un filtre inventé.
  const q = parseQuery('gratin maison');
  assert.deepEqual(q.words, ['gratin', 'maison']);
  assert.equal(q.maxMin, null);
});

test('un mot est cherché jusque dans les ingrédients rattachés', () => {
  // « pomme de terre » doit trouver « patates », sinon la recherche ne sert
  // qu'à ceux qui écrivent comme le carnet.
  assert.ok(searchText(CARNET[2], idx).includes('pomme de terre'));
  assert.deepEqual(noms(searchRecipes(CARNET, parseQuery('pomme de terre'), idx)), ['Poêlée de patates']);
});

test('la recherche par ingrédient trouve la recette, pas la ligne', () => {
  assert.deepEqual(noms(searchRecipes(CARNET, parseQuery('courgette'), idx)), ['Gratin de courgettes']);
  assert.deepEqual(noms(searchRecipes(CARNET, parseQuery('gruyère'), idx)), ['Omelette']);
});

test('plusieurs mots se cumulent, ils ne s’ajoutent pas', () => {
  assert.deepEqual(noms(searchRecipes(CARNET, parseQuery('courgette crème'), idx)), ['Gratin de courgettes']);
  assert.deepEqual(noms(searchRecipes(CARNET, parseQuery('courgette gruyère'), idx)), []);
});

test('une étiquette se cherche comme le reste', () => {
  assert.deepEqual(noms(searchRecipes(CARNET, parseQuery('végétarien'), idx)), ['Gratin de courgettes']);
});

test('une durée demandée écarte les recettes qui ne disent pas la leur', () => {
  // Affirmer qu'une recette sans durée tient en vingt minutes serait le genre
  // de promesse qui se paie à dix-neuf heures trente.
  const out = searchRecipes(CARNET, parseQuery('30min'), idx);
  assert.deepEqual(noms(out), ['Omelette', 'Poêlée de patates']);
  assert.equal(out.every((h) => h.total !== null), true);
});

test('la plus rapide passe devant quand c’est la durée qu’on demande', () => {
  assert.deepEqual(noms(searchRecipes(CARNET, parseQuery('1h'), idx)),
    ['Omelette', 'Poêlée de patates', 'Gratin de courgettes']);
});

test('la durée compte la préparation et la cuisson, pas l’une des deux', () => {
  assert.equal(totalMin(CARNET[0]), 55);
  assert.equal(totalMin(CARNET[3]), null);
  assert.deepEqual(noms(searchRecipes(CARNET, parseQuery('50min'), idx)), ['Omelette', 'Poêlée de patates']);
});

test('la note filtre, et une recette sans note ne prétend pas en avoir une', () => {
  assert.deepEqual(noms(searchRecipes(CARNET, parseQuery('4 étoiles'), idx)), ['Omelette']);
  assert.deepEqual(noms(searchRecipes(CARNET, parseQuery('1 étoile'), idx)), ['Omelette']);
});

test('une recherche vide rend le carnet dans son ordre', () => {
  assert.deepEqual(noms(searchRecipes(CARNET, parseQuery('   '), idx)), CARNET.map((x) => x.name));
});

test('un carnet vide ne fait rien tomber', () => {
  assert.deepEqual(searchRecipes([], parseQuery('courgette'), idx), []);
});
