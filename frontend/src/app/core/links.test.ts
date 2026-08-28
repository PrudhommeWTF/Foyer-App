import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mealEventTitle, shoppingTaskLabel } from './links';

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
