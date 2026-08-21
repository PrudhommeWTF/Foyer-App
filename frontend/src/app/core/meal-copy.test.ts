// Recopier une semaine touche à des données que personne ne relit avant de les
// perdre : un menu écrasé ne se remarque que le soir venu, devant le frigo.
// D'où l'insistance de ces tests sur ce que la copie **ne doit pas** faire.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CopyReport, applyMealCopy, planMealCopy } from './meal-copy';
import { MealValue } from './models';

const SLOTS = ['midi', 'soir'];
const S = ['2026-08-17', '2026-08-18', '2026-08-19'];
const T = ['2026-08-24', '2026-08-25', '2026-08-26'];

const repas = (...noms: string[]): MealValue => ({ items: noms.map((text) => ({ text })) });
const base = (): Record<string, MealValue> => ({
  '2026-08-17-midi': repas('Croque-monsieur'),
  '2026-08-17-soir': repas('Risotto', 'Tiramisu'),
  '2026-08-19-midi': repas('Wrap'),
});

const copie = (meals: Record<string, MealValue>, mode: 'fill' | 'replace'): { rep: CopyReport; out: Record<string, MealValue> } => {
  const rep = planMealCopy(meals, S, T, SLOTS, mode);
  return { rep, out: applyMealCopy(meals, rep) };
};

test('les repas de la source arrivent sur les jours correspondants', () => {
  const { rep, out } = copie(base(), 'fill');
  assert.equal(rep.writes.length, 3);
  assert.deepEqual(out['2026-08-24-midi'], repas('Croque-monsieur'));
  assert.deepEqual(out['2026-08-24-soir'], repas('Risotto', 'Tiramisu'));
  assert.deepEqual(out['2026-08-26-midi'], repas('Wrap'));
  assert.equal(out['2026-08-25-midi'], undefined, 'un créneau source vide ne crée rien');
});

test('la source n’est jamais modifiée', () => {
  const avant = base();
  const { out } = copie(avant, 'replace');
  for (const k of Object.keys(avant)) assert.deepEqual(out[k], avant[k], k);
});

test('« compléter » ne détruit rien, jamais', () => {
  const m = base();
  m['2026-08-24-midi'] = repas('Déjà prévu');
  const { rep, out } = copie(m, 'fill');
  assert.deepEqual(out['2026-08-24-midi'], repas('Déjà prévu'));
  assert.deepEqual(rep.kept, ['2026-08-24-midi']);
  assert.deepEqual(rep.cleared, [], 'aucun écrasement en mode compléter');
  assert.deepEqual(out['2026-08-24-soir'], repas('Risotto', 'Tiramisu'), 'les créneaux libres sont bien remplis');
});

test('« remplacer » écrase le créneau occupé', () => {
  const m = base();
  m['2026-08-24-midi'] = repas('Déjà prévu');
  const { rep, out } = copie(m, 'replace');
  assert.deepEqual(out['2026-08-24-midi'], repas('Croque-monsieur'));
  assert.deepEqual(rep.cleared, ['2026-08-24-midi']);
});

test('« remplacer » vide aussi les créneaux que la source n’a pas', () => {
  // C'est la différence qui compte : la période visée devient la copie exacte de
  // la source, trous compris. L'écran doit l'annoncer avant d'agir.
  const m = base();
  m['2026-08-25-soir'] = repas('Restes');
  const { rep, out } = copie(m, 'replace');
  assert.equal(out['2026-08-25-soir'], undefined);
  assert.ok(rep.cleared.includes('2026-08-25-soir'));

  const fill = copie(m, 'fill');
  assert.deepEqual(fill.out['2026-08-25-soir'], repas('Restes'), 'compléter le laisse tranquille');
});

test('les repas sont dupliqués en profondeur, pas partagés', () => {
  // Un partage de référence ferait qu'éditer une semaine change l'autre, sans
  // aucun signe à l'écran. C'est le genre de défaut qu'on découvre trop tard.
  const m = base();
  const { out } = copie(m, 'fill');
  out['2026-08-24-soir'].items[0].text = 'Autre chose';
  assert.equal(m['2026-08-17-soir'].items[0].text, 'Risotto');
  assert.notEqual(out['2026-08-24-soir'].items, m['2026-08-17-soir'].items);
});

test('les couverts suivent le repas', () => {
  const m: Record<string, MealValue> = { '2026-08-17-soir': { items: [{ text: 'Raclette' }], pax: 8 } };
  const { out } = copie(m, 'fill');
  assert.equal(out['2026-08-24-soir'].pax, 8);
});

test('un créneau qui porte déjà le même menu n’est pas annoncé comme écrasé', () => {
  // Sans cela, recopier deux fois de suite affiche « 10 créneaux seront
  // écrasés » alors que rien ne changerait. Une alerte qui crie pour rien finit
  // par ne plus être lue.
  const m = base();
  const { out } = copie(m, 'fill');
  const rep = planMealCopy(out, S, T, SLOTS, 'replace');
  assert.deepEqual(rep.writes, []);
  assert.deepEqual(rep.cleared, []);
  assert.equal(rep.kept.length, 3);
});

test('un menu différent, lui, est bien annoncé comme écrasé', () => {
  const m = base();
  const { out } = copie(m, 'fill');
  out['2026-08-24-midi'] = repas('Autre chose');
  const rep = planMealCopy(out, S, T, SLOTS, 'replace');
  assert.deepEqual(rep.cleared, ['2026-08-24-midi']);
});

test('recopier une période sur elle-même ne fait rien', () => {
  // En mode « remplacer », un traitement naïf viderait la cible avant de la
  // réécrire depuis elle-même, donc perdrait tout.
  const m = base();
  const rep = planMealCopy(m, S, S, SLOTS, 'replace');
  assert.deepEqual(rep.writes, []);
  assert.deepEqual(rep.cleared, []);
  assert.deepEqual(applyMealCopy(m, rep), m);
});

test('une source vide est signalée plutôt que silencieuse', () => {
  const rep = planMealCopy({}, S, T, SLOTS, 'fill');
  assert.equal(rep.sourceEmpty, true);
  assert.deepEqual(rep.writes, []);
});

test('les périodes de longueurs différentes sont refusées', () => {
  assert.throws(() => planMealCopy({}, S, T.slice(0, 2), SLOTS, 'fill'), /longueurs différentes/);
});

test('seuls les créneaux affichés sont recopiés', () => {
  // Le petit-déjeuner est masqué par défaut : le recopier créerait des repas
  // invisibles, que l'utilisateur ne pourrait ni voir ni retirer.
  const m = { ...base(), '2026-08-17-matin': repas('Tartines') };
  const { out } = copie(m, 'fill');
  assert.equal(out['2026-08-24-matin'], undefined);

  const avecMatin = planMealCopy(m, S, T, ['matin', 'midi', 'soir'], 'fill');
  assert.ok(applyMealCopy(m, avecMatin)['2026-08-24-matin']);
});

test('une semaine entière se recopie d’un bloc', () => {
  const semaine = (d: number): string => '2026-08-' + String(d).padStart(2, '0');
  const src = [17, 18, 19, 20, 21, 22, 23].map(semaine);
  const dst = [24, 25, 26, 27, 28, 29, 30].map(semaine);
  const m: Record<string, MealValue> = {};
  for (const j of src) for (const s of SLOTS) m[j + '-' + s] = repas('Plat du ' + j);
  const rep = planMealCopy(m, src, dst, SLOTS, 'fill');
  assert.equal(rep.writes.length, 14);
  const out = applyMealCopy(m, rep);
  assert.equal(Object.keys(out).length, 28);
  assert.deepEqual(out['2026-08-30-soir'], repas('Plat du 2026-08-23'));
});
