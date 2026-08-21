// L'analyse d'une ligne d'ingrédient se trompe en silence : elle ne plante pas,
// elle fait acheter trois kilos de farine. D'où deux familles de tests.
//
// La première tient les cas de forme, un par piège rencontré. La seconde mesure
// l'analyse sur le carnet réel du foyer (fixtures/cuisine-reelle.json,
// 18 recettes importées de Marmiton) : c'est la seule mesure qui vaille, un
// corpus inventé mesurant surtout l'imagination de son auteur.
//
// Et surtout, la garantie qui prime sur le taux : **aucune ligne ne disparaît**.
// Ce qui n'est pas compris ressort avec son texte intact, prêt pour la reprise
// manuelle. Une ligne perdue, c'est un ingrédient oublié en magasin.
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { BASE_ARTICLES, BASE_INDEX } from './articles';
import { buildArticleIndex, parseIngredient } from './ingredients';

const idx = buildArticleIndex([]);
/** Analyse une ligne dont on attend un seul produit. */
const un = (raw: string) => {
  const out = parseIngredient(raw, idx);
  assert.equal(out.length, 1, 'un seul produit attendu pour : ' + raw);
  return out[0];
};
/** Les champs absents valent undefined : la comparaison partielle, elle, exige la clé. */
const forme = (raw: string): { qty?: number; unit?: string; art?: string } => {
  const p = un(raw);
  return { qty: p.qty, unit: p.unit, art: p.art };
};

test('la quantité et l’unité sont séparées du produit', () => {
  assert.deepEqual(
    (({ qty, unit, name, art }) => ({ qty, unit, name, art }))(un('100 g de couscous de blé dur')),
    { qty: 100, unit: 'g', name: 'couscous de blé dur', art: 'couscous' },
  );
  assert.deepEqual(forme('20 cl de lait de coco'), { qty: 20, unit: 'cl', art: 'lait-de-coco' });
  assert.deepEqual(forme('3 oeufs'), { qty: 3, unit: undefined, art: 'oeuf' });
});

test('les nombres s’écrivent de toutes les façons qu’un site emploie', () => {
  assert.equal(un('0.25 botte de persil plat').qty, 0.25);
  assert.equal(un('0,5 cuillère à café de cumin').qty, 0.5);
  assert.equal(un('1/2 citron').qty, 0.5);
  assert.equal(un('½ oignon').qty, 0.5);
  assert.equal(un('une pincée de sel').qty, 1);
  assert.equal(un('deux oeufs').qty, 2);
});

test('une fourchette retient le haut : mieux vaut qu’il en reste', () => {
  assert.equal(un('1 à 2 oignons').qty, 2);
  assert.equal(un('2-3 tomates').qty, 3);
  assert.equal(un('environ 4 pommes').qty, 4);
});

test('« un peu de » n’est pas une quantité', () => {
  const r = un('un peu de sel');
  assert.equal(r.qty, undefined);
  assert.equal(r.art, 'sel');
});

test('la cuillère à soupe se distingue de la cuillère à café', () => {
  assert.equal(un('3 cuillères à soupe de sucre').unit, 'cs');
  assert.equal(un('1 c. à c. de curry').unit, 'cc');
  assert.equal(un('2 càs de farine').unit, 'cs');
  // « cuillère » seule vaut la cuillère à soupe, faute de mieux.
  assert.equal(un("1 cuillère d'eau de fleur d'oranger").unit, 'cs');
});

test('l’élision colle le connecteur au mot, et ne l’emporte pas avec lui', () => {
  // Le défaut trouvé à la première mesure : « d'huile » était retiré en entier,
  // et la ligne devenait vide. Un ingrédient sur huit disparaissait ainsi.
  assert.deepEqual(forme("5 cl d'huile d'olive"), { qty: 5, unit: 'cl', art: "huile-d'olive" });
  assert.equal(un("5 cl d'huile d'olive").name, "huile d'olive");
  assert.equal(un("400 ml d'eau").art, 'eau');
  assert.equal(un("150 g d'emmental râpé").art, 'emmental');
});

test('les accents ne coupent pas les mots en deux', () => {
  // Les limites de mot des expressions régulières JavaScript ignorent « é » :
  // « hachée » y passait pour « haché » suivi de « e ».
  assert.equal(un('viande hachée').name, 'viande hachée');
  assert.equal(un('viande hachée').art, 'viande-hachee');
});

test('la parenthèse et le commentaire quittent le nom sans quitter la ligne', () => {
  const r = un('200 g de coulis de tomate (si possible maison)');
  assert.equal(r.name, 'coulis de tomate');
  assert.match(r.note!, /si possible maison/);
  assert.match(un('1 cuillère à café de curry suivant le goût').note!, /suivant le goût/);
  assert.equal(un('25 g de gruyère râpé ...').name, 'gruyère râpé');
});

test('« ou » introduit une variante, pas un second produit', () => {
  const r = un('3 filets de poulet ou dinde');
  assert.equal(r.art, 'poulet');
  assert.equal(r.qty, 3);
  assert.match(r.note!, /ou dinde/);
});

test('« + » sépare bien deux produits, chacun gardant la ligne d’origine', () => {
  const out = parseIngredient('herbes de Provence + sel', idx);
  assert.deepEqual(out.map((p) => p.art), ['herbes-de-provence', 'sel']);
  assert.deepEqual(out.map((p) => p.raw), ['herbes de Provence + sel', 'herbes de Provence + sel']);
});

test('le mot de découpe désigne la portion, pas le produit', () => {
  assert.equal(un('400 g de filets de poulet').art, 'poulet');
  assert.equal(un('2 blancs de poulet en dés').art, 'poulet');
  assert.equal(un('8 tranches de pains de mie').art, 'pain-de-mie');
  assert.equal(un("1 gousse d'ail").art, 'ail');
});

test('le nom se raccourcit par la droite, jamais au travers d’une préposition', () => {
  // Sans cette règle, « lait de coco » deviendrait « lait » : une recette sans
  // lait se retrouverait à en contenir, allergène compris.
  assert.equal(un('20 cl de lait de coco').art, 'lait-de-coco');
  assert.equal(un('60 g de beurre fondu').art, 'beurre');
  assert.equal(un('130 g de chocolat NESTLÉ DESSERT Noir').art, 'chocolat');
  assert.equal(un('1 pièce d’oignon rouge gros').art, 'oignon');
});

test('la préparation n’est retirée qu’en dernier recours', () => {
  // « crème fraîche » et « gingembre frais » sont des articles à part entière :
  // retirer « fraîche » d'abord les détruirait.
  assert.equal(un('20 cl de crème fraîche').art, 'creme-fraiche');
  assert.equal(un('10 g de gingembre frais').art, 'gingembre-frais');
  assert.equal(un('3 g de gingembre en poudre').art, 'gingembre-en-poudre');
  assert.equal(un("40 g d'amandes en poudre").art, "poudre-d'amandes");
});

test('le référentiel du foyer gagne toujours contre la base intégrée', () => {
  const perso = buildArticleIndex([
    { key: 'accro-emince', name: 'Émincé végétal ACCRO', syn: ['émincé 100% végétal ACCRO'], rayon: 'frais' },
  ]);
  assert.equal(parseIngredient('1 barquette d’émincé 100% végétal ACCRO', perso)[0].art, 'accro-emince');
  // Sans lui, la base répond quand même, mais moins précisément.
  assert.equal(un('1 barquette d’émincé 100% végétal ACCRO').art, 'tofu');
});

test('une ligne incomprise ressort entière, jamais jetée', () => {
  const r = un('parures de légumes (carottes, navet, courgettes)');
  assert.equal(r.status, 'inconnu');
  assert.equal(r.art, undefined);
  assert.equal(r.name, 'parures de légumes');
  assert.equal(r.raw, 'parures de légumes (carottes, navet, courgettes)');
});

test('une ligne vide ne produit rien plutôt qu’un article fantôme', () => {
  assert.deepEqual(parseIngredient('', idx), []);
  assert.deepEqual(parseIngredient('   ', idx), []);
});

test('le référentiel intégré n’a ni doublon ni rayon inventé', () => {
  const keys = BASE_ARTICLES.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length, 'clés en double dans la base');
  const rayons = new Set(['legumes', 'viande', 'frais', 'surgele', 'boulangerie', 'epicerie', 'boisson', 'entretien']);
  for (const a of BASE_ARTICLES) assert.ok(rayons.has(a.rayon), a.name + ' : rayon « ' + a.rayon + ' » inconnu');
  assert.ok(BASE_ARTICLES.length > 150, 'base trop maigre : ' + BASE_ARTICLES.length);
  assert.ok(BASE_INDEX.size > BASE_ARTICLES.length * 2, 'les pluriels ne sont pas indexés');
});

// ---- mesure sur le carnet réel ---------------------------------------------

const etat = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'cuisine-reelle.json'), 'utf8',
)) as { recipes: { name: string; ingr: string[] }[] };

const lignes = etat.recipes.flatMap((r) => r.ingr);

test('le corpus de mesure est bien celui du foyer, et pas un échantillon', () => {
  assert.equal(etat.recipes.length, 18);
  assert.equal(lignes.length, 165);
});

test('aucune ligne du carnet réel n’est perdue', () => {
  // La garantie qui prime sur toutes les autres : une ligne non comprise doit
  // rester visible, avec son texte, pour être reprise à la main.
  for (const l of lignes) {
    const out = parseIngredient(l, idx);
    assert.ok(out.length >= 1, 'ligne disparue : ' + l);
    for (const p of out) {
      assert.equal(p.raw, l.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim(), 'texte d’origine altéré : ' + l);
      assert.ok(['article', 'inconnu', 'illisible'].includes(p.status));
    }
  }
});

test('au moins 95 % des lignes du carnet réel sont rattachées à un article', () => {
  const reconnues = lignes.filter((l) => parseIngredient(l, idx).every((p) => p.status === 'article'));
  const taux = reconnues.length / lignes.length;
  const restantes = lignes.filter((l) => !parseIngredient(l, idx).every((p) => p.status === 'article'));
  assert.ok(taux >= 0.95, `taux de ${Math.round(taux * 100)} % ; non rattachées :\n  ` + restantes.join('\n  '));
});

test('les lignes qui restent sont celles qui ne s’achètent pas', () => {
  // « parures de légumes » désigne des épluchures : rien à mettre au caddie.
  // Ce test existe pour que cette liste soit relue, pas pour figer un chiffre.
  const restantes = lignes.filter((l) => !parseIngredient(l, idx).every((p) => p.status === 'article'));
  assert.deepEqual(restantes, ['parures de légumes (carottes, navet, courgettes)']);
});

test('quantités et unités sont justes sur les lignes les plus tordues du carnet', () => {
  const attendu: [string, number | undefined, string | undefined, string | undefined][] = [
    ['4 merguez végétales ACCRO', 4, undefined, 'merguez'],
    ['0.25 botte de coriandre', 0.25, 'botte', 'coriandre'],
    ['1 poignée de noix de cajou grillées salées (type apéro)', 1, 'poignee', 'noix-de-cajou'],
    ['0.5 sachet de levure chimique', 0.5, 'sachet', 'levure-chimique'],
    ['2 boîtes de thon au naturel', 2, 'boite', 'thon'],
    ['1 paquet de jeunes pousses', 1, 'paquet', 'salade'],
    ['70 g de cassonade', 70, 'g', 'sucre-roux'],
    ['20 figues fraîches', 20, undefined, 'figue'],
    ['100 g de chair à saucisse (ou rien, si vous ne voulez qu\'avec des légumes)', 100, 'g', 'chair-a-saucisse'],
  ];
  for (const [raw, qty, unit, art] of attendu) {
    assert.ok(lignes.includes(raw), 'ligne absente du corpus : ' + raw);
    assert.deepEqual(forme(raw), { qty, unit, art }, raw);
  }
});
