// Une recette collée de travers doit se voir tout de suite, pas se découvrir
// devant les fourneaux. Ces tests portent donc autant sur ce que le lecteur
// comprend que sur ce qu'il avoue ne pas avoir su faire.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readDuration, readRecipeText } from './recipe-text';
import { buildArticleIndex } from './ingredients';

const idx = buildArticleIndex([]);
const lire = (t: string) => readRecipeText(t, idx);

const AVEC_TITRES = `Gratin de courgettes

Pour 4 personnes
Préparation : 15 min
Cuisson : 40 min

Ingrédients
- 4 courgettes
- 200 g de crème fraîche
- 100 g de gruyère râpé
- sel, poivre

Préparation
1. Préchauffer le four à 180 °C.
2. Couper les courgettes en rondelles et les faire revenir dix minutes.
3. Mélanger avec la crème, verser dans un plat et couvrir de gruyère.
4. Enfourner quarante minutes.`;

test('une recette avec intertitres est lue sans deviner', () => {
  const r = lire(AVEC_TITRES);
  assert.equal(r.name, 'Gratin de courgettes');
  assert.equal(r.portions, 4);
  assert.equal(r.prepMin, 15);
  assert.equal(r.cookMin, 40);
  assert.deepEqual(r.ingr, ['4 courgettes', '200 g de crème fraîche', '100 g de gruyère râpé', 'sel, poivre']);
  assert.equal(r.steps.length, 4);
  assert.equal(r.steps[0], 'Préchauffer le four à 180 °C.');
  assert.deepEqual(r.warnings, [], 'rien à signaler sur un texte bien formé');
});

test('les puces et les numéros ne font pas partie du texte', () => {
  const r = lire(AVEC_TITRES);
  assert.equal(r.ingr.every((l) => !/^[-–—*•]/.test(l)), true);
  assert.equal(r.steps.every((l) => !/^\d+[.)]/.test(l)), true);
});

test('les métadonnées ne deviennent ni un ingrédient ni une étape', () => {
  const r = lire(AVEC_TITRES);
  const tout = [...r.ingr, ...r.steps].join(' ');
  assert.equal(/Pour 4 personnes|Préparation : 15/.test(tout), false);
});

test('sans intertitre, le partage est deviné et le lecteur le dit', () => {
  // C'est la lecture qui se trompe le plus : elle doit s'annoncer comme telle.
  const r = lire(`Omelette au fromage
2 œufs
50 g de gruyère
Battre les œufs dans un bol avec une pincée de sel, puis verser dans la poêle chaude.`);
  assert.equal(r.name, 'Omelette au fromage');
  assert.deepEqual(r.ingr, ['2 œufs', '50 g de gruyère']);
  assert.equal(r.steps.length, 1);
  assert.ok(r.warnings.some((w) => w.includes('deviné')));
});

test('une phrase longue est une étape, même sans intertitre', () => {
  const r = lire(`Soupe
3 carottes
Éplucher les carottes, les couper en morceaux et les faire cuire vingt minutes dans l'eau bouillante salée.`);
  assert.equal(r.ingr.length, 1);
  assert.equal(r.steps.length, 1);
});

test('une étape numérotée n’est pas prise pour un ingrédient', () => {
  // « 1. Faire bouillir » commence par un chiffre, comme « 1 oignon ».
  const r = lire(`Pâtes
200 g de pâtes
1. Faire bouillir l'eau.
2. Cuire huit minutes.`);
  assert.deepEqual(r.ingr, ['200 g de pâtes']);
  assert.deepEqual(r.steps, ["Faire bouillir l'eau.", 'Cuire huit minutes.']);
});

test('un texte vide est refusé avec une phrase, pas avec une recette vide', () => {
  const r = lire('   \n  \n');
  assert.ok(r.warnings.some((w) => w.includes('vide')));
  assert.deepEqual(r.ingr, []);
  assert.deepEqual(r.steps, []);
});

test('ce qui manque est nommé, une chose à la fois', () => {
  const r = lire(`Ingrédients
2 carottes`);
  assert.equal(r.ingr.length, 1);
  assert.ok(r.warnings.some((w) => w.includes('étape')));
  assert.ok(r.warnings.some((w) => w.includes('titre')));
});

test('les durées se lisent comme les sites les écrivent', () => {
  assert.equal(readDuration('15 min'), 15);
  assert.equal(readDuration('1 h 30'), 90);
  assert.equal(readDuration('1h30'), 90);
  assert.equal(readDuration('2 heures'), 120);
  assert.equal(readDuration('45'), 45);
  assert.equal(readDuration('à votre guise'), null);
  assert.equal(readDuration(''), null);
});

test('« Pour la pâte » est un intertitre d’ingrédients, pas un ingrédient', () => {
  const r = lire(`Tarte
Pour la pâte
250 g de farine
100 g de beurre
Préparation
Mélanger la farine et le beurre du bout des doigts jusqu'à obtenir un sable grossier.`);
  assert.deepEqual(r.ingr, ['250 g de farine', '100 g de beurre']);
  assert.equal(r.steps.length, 1);
  assert.equal(r.name, 'Tarte');
});

test('la ligne d’origine n’est jamais altérée', () => {
  // Ce qui est collé se retrouve tel quel dans le formulaire, à la puce près.
  const r = lire(AVEC_TITRES);
  assert.ok(r.ingr.includes('200 g de crème fraîche'));
});
