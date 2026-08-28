// Un export se juge à une seule chose : est-ce qu'il revient ? D'où le premier
// bloc, qui fait l'aller-retour complet et compare, plutôt que de vérifier des
// champs un par un.
//
// Le reste porte sur ce qui casse en silence : un guillemet dans un nom
// d'article, un fichier d'import trafiqué, un accent dans un nom de fichier.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  BUNDLE_FORMAT, ImportError, buildBundle, csvCell, fileName, parseBundle, planImport, recipeToText, shopToCsv,
} from './exports';
import { Aisle, Recipe, ShopItem } from './models';

const recette = (o: Partial<Recipe> = {}): Recipe => ({
  id: 'r1', name: 'Croque-monsieur', level: 'Facile', color: '#7A9B76',
  portions: 4, prepMin: 10, cookMin: 15,
  ingr: ['8 tranches de pain de mie', '4 tranches de jambon'],
  steps: ['Beurrer le pain.', 'Enfourner 15 min.'],
  ...o,
});

// ---- aller-retour ----------------------------------------------------------

test('un carnet exporté puis réimporté revient à l’identique', () => {
  const carnet = [
    recette(),
    recette({ id: 'r2', name: 'Tarte aux figues', portions: 6, source: 'https://exemple.test/tarte', cookMin: null }),
  ];
  const bundle = buildBundle(carnet, {});
  const relu = parseBundle(JSON.stringify(bundle));
  const rep = planImport(relu, []);

  assert.equal(rep.nouvelles.length, 2);
  assert.deepEqual(rep.nouvelles.map((r) => r.name), ['Croque-monsieur', 'Tarte aux figues']);
  assert.deepEqual(rep.nouvelles[0].ingr, carnet[0].ingr);
  assert.deepEqual(rep.nouvelles[0].steps, carnet[0].steps);
  assert.equal(rep.nouvelles[1].source, 'https://exemple.test/tarte');
  assert.equal(rep.nouvelles[1].portions, 6);
});

test('réimporter deux fois la même sauvegarde ne duplique rien', () => {
  // Sinon la sauvegarde devient un piège : on la relit par précaution, et on se
  // retrouve avec un carnet en double.
  const carnet = [recette(), recette({ id: 'r2', name: 'Risotto' })];
  const bundle = buildBundle(carnet, {});
  const rep = planImport(bundle, carnet);
  assert.deepEqual(rep.nouvelles, []);
  assert.deepEqual(rep.deja, ['Croque-monsieur', 'Risotto']);
});

test('les photos voyagent avec leurs recettes', () => {
  const carnet = [recette({ photoId: 7 }), recette({ id: 'r2', name: 'Sans photo' })];
  const bundle = buildBundle(carnet, { 7: { name: 'croque.jpg', type: 'image/jpeg', data: 'AAAA' } });
  assert.equal(bundle.recipes[0].photo?.data, 'AAAA');
  assert.equal(bundle.recipes[1].photo, undefined);
  assert.equal(planImport(bundle, []).photos, 1);
});

// ---- fichiers hostiles -----------------------------------------------------

test('un fichier illisible est refusé en disant quoi faire', () => {
  assert.throws(() => parseBundle('ceci n’est pas du json'), (e: Error) => e instanceof ImportError && /Exporter le carnet/.test(e.message));
});

test('l’export complet du foyer est refusé, et l’erreur le dit', () => {
  // C'est la confusion probable : deux boutons « exporter » dans l'application.
  const etat = JSON.stringify({ familyName: 'Prudhomme', recipes: [recette()], members: [] });
  assert.throws(() => parseBundle(etat), (e: Error) => /export complet du foyer/.test(e.message));
});

test('un fichier d’une version future est refusé plutôt que mal lu', () => {
  const futur = JSON.stringify({ format: BUNDLE_FORMAT, version: 99, exportedAt: '', recipes: [] });
  assert.throws(() => parseBundle(futur), (e: Error) => /version plus récente/.test(e.message));
});

test('une entrée abîmée est écartée, le reste du fichier passe quand même', () => {
  // Un import tout ou rien perdrait dix-sept recettes pour une ligne fautive.
  const bundle = {
    format: BUNDLE_FORMAT as const, version: 1 as const, exportedAt: '', recipes: [
      { id: 'r1', name: 'Bonne', ingr: ['sel'], steps: [], level: 'Facile', color: '#7A9B76' },
      { id: 'r2', name: '', ingr: ['sel'], steps: [], level: 'Facile', color: '#7A9B76' },
      { id: '', name: 'Sans identifiant', ingr: ['sel'], steps: [], level: 'Facile', color: '#7A9B76' },
      { id: 'r3', name: 'Vide', ingr: [], steps: [], level: 'Facile', color: '#7A9B76' },
      { id: 'r1', name: 'Doublon', ingr: ['sel'], steps: [], level: 'Facile', color: '#7A9B76' },
    ],
  };
  const rep = planImport(bundle, []);
  assert.deepEqual(rep.nouvelles.map((r) => r.name), ['Bonne']);
  assert.deepEqual(rep.ignorees.map((i) => i.raison), [
    'aucun nom', 'aucun identifiant', 'ni ingrédient ni étape', 'identifiant en double dans le fichier',
  ]);
});

test('les valeurs aberrantes sont remplacées, pas recopiées', () => {
  const bundle = {
    format: BUNDLE_FORMAT as const, version: 1 as const, exportedAt: '', recipes: [
      { id: 'r1', name: 'Bizarre', ingr: ['sel'], steps: [], level: '', color: 'rouge', portions: -3, prepMin: 'douze' },
    ],
  } as never;
  const r = planImport(bundle, []).nouvelles[0];
  assert.equal(r.color, '#7A9B76', 'une couleur invalide ne doit pas atterrir dans le style');
  assert.equal(r.level, 'Facile');
  assert.equal(r.portions, undefined, 'un nombre de portions négatif fausserait la mise à l’échelle');
  assert.equal(r.prepMin, undefined);
});

// ---- recette en texte ------------------------------------------------------

test('une recette se lit telle quelle dans un message', () => {
  assert.equal(recipeToText(recette({ source: 'https://exemple.test/c' })), [
    'Croque-monsieur',
    '4 personnes · préparation 10 min · cuisson 15 min',
    '',
    'Ingrédients',
    '- 8 tranches de pain de mie',
    '- 4 tranches de jambon',
    '',
    'Préparation',
    '1. Beurrer le pain.',
    '2. Enfourner 15 min.',
    '',
    'Source : https://exemple.test/c',
  ].join('\n'));
});

test('une recette dépouillée ne produit ni ligne vide ni intitulé orphelin', () => {
  const t = recipeToText({ id: 'r', name: 'Restes', level: 'Facile', color: '#000', ingr: [], steps: [] });
  assert.equal(t, 'Restes');
});

test('le singulier est respecté', () => {
  assert.match(recipeToText(recette({ portions: 1, prepMin: null, cookMin: null })), /1 personne\n/);
});

// ---- liste en tableur ------------------------------------------------------

const RAYONS: Aisle[] = [
  { id: 'a1', name: 'Fruits & légumes', color: '', position: 0 },
  { id: 'a2', name: 'Épicerie', color: '', position: 1 },
];
const article = (o: Partial<ShopItem>): ShopItem =>
  ({ id: 'i', name: 'x', qty: '', aisleId: 'a1', state: 'a-prendre', listId: 'cl1', ...o });

test('la liste sort dans l’ordre des allées, puis par nom', () => {
  const csv = shopToCsv([
    article({ id: '1', name: 'Farine', aisleId: 'a2', qty: '450 g' }),
    article({ id: '2', name: 'Tomate', aisleId: 'a1', qty: '5' }),
    article({ id: '3', name: 'Carotte', aisleId: 'a1', qty: '2' }),
  ], RAYONS);
  assert.deepEqual(csv.split('\r\n'), [
    'Rayon;Article;Quantité;État',
    'Fruits & légumes;Carotte;2;À prendre',
    'Fruits & légumes;Tomate;5;À prendre',
    'Épicerie;Farine;450 g;À prendre',
  ]);
});

test('un article d’un rayon supprimé n’est pas perdu', () => {
  const csv = shopToCsv([article({ name: 'Orphelin', aisleId: 'a9' })], RAYONS);
  assert.match(csv, /À trier;Orphelin/);
});

test('les guillemets et points-virgules ne cassent pas le tableau', () => {
  // « lardons "fumés"; environ 200 g » décalerait toutes les colonnes.
  assert.equal(csvCell('lardons "fumés"; 200 g'), '"lardons ""fumés""; 200 g"');
  assert.equal(csvCell('simple'), 'simple');
  assert.equal(csvCell('deux\nlignes'), '"deux\nlignes"');
  const csv = shopToCsv([article({ name: 'Pain; de mie', qty: '8 "tranches"' })], RAYONS);
  assert.equal(csv.split('\r\n')[1], 'Fruits & légumes;"Pain; de mie";"8 ""tranches""";À prendre');
});

test('les trois états sont écrits en français', () => {
  const csv = shopToCsv([
    article({ id: '1', name: 'A', state: 'a-prendre' }),
    article({ id: '2', name: 'B', state: 'panier' }),
    article({ id: '3', name: 'C', state: 'indisponible' }),
  ], RAYONS);
  assert.match(csv, /A;;À prendre/);
  assert.match(csv, /B;;Pris/);
  assert.match(csv, /C;;Introuvable/);
});

// ---- noms de fichiers ------------------------------------------------------

test('le nom de fichier passe partout et se trie par date', () => {
  const jour = new Date('2026-08-21T15:00:00Z');
  assert.equal(fileName('Carnet de recettes', 'json', jour), 'carnet-de-recettes-2026-08-21.json');
  assert.equal(fileName('Crème brûlée à l’ancienne', 'txt', jour), 'creme-brulee-a-l-ancienne-2026-08-21.txt');
  assert.equal(fileName('', 'csv', jour), 'foyer-2026-08-21.csv');
  assert.equal(fileName('!!!', 'csv', jour), 'foyer-2026-08-21.csv');
});
