// Un rattachement faux ne se voit pas : il se propage à tout le carnet, puis à
// toutes les listes de courses suivantes. D'où l'insistance ici sur ce que le
// moteur refuse de deviner, et sur ce qu'il ne doit jamais écraser.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { articleKey, createArticle, linkForm, scanRecipes, searchArticles } from './ingredient-repair';
import { buildArticleIndex } from './ingredients';
import { Article, Recipe } from './models';

const recette = (id: string, name: string, ingr: string[]): Recipe =>
  ({ id, name, level: 'Facile', color: '#E56B4E', ingr, steps: [] });

const idxDe = (articles: Article[] = []) => buildArticleIndex(articles);

// ---- relevé ----------------------------------------------------------------

test('les formes non reconnues sont groupées, comptées et classées', () => {
  const idx = idxDe();
  const rep = scanRecipes([
    recette('r1', 'Ramen', ['150 g de nouilles soba', '2 carottes']),
    recette('r2', 'Salade', ['100 g de Nouilles soba', '2 c. à s. de gomasio']),
  ], idx);

  assert.equal(rep.groups.length, 2);
  // « nouilles soba » et « Nouilles soba » sont la même chose : deux gestes seraient un de trop.
  assert.equal(rep.groups[0].form, 'nouilles soba');
  assert.equal(rep.groups[0].count, 2);
  assert.deepEqual(rep.groups[0].uses.map((u) => u.recipeName), ['Ramen', 'Salade']);
  // Le plus fréquent en tête : c'est ce qui rapporte le plus par geste.
  assert.equal(rep.groups[1].count, 1);
});

test('le nom affiché est celui que le lecteur a isolé, pas la forme normalisée', () => {
  const rep = scanRecipes([recette('r1', 'Ramen', ['150 g de Nouilles Soba'])], idxDe());
  assert.equal(rep.groups[0].name, 'Nouilles Soba');
  assert.equal(rep.groups[0].form, 'nouilles soba');
});

test('le taux compte les produits, pas les lignes', () => {
  // « thym + laurier » est une ligne mais deux produits : compter les lignes
  // ferait mentir le taux dès qu'une ligne en porte deux.
  const rep = scanRecipes([recette('r1', 'Soupe', ['thym + laurier', '2 carottes'])], idxDe());
  assert.equal(rep.total, 3);
  assert.equal(rep.matched + rep.groups.reduce((n, g) => n + g.count, 0) + rep.unreadable.length, rep.total);
});

test('une ligne dont rien ne se dégage part à part, avec son texte', () => {
  const rep = scanRecipes([recette('r1', 'Gratin', ['3', '2 carottes'])], idxDe());
  assert.equal(rep.groups.length, 0);
  assert.equal(rep.unreadable.length, 1);
  assert.equal(rep.unreadable[0].raw, '3');
  assert.equal(rep.unreadable[0].recipeId, 'r1', 'il faut pouvoir rouvrir la recette fautive');
});

test('un intertitre remonte comme une forme à reprendre, avec sa recette', () => {
  // Le lecteur en isole un produit (« sauce : ») faute de mieux. Ce n'est pas un
  // article, et l'écran n'invente pas de geste pour cela : il nomme la recette
  // où la ligne se trouve, seul endroit où elle se corrige.
  const rep = scanRecipes([recette('r1', 'Gratin', ['pour la sauce :'])], idxDe());
  assert.equal(rep.groups.length, 1);
  assert.equal(rep.groups[0].uses[0].recipeId, 'r1');
});

test('un carnet vide est rattaché à 100 %, pas à 0', () => {
  const rep = scanRecipes([], idxDe());
  assert.equal(rep.rate, 100);
  assert.equal(rep.total, 0);
});

// ---- rattachement ----------------------------------------------------------

test('rattacher à un article de la base en fabrique une copie côté foyer', () => {
  const idx = idxDe();
  const cle = idx.forms.get('farine')!;
  const out = linkForm([], cle, 'Nouilles soba', idx);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, cle);
  assert.deepEqual(out[0].syn, ['Nouilles soba']);
  // Le rayon et les allergènes de la base sont repris : les perdre rangerait
  // l'article ailleurs dans le magasin sans que personne l'ait demandé.
  assert.equal(out[0].rayon, idx.byKey.get(cle)!.rayon);

  // Et la forme est reconnue au tour suivant.
  assert.equal(buildArticleIndex(out).forms.get('nouilles soba'), cle);
});

test('rattacher deux fois la même forme ne la duplique pas', () => {
  const idx = idxDe();
  const cle = idx.forms.get('farine')!;
  const un = linkForm([], cle, 'Nouilles soba', idx);
  const deux = linkForm(un, cle, 'nouilles soba', buildArticleIndex(un));
  assert.equal(deux, un, 'le tableau doit être rendu tel quel');
});

test('rattacher une forme à un article du foyer complète le même article', () => {
  const idx0 = idxDe();
  const cle = idx0.forms.get('farine')!;
  const un = linkForm([], cle, 'Nouilles soba', idx0);
  const deux = linkForm(un, cle, 'Farine de blé', buildArticleIndex(un));
  assert.equal(deux.length, 1, 'un seul article, pas deux');
  assert.deepEqual(deux[0].syn, ['Nouilles soba', 'Farine de blé']);
});

test('une clé inconnue ne fabrique rien', () => {
  // Mieux vaut ne rien faire que créer un article vide que personne n'a demandé.
  assert.deepEqual(linkForm([], 'nawak', 'Truc', idxDe()), []);
});

test('l’état d’origine n’est jamais modifié', () => {
  const idx = idxDe();
  const avant: Article[] = [];
  linkForm(avant, idx.forms.get('farine')!, 'Nouilles soba', idx);
  assert.deepEqual(avant, []);
});

// ---- création --------------------------------------------------------------

test('créer un article retient aussi la forme qui l’a fait découvrir', () => {
  const idx = idxDe();
  const out = createArticle([], { name: 'Farine T55', rayon: 'epicerie', pantry: true, allerg: ['gluten'] }, 'farine t55', idx);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'farine-t55');
  assert.equal(out[0].pantry, true);
  assert.deepEqual(out[0].allerg, ['gluten']);
  // Le synonyme n'est gardé que s'il apporte quelque chose.
  assert.deepEqual(out[0].syn, []);
  assert.equal(buildArticleIndex(out).forms.get('farine t55'), 'farine-t55');
});

test('le synonyme est gardé quand il diffère vraiment du nom choisi', () => {
  const out = createArticle([], { name: 'Farine de blé', rayon: 'epicerie', pantry: false, allerg: [] }, 'farine T55', idxDe());
  assert.deepEqual(out[0].syn, ['farine T55']);
  const idx = buildArticleIndex(out);
  assert.equal(idx.forms.get('farine t55'), out[0].key);
  assert.equal(idx.forms.get('farine de ble'), out[0].key);
});

test('une clé déjà prise par la base n’est jamais réutilisée', () => {
  // La réutiliser écraserait l'article intégré, et le foyer perdrait tous les
  // synonymes que l'application connaissait.
  const idx = idxDe();
  const nom = idx.byKey.get(idx.forms.get('carotte')!)!.name;
  const out = createArticle([], { name: nom, rayon: 'legumes', pantry: false, allerg: [] }, '', idx);
  assert.notEqual(out[0].key, idx.forms.get('carotte'));
  assert.match(out[0].key, /-2$/);
});

test('les clés se suivent quand le même nom revient', () => {
  const pris = new Set(['tofu', 'tofu-2']);
  assert.equal(articleKey('Tofu', pris), 'tofu-3');
  assert.equal(articleKey('  ', pris), 'article');
});

test('un nom vide ne crée rien', () => {
  assert.deepEqual(createArticle([], { name: '   ', rayon: 'epicerie', pantry: false, allerg: [] }, 'x', idxDe()), []);
});

// ---- recherche -------------------------------------------------------------

test('la recherche trouve par le nom et par les synonymes du foyer', () => {
  const idx0 = idxDe();
  const maison = linkForm([], idx0.forms.get('farine')!, 'Nouilles soba', idx0);
  const idx = buildArticleIndex(maison);
  assert.ok(searchArticles(idx, maison, 'nouilles soba').some((a) => a.key === idx0.forms.get('farine')));
  assert.ok(searchArticles(idx, maison, 'carot').some((a) => a.name.toLowerCase().includes('carotte')));
});

test('la recherche à vide propose quand même de quoi choisir', () => {
  const idx = idxDe();
  assert.equal(searchArticles(idx, [], '', 5).length, 5);
});

// ---- mesure sur le carnet réel ---------------------------------------------

const etat = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'cuisine-reelle.json'), 'utf8',
)) as { recipes: Recipe[] };

test('le carnet réel se répare en un nombre de gestes fini', () => {
  const rep = scanRecipes(etat.recipes, idxDe());
  // Le lecteur a été mesuré sur ce corpus : ce qui reste doit tenir dans un écran.
  assert.ok(rep.rate >= 99, 'taux de rattachement tombé à ' + rep.rate + ' %');
  assert.ok(rep.groups.length <= 5, rep.groups.length + ' formes à reprendre, c’est beaucoup');
  assert.equal(rep.total, 166, 'le corpus a changé de taille');
});

test('réparer toutes les formes du carnet réel amène le taux à 100 %', () => {
  // Le geste doit refermer ce qu'il annonce, sinon l'écran ment sur son effet.
  let articles: Article[] = [];
  for (let tour = 0; tour < 10; tour++) {
    const idx = buildArticleIndex(articles);
    const rep = scanRecipes(etat.recipes, idx);
    if (!rep.groups.length) break;
    const g = rep.groups[0];
    articles = createArticle(articles, { name: g.name, rayon: 'epicerie', pantry: false, allerg: [] }, g.form, idx);
  }
  const fin = scanRecipes(etat.recipes, buildArticleIndex(articles));
  assert.equal(fin.groups.length, 0);
  assert.equal(fin.rate, 100);
});
