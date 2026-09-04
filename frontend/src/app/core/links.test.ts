import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ShopItem, TaskItem } from './models';
import { closableShoppingTask, mealEventTitle, shoppingTaskLabel } from './links';

test('la tâche ne répète pas le mot « courses »', () => {
  // « Faire courses de la semaine » : la faute qu'on ne voit plus une fois écrite.
  assert.equal(shoppingTaskLabel('Courses de la semaine'), 'Faire les courses de la semaine');
  assert.equal(shoppingTaskLabel('Courses'), 'Faire les courses');
});

test('une liste nommée autrement est citée, puisque c’est elle qui distingue', () => {
  assert.equal(shoppingTaskLabel('Marché du samedi'), 'Faire les courses : Marché du samedi');
  assert.equal(shoppingTaskLabel('Pharmacie'), 'Faire les courses : Pharmacie');
});

test('sans nom de liste, l’intitulé reste correct', () => {
  assert.equal(shoppingTaskLabel(''), 'Faire les courses');
  assert.equal(shoppingTaskLabel('   '), 'Faire les courses');
});

test('l’événement nomme le créneau et son menu', () => {
  assert.equal(mealEventTitle('Dîner', ['Risotto', 'Tiramisu']), 'Dîner : Risotto · Tiramisu');
});

test('les couverts n’apparaissent que s’ils ont été précisés', () => {
  // Toujours les afficher ferait passer la taille du foyer pour une information
  // sur ce repas-là.
  assert.equal(mealEventTitle('Dîner', ['Raclette'], 8), 'Dîner : Raclette (8 couverts)');
  assert.equal(mealEventTitle('Dîner', ['Raclette'], null), 'Dîner : Raclette');
  assert.equal(mealEventTitle('Dîner', ['Raclette'], 0), 'Dîner : Raclette');
  assert.equal(mealEventTitle('Dîner', ['Raclette'], 1), 'Dîner : Raclette (1 couvert)');
});

test('un plat vide ne laisse ni deux-points orphelins ni séparateur en trop', () => {
  assert.equal(mealEventTitle('Déjeuner', []), 'Déjeuner');
  assert.equal(mealEventTitle('Déjeuner', ['', '  ']), 'Déjeuner');
  assert.equal(mealEventTitle('Déjeuner', ['Soupe', '']), 'Déjeuner : Soupe');
  assert.equal(mealEventTitle('', ['Soupe']), 'Repas : Soupe');
});

// ---- clore la tâche quand la liste est finie ----------------------------------------

const article = (id: string, state: ShopItem['state'], listId = 'cl1'): ShopItem =>
  ({ id, name: id, qty: '', aisleId: 'a1', state, listId });
const tache = (over: Partial<TaskItem> = {}): TaskItem =>
  ({ id: 't1', listId: 'l1', text: 'Faire les courses', who: [], due: null, done: false, shopListId: 'cl1', ...over });

test('la clôture se propose quand plus rien n’est à prendre, et seulement alors', () => {
  assert.equal(closableShoppingTask([tache()], [article('a', 'panier'), article('b', 'a-prendre')], 'cl1'), null, 'il reste un article');
  assert.equal(closableShoppingTask([tache()], [article('a', 'panier'), article('b', 'panier')], 'cl1')?.id, 't1');
  assert.equal(closableShoppingTask([tache()], [article('a', 'panier'), article('b', 'indisponible')], 'cl1')?.id, 't1', 'un article indisponible n’est pas à prendre');
});

test('pas de proposition sur une liste vide, une tâche déjà faite, ou une autre liste', () => {
  assert.equal(closableShoppingTask([tache()], [], 'cl1'), null);
  assert.equal(closableShoppingTask([tache({ done: true })], [article('a', 'panier')], 'cl1'), null);
  assert.equal(closableShoppingTask([tache()], [article('a', 'panier', 'cl2')], 'cl2'), null, 'la tâche ouvre cl1, pas cl2');
  assert.equal(closableShoppingTask([], [article('a', 'panier')], 'cl1'), null);
});
