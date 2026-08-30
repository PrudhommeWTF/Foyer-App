// Une suggestion qu'on ne sait pas expliquer ne se discute pas, donc ne se
// corrige pas, donc finit ignorée. Ces tests portent sur les raisons affichées
// autant que sur le classement, et sur ce que le moteur refuse de proposer.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { REPEAT_DAYS, daysBetween, lastServed, semaines, suggestMeals } from './suggest';
import { buildArticleIndex } from './ingredients';
import { MealValue, Member, Recipe, ShopItem } from './models';

const idx = buildArticleIndex([]);
const r = (id: string, name: string, ingr: string[] = [], prepMin?: number, cookMin?: number): Recipe =>
  ({ id, name, level: 'Facile', color: '#000', ingr, steps: [], ...(prepMin ? { prepMin } : {}), ...(cookMin ? { cookMin } : {}) });
const m = (id: string, name: string, allerg: string[] = [], absent: string[] = []): Member =>
  ({ id, name, role: '', color: '#000', ini: name.slice(0, 2), allerg, absent });
const item = (name: string, state: ShopItem['state'] = 'a-prendre'): ShopItem =>
  ({ id: name, name, qty: '', aisleId: 'a1', listId: 'l1', state });

const JOUR = '2026-08-31';  // un lundi
const base = { members: [] as Member[], index: idx, shop: [] as ShopItem[], dateStr: JOUR, slot: 'soir' };

test('la dernière fois qu’une recette a été servie se lit dans le planning', () => {
  const meals: Record<string, MealValue> = {
    '2026-08-01-soir': { items: [{ rid: 'a' }] },
    '2026-08-20-midi': { items: [{ rid: 'a' }, { rid: 'b' }] },
    '2026-08-10-soir': { items: [{ text: 'Restes' }] },
  };
  assert.equal(lastServed('a', meals), '2026-08-20');
  assert.equal(lastServed('b', meals), '2026-08-20');
  assert.equal(lastServed('c', meals), null);
  assert.equal(lastServed('a', {}), null);
});

test('l’écart entre deux dates se compte en jours pleins', () => {
  assert.equal(daysBetween('2026-08-01', '2026-08-31'), 30);
  assert.equal(daysBetween('2026-08-31', '2026-08-31'), 0);
  // Un écart négatif veut dire que la recette est prévue plus tard.
  assert.equal(daysBetween('2026-09-05', '2026-08-31'), -5);
});

test('une recette servie dans les quinze derniers jours n’est pas proposée', () => {
  const meals = { '2026-08-25-soir': { items: [{ rid: 'a' }] } };
  const out = suggestMeals({ ...base, recipes: [r('a', 'Gratin'), r('b', 'Soupe')], meals });
  assert.deepEqual(out.suggestions.map((s) => s.recipe.name), ['Soupe']);
  assert.equal(out.recent, 1);
});

test('une recette déjà planifiée plus tard n’est pas proposée non plus', () => {
  // Sinon on la mettrait deux fois dans la même semaine sans s'en apercevoir.
  const meals = { '2026-09-03-soir': { items: [{ rid: 'a' }] } };
  const out = suggestMeals({ ...base, recipes: [r('a', 'Gratin'), r('b', 'Soupe')], meals });
  assert.deepEqual(out.suggestions.map((s) => s.recipe.name), ['Soupe']);
});

test('la limite d’anti-répétition est celle annoncée, au jour près', () => {
  const recipes = [r('a', 'Gratin')];
  const dedans = suggestMeals({ ...base, recipes, meals: { '2026-08-17-soir': { items: [{ rid: 'a' }] } } });
  const dehors = suggestMeals({ ...base, recipes, meals: { '2026-08-16-soir': { items: [{ rid: 'a' }] } } });
  assert.equal(daysBetween('2026-08-17', JOUR), REPEAT_DAYS - 1);
  assert.equal(dedans.suggestions.length, 0);
  assert.equal(dehors.suggestions.length, 1);
});

test('une recette jamais faite le dit, et passe devant', () => {
  const meals = { '2026-07-01-soir': { items: [{ rid: 'b' }] } };
  const out = suggestMeals({ ...base, recipes: [r('a', 'Neuve'), r('b', 'Ancienne')], meals });
  assert.deepEqual(out.suggestions.map((s) => s.recipe.name), ['Neuve', 'Ancienne']);
  assert.ok(out.suggestions[0].reasons.includes('jamais encore faite'));
  assert.equal(out.suggestions[0].since, null);
  assert.ok(out.suggestions[1].reasons.some((x) => x.startsWith('pas faite depuis')));
});

test('les ingrédients déjà sur la liste comptent, et le disent', () => {
  const out = suggestMeals({
    ...base,
    recipes: [r('a', 'Soupe', ['2 carottes', '1 poireau']), r('b', 'Salade', ['1 concombre'])],
    meals: {},
    shop: [item('Carotte'), item('Poireau')],
  });
  const soupe = out.suggestions.find((s) => s.recipe.name === 'Soupe')!;
  assert.equal(soupe.onList, 2);
  assert.ok(soupe.reasons.includes('2 ingrédients déjà sur la liste'));
  assert.equal(out.suggestions.find((s) => s.recipe.name === 'Salade')!.onList, 0);
});

test('un article déjà dans le panier ne compte plus comme « sur la liste »', () => {
  // Il est acheté : il ne dit plus rien sur ce qu'il reste à prendre.
  const out = suggestMeals({
    ...base, recipes: [r('a', 'Soupe', ['2 carottes'])], meals: {}, shop: [item('Carotte', 'panier')],
  });
  assert.equal(out.suggestions[0].onList, 0);
});

test('une recette rapide le dit, au-delà elle se tait', () => {
  const out = suggestMeals({ ...base, recipes: [r('a', 'Omelette', [], 5, 5), r('b', 'Pot-au-feu', [], 30, 180)], meals: {} });
  const rapide = out.suggestions.find((s) => s.recipe.name === 'Omelette')!;
  assert.ok(rapide.reasons.includes('prête en 10 min'));
  assert.equal(out.suggestions.find((s) => s.recipe.name === 'Pot-au-feu')!.reasons.some((x) => x.startsWith('prête')), false);
});

test('à égalité d’ancienneté, la liste de courses tranche, puis la durée', () => {
  const out = suggestMeals({
    ...base, meals: {}, shop: [item('Carotte')],
    recipes: [r('a', 'Longue', [], 90), r('b', 'Courte', [], 10), r('c', 'Avec courses', ['2 carottes'], 60)],
  });
  assert.deepEqual(out.suggestions.map((s) => s.recipe.name), ['Avec courses', 'Courte', 'Longue']);
});

test('une recette qui ne convient pas à un convive attendu est écartée, et c’est dit', () => {
  // L'écarter en silence ferait croire à un carnet plus pauvre qu'il n'est.
  const out = suggestMeals({
    ...base, meals: {}, members: [m('l', 'Lea', ['lait'])],
    recipes: [r('a', 'Gratin', ['50 cl de lait']), r('b', 'Salade', ['2 carottes'])],
  });
  assert.deepEqual(out.suggestions.map((s) => s.recipe.name), ['Salade']);
  assert.deepEqual(out.excluded, [{ name: 'Gratin', why: 'Lea' }]);
});

test('une recette est proposée le soir où la personne qu’elle gêne n’est pas là', () => {
  // C'est tout l'intérêt de la semaine type : le carnet s'ouvre les jours
  // d'absence au lieu de rester fermé toute l'année.
  const lea = m('l', 'Lea', ['lait'], ['1-soir']);
  const recipes = [r('a', 'Gratin', ['50 cl de lait'])];
  assert.equal(suggestMeals({ ...base, meals: {}, members: [m('l', 'Lea', ['lait'])], recipes }).suggestions.length, 0);
  assert.equal(suggestMeals({ ...base, meals: {}, members: [lea], recipes }).suggestions.length, 1);
});

test('une recette bien notée le dit, mais ne double personne pour autant', () => {
  // La note vient en dernier critère : sinon on mangerait toujours la même
  // chose, ce qui est exactement ce que l'anti-répétition cherche à éviter.
  const notee: Recipe = { ...r('a', 'Adorée', [], 60), rating: 5 };
  const rapide = r('b', 'Rapide', [], 10);
  const out = suggestMeals({ ...base, recipes: [notee, rapide], meals: {} });
  assert.deepEqual(out.suggestions.map((s) => s.recipe.name), ['Rapide', 'Adorée']);
  assert.ok(out.suggestions[1].reasons.includes('bien notée'));
  // À durée égale, la note départage.
  const egal = suggestMeals({ ...base, meals: {}, recipes: [r('c', 'Quelconque', [], 10), { ...r('d', 'Aimée', [], 10), rating: 5 }] });
  assert.deepEqual(egal.suggestions.map((s) => s.recipe.name), ['Aimée', 'Quelconque']);
});

test('le nombre de propositions est borné, mais les écartées restent comptées', () => {
  const recipes = Array.from({ length: 20 }, (_, i) => r('r' + i, 'Recette ' + i));
  const out = suggestMeals({ ...base, recipes, meals: {}, limit: 3 });
  assert.equal(out.suggestions.length, 3);
});

test('un carnet vide ne fait rien tomber', () => {
  const out = suggestMeals({ ...base, recipes: [], meals: {} });
  assert.deepEqual(out.suggestions, []);
  assert.equal(out.recent, 0);
});

test('les durées se disent en semaines et en mois, pas en jours', () => {
  assert.equal(semaines(21), 'trois semaines');
  assert.equal(semaines(28), 'quatre semaines');
  // Au-delà de quatre semaines, on bascule sur les mois : « cinq semaines » ne
  // se lit plus, et personne ne compte comme ça.
  assert.equal(semaines(30), 'un mois');
  assert.equal(semaines(35), 'un mois');
  assert.equal(semaines(75), '2 mois');
});
