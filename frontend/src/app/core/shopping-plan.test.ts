// La génération de la liste est l'endroit où une erreur coûte le plus cher :
// elle ne plante pas, elle fait acheter deux fois la même chose, ou pire, elle
// efface ce que quelqu'un venait d'ajouter à la main.
//
// D'où l'ordre de ces tests : d'abord l'addition et la mise à l'échelle, ensuite
// le rangement, et enfin la règle qui prime sur toutes les autres, la
// régénération qui ne détruit rien.
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildArticleIndex } from './ingredients';
import { Aisle, MealValue, Recipe, ShopItem } from './models';
import { PlanInput, PlanReport, aisleForRayon, buildPlan, scaleLabel, STOCK_DAYS, keyOfLine, stockAge } from './shopping-plan';

const AISLES: Aisle[] = [
  { id: 'a1', name: 'Fruits & légumes', color: '', position: 0, kind: 'legumes' },
  { id: 'a2', name: 'Frais', color: '', position: 1, kind: 'frais' },
  { id: 'a3', name: 'Épicerie', color: '', position: 2, kind: 'epicerie' },
  { id: 'a4', name: 'À trier', color: '', position: 3 },
];

let seq = 0;
const recette = (name: string, ingr: string[], portions?: number): Recipe =>
  ({ id: 'r' + ++seq, name, level: 'Facile', color: '#000', ingr, steps: [], ...(portions ? { portions } : {}) });

/** Foyer de quatre par défaut. Les couverts sont résolus par l'appelant (presence.ts). */
const plan = (recipes: Recipe[], opts: Partial<PlanInput> = {}): PlanReport => buildPlan({
  slots: recipes.map((r): { value: MealValue; pax: number } => ({ value: { items: [{ rid: r.id }] }, pax: 4 })),
  recipes, aisles: AISLES, articles: [], index: buildArticleIndex(opts.articles || []),
  existing: [], fallbackAisle: 'a4', ...opts,
});

const ligne = (r: PlanReport, name: string) =>
  [...r.add, ...r.pantry, ...r.present].find((l) => l.name.toLowerCase() === name.toLowerCase());

test('le même article venu de trois recettes ne fait qu’une ligne', () => {
  const r = plan([
    recette('Gâteau', ['150 g de farine']),
    recette('Crêpes', ['250 g de farine']),
    recette('Cookies', ['50 g de farine']),
  ]);
  assert.equal(r.add.length, 1);
  assert.equal(r.add[0].qty, '450 g');
  assert.equal(r.add[0].sources.length, 3, 'les trois recettes sont citées');
});

test('les unités d’une même famille se convertissent, les autres restent à part', () => {
  assert.equal(ligne(plan([recette('A', ['500 g de farine', '1 kg de farine'])]), 'farine')!.qty, '1,5 kg');
  assert.equal(ligne(plan([recette('A', ['20 cl de lait', '1 l de lait'])]), 'lait')!.qty, '1,2 l');
  // Une cuillère de farine ne se convertit pas en grammes : la densité manque,
  // et un mauvais total ne se verrait jamais.
  assert.equal(ligne(plan([recette('A', ['150 g de farine', '2 cuillères à soupe de farine'])]), 'farine')!.qty,
    '150 g + 2 c. à soupe');
});

test('la quantité s’écrit dans l’unité qui se lit, pas dans celle du calcul', () => {
  assert.equal(ligne(plan([recette('A', ['0,5 l de bouillon'])]), 'bouillon')!.qty, '50 cl');
  assert.equal(ligne(plan([recette('A', ['1500 g de sucre'])]), 'sucre')!.qty, '1,5 kg');
  // On n'achète pas 1,33 oignon.
  assert.equal(ligne(plan([recette('A', ['1 oignon'], 3)]), 'oignon')!.qty, '2');
});

test('« 1 pièce de poivron » et « 1 poivron » sont le même poivron', () => {
  assert.equal(ligne(plan([recette('A', ['1 pièce de poivron rouge', '2 poivrons verts'])]), 'poivron')!.qty, '3');
});

test('les quantités suivent le nombre de couverts', () => {
  const r4 = plan([recette('Tarte', ['300 g de farine'], 6)]);
  assert.equal(ligne(r4, 'farine')!.qty, '200 g');
  assert.deepEqual(r4.scaled, [{ recipe: 'Tarte', portions: 6, pax: [4] }]);

  const r8 = plan([recette('Tarte', ['300 g de farine'], 6)], {
    slots: [{ value: { items: [{ rid: 'r' + seq }] }, pax: 8 }],
  });
  assert.equal(ligne(r8, 'farine')!.qty, '400 g');
});

// ---- « j'ai déjà ça » -------------------------------------------------------

test('un article qu’on a dit avoir récemment est écarté, avec la date du geste', () => {
  const r = plan([recette('A', ['300 g de farine', '2 carottes'])], {
    stock: { farine: '2026-08-20' }, today: '2026-08-29',
  });
  assert.equal(ligne(r, 'farine'), undefined, 'il ne doit plus être à acheter');
  assert.equal(r.stocked.length, 1);
  assert.equal(r.stocked[0].line.name, 'Farine');
  assert.equal(r.stocked[0].days, 9);
  // Le reste de la liste ne bouge pas.
  assert.ok(ligne(r, 'carotte'));
});

test('la marque se périme, et l’article revient sans qu’on ait rien à faire', () => {
  // Un inventaire mal tenu fait rater des achats : celui-ci s'efface tout seul.
  const vieux = plan([recette('A', ['300 g de farine'])], { stock: { farine: '2026-07-01' }, today: '2026-08-29' });
  assert.equal(vieux.stocked.length, 0);
  assert.ok(vieux.add.some((l) => l.name === 'Farine'));
  // Juste à la limite, elle tient encore.
  const limite = plan([recette('A', ['300 g de farine'])], { stock: { farine: '2026-08-08' }, today: '2026-08-29' });
  assert.equal(stockAge('2026-08-08', '2026-08-29'), STOCK_DAYS);
  assert.equal(limite.stocked.length, 1);
});

test('une marque datée du futur ne fait rien disparaître', () => {
  // Une horloge qui recule ou un état restauré ne doit pas vider la liste.
  const r = plan([recette('A', ['300 g de farine'])], { stock: { farine: '2026-09-30' }, today: '2026-08-29' });
  assert.equal(r.stocked.length, 0);
  assert.ok(ligne(r, 'farine'));
});

test('sans date du jour, aucune marque ne s’applique', () => {
  const r = plan([recette('A', ['300 g de farine'])], { stock: { farine: '2026-08-28' } });
  assert.equal(r.stocked.length, 0);
});

test('la clé d’une ligne est celle de son article, ou son nom quand il est inconnu', () => {
  // Sans cela, « j'ai déjà ça » ne retrouverait jamais sa ligne au tour suivant.
  const connu = ligne(plan([recette('A', ['300 g de farine'])]), 'farine')!;
  assert.equal(keyOfLine(connu), 'farine');
  const r = plan([recette('A', ['2 c. à s. de gomasio'])]);
  const inconnu = [...r.add, ...r.pantry].find((l) => /gomasio/i.test(l.name))!;
  assert.equal(keyOfLine(inconnu), 'gomasio');
});

test('une recette servie deux fois à des tablées différentes les annonce toutes', () => {
  // Depuis que les couverts se comptent créneau par créneau, n'en annoncer
  // qu'un serait un mensonge : la semaine type peut faire varier la tablée.
  const t = recette('Tarte', ['300 g de farine'], 6);
  const r = buildPlan({
    slots: [{ value: { items: [{ rid: t.id }] }, pax: 4 }, { value: { items: [{ rid: t.id }] }, pax: 2 }],
    recipes: [t], aisles: AISLES, articles: [], index: buildArticleIndex([]),
    existing: [], fallbackAisle: 'a4',
  });
  assert.deepEqual(r.scaled, [{ recipe: 'Tarte', portions: 6, pax: [4, 2] }]);
  assert.equal(scaleLabel(r.scaled[0]), 'prévue pour 6, ajustée à 4 puis 2 couverts');
  // 300 g pour 6, servie à 4 puis à 2 : 200 + 100.
  assert.equal(ligne(r, 'farine')!.qty, '300 g');
});

test('la même tablée deux fois ne se répète pas dans le rapport', () => {
  const t = recette('Tarte', ['300 g de farine'], 6);
  const r = buildPlan({
    slots: [{ value: { items: [{ rid: t.id }] }, pax: 4 }, { value: { items: [{ rid: t.id }] }, pax: 4 }],
    recipes: [t], aisles: AISLES, articles: [], index: buildArticleIndex([]),
    existing: [], fallbackAisle: 'a4',
  });
  assert.deepEqual(r.scaled[0].pax, [4]);
  assert.equal(scaleLabel(r.scaled[0]), 'prévue pour 6, ajustée à 4 couverts');
});

test('sans portions connues, rien n’est mis à l’échelle et c’est dit', () => {
  const r = plan([recette('Sans portions', ['300 g de farine'])]);
  assert.equal(ligne(r, 'farine')!.qty, '300 g');
  assert.deepEqual(r.unscaled, ['Sans portions']);
});

test('ce qui n’a pas de quantité n’en invente pas, et n’en retire pas non plus', () => {
  assert.equal(ligne(plan([recette('A', ['huile'])]), 'huile')!.qty, '');
  // « oignon » sans nombre à côté de « 2 oignons » : le total reste 2.
  assert.equal(ligne(plan([recette('A', ['oignon']), recette('B', ['2 oignons'])]), 'oignon')!.qty, '2');
});

test('le fond de placard est écarté de la liste, mais reste proposé', () => {
  const r = plan([recette('A', ['sel', '2 cuillères à soupe d’huile d’olive', '200 g de farine'])]);
  assert.deepEqual(r.add.map((l) => l.name), ['Farine']);
  assert.deepEqual(r.pantry.map((l) => l.name).sort(), ['Huile d\'olive', 'Sel']);
});

test('une ligne incomprise part quand même aux courses, avec son texte', () => {
  const r = plan([recette('A', ['parures de légumes'])]);
  assert.equal(r.add.length, 1);
  assert.equal(r.add[0].name, 'Parures de légumes');
  assert.equal(r.add[0].aisleId, 'a4', 'faute de rayon connu, elle va à trier');
  assert.deepEqual(r.unknown, [{ recipe: 'A', raw: 'parures de légumes' }]);
});

// ---- rangement --------------------------------------------------------------

test('chaque article tombe dans le rayon de son type', () => {
  const r = plan([recette('A', ['2 carottes', '150 g de lardons', '250 g de farine'])]);
  assert.deepEqual(r.add.map((l) => [l.name, l.aisleId]), [
    ['Carotte', 'a1'], ['Lardon', 'a2'], ['Farine', 'a3'],
  ]);
});

test('un rayon typé l’emporte sur le repli', () => {
  const avec = [...AISLES, { id: 'a5', name: 'Boucherie', color: '', position: 4, kind: 'viande' as const }];
  assert.equal(aisleForRayon(avec, 'viande', 'a4'), 'a5');
  assert.equal(aisleForRayon(AISLES, 'viande', 'a4'), 'a2', 'sans boucherie, la viande va au frais');
  assert.equal(aisleForRayon(AISLES, 'boulangerie', 'a4'), 'a3');
});

test('sans type déclaré, le nom du rayon suffit', () => {
  // Les foyers installés avant cette version n'ont pas de type sur leurs rayons.
  const sansType = AISLES.map(({ kind: _kind, ...a }) => a);
  assert.equal(aisleForRayon(sansType, 'legumes', 'a4'), 'a1');
  assert.equal(aisleForRayon(sansType, 'epicerie', 'a4'), 'a3');
  assert.equal(aisleForRayon(sansType, 'viande', 'a4'), 'a2');
});

test('un rayon renommé sans type ne fait pas tout basculer à trier', () => {
  const renommes: Aisle[] = [{ id: 'b1', name: 'Sec & conserves', color: '', position: 0 }];
  assert.equal(aisleForRayon(renommes, 'epicerie', 'b9'), 'b9');
});

// ---- régénération : la règle qui prime --------------------------------------

const item = (o: Partial<ShopItem>): ShopItem =>
  ({ id: 'g' + ++seq, name: '', qty: '', aisleId: 'a3', state: 'a-prendre', listId: 'cl1', ...o });

test('un article ajouté à la main n’est jamais touché, ni retiré, ni dupliqué', () => {
  const manuel = item({ name: 'Farine', art: 'farine', qty: '1 kg' });
  const r = plan([recette('A', ['200 g de farine'])], { existing: [manuel] });
  assert.deepEqual(r.add, []);
  assert.deepEqual(r.update, []);
  assert.deepEqual(r.remove, []);
  assert.deepEqual(r.present.map((l) => l.name), ['Farine']);
});

test('la quantité d’un article généré se met à jour quand les repas changent', () => {
  const genere = item({ name: 'Farine', art: 'farine', qty: '200 g', gen: true });
  const r = plan([recette('A', ['500 g de farine'])], { existing: [genere] });
  assert.deepEqual(r.add, []);
  assert.equal(r.update.length, 1);
  assert.equal(r.update[0].line.qty, '500 g');
  assert.equal(r.update[0].item.id, genere.id);
});

test('un article déjà mis au panier n’est ni corrigé ni retiré', () => {
  // Quelqu'un l'a pris : ce n'est plus à la génération d'en décider.
  const pris = item({ name: 'Farine', art: 'farine', qty: '200 g', gen: true, state: 'panier' });
  assert.deepEqual(plan([recette('A', ['500 g de farine'])], { existing: [pris] }).update, []);
  assert.deepEqual(plan([recette('A', ['2 carottes'])], { existing: [pris] }).remove, []);
});

test('ce que la génération a écrit et que plus rien ne demande est retiré', () => {
  const orphelin = item({ name: 'Farine', art: 'farine', qty: '200 g', gen: true });
  const r = plan([recette('A', ['2 carottes'])], { existing: [orphelin] });
  assert.deepEqual(r.remove.map((i) => i.id), [orphelin.id]);
});

test('un article introuvable en magasin survit à une régénération', () => {
  const introuvable = item({ name: 'Farine', art: 'farine', gen: true, state: 'indisponible' });
  assert.deepEqual(plan([recette('A', ['2 carottes'])], { existing: [introuvable] }).remove, []);
});

// ---- de bout en bout, sur le foyer réel -------------------------------------

const etat = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'cuisine-reelle.json'), 'utf8',
)) as { recipes: Recipe[]; meals: Record<string, { rid?: string; items?: { rid?: string }[] }>; aisles: Aisle[] };

test('la semaine réellement planifiée donne une liste tenable', () => {
  const slots = Object.values(etat.meals)
    .map((v): { value: MealValue; pax: number } => ({ value: { items: v.items || (v.rid ? [{ rid: v.rid }] : []) }, pax: 4 }));
  const r = buildPlan({
    slots, recipes: etat.recipes, aisles: etat.aisles, articles: [],
    index: buildArticleIndex([]), existing: [], fallbackAisle: 'a4',
  });

  // La version précédente recopiait 65 lignes brutes pour ces mêmes repas.
  assert.ok(r.add.length >= 25 && r.add.length <= 40, 'lignes générées : ' + r.add.length);
  assert.equal(r.unknown.length, 0, 'aucune ligne incomprise sur cette semaine');
  assert.ok(r.pantry.length >= 10, 'les épices et l’huile sont écartées');

  const noms = r.add.map((l) => l.name.toLowerCase());
  assert.equal(new Set(noms).size, noms.length, 'aucun doublon dans la liste');
  const rayons = new Set(etat.aisles.map((a) => a.id));
  for (const l of [...r.add, ...r.pantry]) assert.ok(rayons.has(l.aisleId), l.name + ' : rayon inconnu');
  // Rien ne doit atterrir à trier : tout a été reconnu.
  assert.deepEqual(r.add.filter((l) => l.aisleId === 'a4').map((l) => l.name), []);

  // Trois recettes au poulet dans la semaine : une seule ligne, et elle cite
  // chacune d'elles.
  const poulet = r.add.find((l) => l.art === 'poulet');
  assert.ok(poulet, 'le poulet manque à la liste');
  assert.ok(poulet.sources.length >= 3, 'sources du poulet : ' + poulet.sources.length);
});
