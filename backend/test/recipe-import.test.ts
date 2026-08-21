// Le lecteur schema.org/Recipe, testé sur une vraie page (le JSON-LD réel de
// Marmiton, dans test/fixtures/recipes) et sur les formes que le standard
// autorise et que les autres sites servent effectivement.
//
// Aucun appel réseau ici, et c'est délibéré : la CI doit rester muette vers
// l'extérieur, et un test qui dépend d'un site tiers échoue le jour où celui-ci
// est en maintenance, pour une raison qui n'a rien à voir avec le code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ImportError, cleanTitle, findRecipeNode, fromRecipeNode, parseImage,
  parseIngredients, parseInstructions, parseIsoDuration, parseRecipePage, parseYield,
} from '../src/recipes/schema-org';

const FIXTURES = path.join(__dirname, 'fixtures', 'recipes');
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

/** Enrobe un nœud JSON-LD dans une page, comme le sert un vrai site. */
const page = (...blocks: unknown[]): string =>
  '<!DOCTYPE html><html><head><title>x</title>'
  + blocks.map((b) => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`).join('')
  + '</head><body><h1>Recette</h1></body></html>';

const MARMITON_URL = 'https://www.marmiton.org/recettes/recette_gratin-de-courgettes-rapide_17071.aspx';

// ---- la vraie page ---------------------------------------------------------

describe('une recette Marmiton réelle', () => {
  const node = fixture('marmiton-gratin-courgettes.json');

  it('lit le titre, les portions et les deux temps', () => {
    const { recipe } = fromRecipeNode(node, MARMITON_URL);
    // Le titre est débarrassé de l'appât à moteur de recherche.
    assert.equal(recipe.name, 'Gratin de courgettes rapide');
    assert.equal(recipe.portions, 4);
    assert.equal(recipe.prepMin, 15);
    assert.equal(recipe.cookMin, 15);
    assert.equal(recipe.source, MARMITON_URL);
  });

  it('reprend les huit lignes d’ingrédients telles qu’écrites', () => {
    const { recipe } = fromRecipeNode(node, MARMITON_URL);
    assert.deepEqual(recipe.ingr, [
      '4 courgettes',
      '3 oignons',
      '100 g de gruyère râpé',
      '2 oeufs',
      '2 cuillères à soupe de crème fraîche',
      '1 noix de beurre',
      'sel',
      'poivre',
    ]);
  });

  it('reprend les sept étapes dans l’ordre', () => {
    const { recipe } = fromRecipeNode(node, MARMITON_URL);
    assert.equal(recipe.steps.length, 7);
    assert.equal(recipe.steps[0], 'Emincer les oignons.');
    assert.equal(recipe.steps[6], 'Mettre les courgettes dans un plat et verser par dessus la sauce et faire à four chaud pendant 15 min.');
  });

  it('choisit une image en JPEG plutôt qu’en WebP', () => {
    const { recipe } = fromRecipeNode(node, MARMITON_URL);
    assert.ok(recipe.imageUrl?.endsWith('.jpg'), 'le WebP passe mal dans certains clients');
  });

  it('n’importe ni les calories, ni la note du site, ni les régimes', () => {
    // Le foyer ne fait pas de suivi nutritionnel, et 4,9/5 sur Marmiton n'est
    // pas la note de la famille. Ce qu'on ne sait pas utiliser, on ne le range pas.
    const { recipe } = fromRecipeNode(node, MARMITON_URL);
    const keys = Object.keys(recipe);
    for (const absent of ['nutrition', 'calories', 'rating', 'aggregateRating', 'suitableForDiet', 'keywords']) {
      assert.equal(keys.includes(absent), false, absent + ' ne doit pas être importé');
    }
  });

  it('ne signale rien sur une page complète', () => {
    assert.deepEqual(fromRecipeNode(node, MARMITON_URL).warnings, []);
  });

  it('se laisse retrouver au milieu des autres blocs de la page', () => {
    const html = page(
      { '@type': 'BreadcrumbList', itemListElement: [] },
      { '@type': 'Organization', name: 'Marmiton' },
      node,
      { '@type': 'VideoObject', name: 'vidéo' },
    );
    const { recipe } = parseRecipePage(html, MARMITON_URL);
    assert.equal(recipe.name, 'Gratin de courgettes rapide');
  });
});

// ---- retrouver le nœud dans une page ---------------------------------------

describe('extraction du bloc JSON-LD', () => {
  it('accepte un @graph, un tableau ou un mainEntity', () => {
    const r = { '@type': 'Recipe', name: 'Tarte', recipeIngredient: ['1 pomme'] };
    for (const shape of [
      { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, r] },
      [{ '@type': 'WebSite' }, r],
      { '@type': 'WebPage', mainEntity: r },
    ]) {
      assert.equal(findRecipeNode(page(shape))?.['name'], 'Tarte', JSON.stringify(shape).slice(0, 40));
    }
  });

  it('accepte le type en tableau ou en URL complète', () => {
    assert.ok(findRecipeNode(page({ '@type': ['Recipe', 'NewsArticle'], name: 'A' })));
    assert.ok(findRecipeNode(page({ '@type': 'https://schema.org/Recipe', name: 'B' })));
  });

  it('un bloc illisible n’empêche pas de lire les suivants', () => {
    // Cas vécu sur des pages réelles : un bloc tronqué par un greffon, et la
    // recette juste après. S'arrêter au premier échec perdrait la recette.
    const html = page('{ ceci n\'est pas du JSON', { '@type': 'Recipe', name: 'Sauvée' });
    assert.equal(findRecipeNode(html)?.['name'], 'Sauvée');
  });

  it('supporte les attributs et la casse du vrai HTML', () => {
    const html = `<SCRIPT TYPE='application/ld+json' data-x="1">${JSON.stringify({ '@type': 'Recipe', name: 'Casse' })}</script >`;
    assert.equal(findRecipeNode(html)?.['name'], 'Casse');
  });

  it('rend null quand la page ne publie aucune recette', () => {
    assert.equal(findRecipeNode(page({ '@type': 'Article', name: 'Pas une recette' })), null);
    assert.equal(findRecipeNode('<html><body>rien du tout</body></html>'), null);
  });

  it('le message d’erreur dit quoi faire, pas juste que ça a échoué', () => {
    assert.throws(
      () => parseRecipePage('<html></html>', 'https://exemple.test/x'),
      (e: Error) => e instanceof ImportError && /page d’une recette/.test(e.message),
    );
  });
});

// ---- durées ----------------------------------------------------------------

describe('durées ISO 8601', () => {
  it('lit les formes courantes', () => {
    assert.equal(parseIsoDuration('PT15M'), 15);
    assert.equal(parseIsoDuration('PT1H30M'), 90);
    assert.equal(parseIsoDuration('PT2H'), 120);
    assert.equal(parseIsoDuration('P1DT2H'), 1560, 'une marinade de 24 h existe');
    assert.equal(parseIsoDuration('PT90S'), 2);
  });

  it('rend null plutôt qu’un zéro trompeur', () => {
    for (const v of ['PT0S', '', '15 min', 'PT', null, undefined, 42, 'P']) {
      assert.equal(parseIsoDuration(v), null, String(v));
    }
  });
});

// ---- portions --------------------------------------------------------------

describe('nombre de portions', () => {
  it('lit le nombre au milieu du texte libre', () => {
    assert.equal(parseYield('4 personnes'), 4);
    assert.equal(parseYield('6'), 6);
    assert.equal(parseYield('pour 8 parts'), 8);
    assert.equal(parseYield(['4 personnes', '4']), 4);
    assert.equal(parseYield(4), null, 'un nombre pur n’est pas du texte : schema.org le donne en chaîne');
  });

  it('refuse de deviner quand il n’y a pas de nombre de couverts', () => {
    // Une portion inventée fausserait toute la mise à l'échelle des courses.
    for (const v of ['', 'plusieurs', null, '1000 g de pâte', '0 personne']) {
      assert.equal(parseYield(v), null, String(v));
    }
  });
});

// ---- titres ----------------------------------------------------------------

describe('nettoyage du titre', () => {
  it('retire les appâts à moteur de recherche', () => {
    assert.equal(cleanTitle('Gratin de courgettes rapide : la meilleure recette'), 'Gratin de courgettes rapide');
    assert.equal(cleanTitle('Blanquette de veau - recette facile'), 'Blanquette de veau');
    assert.equal(cleanTitle('Crêpes : la vraie recette'), 'Crêpes');
  });

  it('laisse intact ce qui n’est pas un appât', () => {
    assert.equal(cleanTitle('Poulet basquaise'), 'Poulet basquaise');
    assert.equal(cleanTitle('Tarte tatin : la recette de ma grand-mère'), 'Tarte tatin : la recette de ma grand-mère');
  });

  it('ne vide jamais un titre à force de le nettoyer', () => {
    assert.equal(cleanTitle('La meilleure recette'), 'La meilleure recette');
  });
});

// ---- ingrédients et étapes -------------------------------------------------

describe('ingrédients', () => {
  it('nettoie les espaces et retire les doublons exacts', () => {
    assert.deepEqual(
      parseIngredients(['  2   oeufs ', '2 oeufs', '', '   ', '100 g\nde farine']),
      ['2 oeufs', '100 g de farine'],
    );
  });

  it('accepte une liste d’objets balisés', () => {
    assert.deepEqual(parseIngredients([{ name: '3 pommes' }, { name: '' }]), ['3 pommes']);
  });
});

describe('étapes', () => {
  it('lit un tableau de HowToStep', () => {
    assert.deepEqual(
      parseInstructions([{ '@type': 'HowToStep', text: 'Un.' }, { '@type': 'HowToStep', text: 'Deux.' }]),
      ['Un.', 'Deux.'],
    );
  });

  it('lit un tableau de chaînes et une chaîne unique', () => {
    assert.deepEqual(parseInstructions(['Un.', 'Deux.']), ['Un.', 'Deux.']);
    assert.deepEqual(parseInstructions('Un.\n\nDeux.\nTrois.'), ['Un.', 'Deux.', 'Trois.']);
  });

  it('déplie les sections en gardant leur intertitre', () => {
    // Une pâtisserie sépare « Pour la pâte » et « Pour la garniture » : perdre
    // ces intertitres rendrait la suite d'étapes incompréhensible.
    const out = parseInstructions([
      { '@type': 'HowToSection', name: 'Pour la pâte', itemListElement: [{ '@type': 'HowToStep', text: 'Mélanger.' }] },
      { '@type': 'HowToSection', name: 'Pour la garniture', itemListElement: [{ '@type': 'HowToStep', text: 'Couper.' }] },
    ]);
    assert.deepEqual(out, ['Pour la pâte', 'Mélanger.', 'Pour la garniture', 'Couper.']);
  });

  it('se rabat sur name ou description quand text manque', () => {
    assert.deepEqual(parseInstructions([{ name: 'Par le nom.' }, { description: 'Par la description.' }]),
      ['Par le nom.', 'Par la description.']);
  });

  it('ignore le vide sans produire d’étape fantôme', () => {
    assert.deepEqual(parseInstructions([{ text: '' }, '   ', null, undefined]), []);
  });
});

// ---- images ----------------------------------------------------------------

describe('image', () => {
  it('préfère un JPEG ou un PNG au WebP', () => {
    assert.equal(parseImage(['https://x.test/a.webp', 'https://x.test/b.jpg']), 'https://x.test/b.jpg');
    assert.equal(parseImage('https://x.test/c.png'), 'https://x.test/c.png');
  });

  it('accepte un ImageObject et retombe sur la première venue', () => {
    assert.equal(parseImage({ '@type': 'ImageObject', url: 'https://x.test/d.avif' }), 'https://x.test/d.avif');
  });

  it('refuse ce qui n’est pas une URL absolue', () => {
    assert.equal(parseImage(['/relatif.jpg', 'javascript:alert(1)']), null);
    assert.equal(parseImage(null), null);
  });
});

// ---- pages incomplètes : signaler, jamais inventer --------------------------

describe('pages incomplètes', () => {
  it('signale les portions absentes sans en inventer', () => {
    const { recipe, warnings } = fromRecipeNode(
      { '@type': 'Recipe', name: 'Sans portions', recipeIngredient: ['1 pomme'], recipeInstructions: ['Cuire.'] },
      'https://x.test/r',
    );
    assert.equal(recipe.portions, null);
    assert.ok(warnings.some((w) => /portions/.test(w)));
  });

  it('reprend le temps total en préparation, et le dit', () => {
    const { recipe, warnings } = fromRecipeNode(
      { '@type': 'Recipe', name: 'X', totalTime: 'PT45M', recipeIngredient: ['a'], recipeInstructions: ['b'] },
      'https://x.test/r',
    );
    assert.equal(recipe.prepMin, 45);
    assert.equal(recipe.cookMin, null);
    assert.ok(warnings.some((w) => /temps total/.test(w)));
  });

  it('signale une recette sans ingrédient ni étape plutôt que d’échouer', () => {
    // La fiche reste créable : le titre et la source sont déjà du travail gagné.
    const { recipe, warnings } = fromRecipeNode({ '@type': 'Recipe', name: 'Vide' }, 'https://x.test/r');
    assert.equal(recipe.name, 'Vide');
    assert.deepEqual(recipe.ingr, []);
    assert.equal(warnings.length, 3, 'ingrédients, étapes et portions');
  });

  it('refuse une recette sans titre : il n’y a rien à préremplir', () => {
    assert.throws(() => fromRecipeNode({ '@type': 'Recipe', recipeIngredient: ['a'] }, 'https://x.test/r'), ImportError);
  });
});
