// Le module Tables côté écran : le tirage des questions (dues d'abord, jamais
// vues au plus un tiers, toujours dans la plage), la correction, et les mots
// du bilan et de l'objectif.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MasteryCell, classify, drawQuestions, fragile, goalLine, learnRows, pairKey, rangePairs, sessionUuid, spoken, summaryLine } from './tables';

/** Un hasard reproductible : le même tirage à chaque passage. */
const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const cell = (a: number, b: number, nextAt: string, extra: Partial<MasteryCell> = {}): MasteryCell =>
  ({ a, b, level: 1, good: 1, wrong: 0, lastResult: 'bon', nextAt, status: 'peu', ...extra });
const NOW = '2026-10-19T17:00:00.000Z';

test('une plage : chaque table par chaque nombre, sans doublon commutatif', () => {
  const p = rangePairs(6, 7, 10);
  assert.equal(p.length, 21, '6 × 0 à 6 × 10, puis 7 × 0 à 7 × 10 sans 7 × 6');
  assert.ok(p.every(([a, b]) => a <= b));
});

test('le tirage reste dans la plage et fait le compte demandé', () => {
  const qs = drawQuestions({ op: 'multiplication', from: 6, to: 9, max: 10, count: 20, bothDirections: false, mastery: [], now: NOW, rand: seeded() });
  assert.equal(qs.length, 20);
  assert.ok(qs.every((q) => q.a >= 6 && q.a <= 9), 'sans les deux sens, le facteur de la plage vient d’abord');
  assert.ok(qs.every((q) => q.expected === q.a * q.b));
});

test('les opérations dues passent d’abord, les jamais vues au plus un tiers', () => {
  const due = [cell(6, 7, '2026-10-18T00:00:00.000Z'), cell(7, 8, '2026-10-17T00:00:00.000Z')];
  const later = rangePairs(6, 9, 10).filter(([a, b]) => !['6x7', '7x8'].includes(`${a}x${b}`)).slice(0, 20).map(([a, b]) => cell(a, b, '2026-11-01T00:00:00.000Z'));
  const qs = drawQuestions({ op: 'multiplication', from: 6, to: 9, max: 10, count: 9, bothDirections: true, mastery: [...due, ...later], now: NOW, rand: seeded(3) });
  const keys = qs.map((q) => pairKey(q.a, q.b));
  assert.ok(keys.includes('6x7') && keys.includes('7x8'), 'les deux dues sont posées');
  const known = new Set([...due, ...later].map((m) => pairKey(m.a, m.b)));
  assert.ok(keys.filter((k) => !known.has(k)).length <= 3, 'au plus un tiers de nouvelles');
});

test('une petite plage se répète, jamais deux fois de suite la même question', () => {
  const qs = drawQuestions({ op: 'addition', from: 2, to: 2, max: 3, count: 12, bothDirections: true, mastery: [], now: NOW, rand: seeded(11) });
  assert.equal(qs.length, 12);
  for (let i = 1; i < qs.length; i++) assert.notEqual(pairKey(qs[i].a, qs[i].b), pairKey(qs[i - 1].a, qs[i - 1].b), `questions ${i} et ${i + 1}`);
  assert.ok(qs.every((q) => q.expected === q.a + q.b));
});

test('la correction : bonne, lente, fausse, passée', () => {
  assert.equal(classify(56, 56, 3999, 4000), 'bon');
  assert.equal(classify(56, 56, 4001, 4000), 'lent');
  assert.equal(classify(56, 54, 1000, 4000), 'faux');
  assert.equal(classify(56, null, 8000, 4000), 'passe');
});

test('le mode Apprendre déroule la table, et la voix la lit en français', () => {
  const rows = learnRows('multiplication', 7, 10);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[2], { a: 7, b: 3, expected: 21 });
  assert.equal(spoken('multiplication', rows[2]), '7 fois 3, 21');
  assert.equal(spoken('addition', learnRows('addition', 4, 10)[0]), '4 plus 1, 5');
});

test('le bilan s’accorde au nombre', () => {
  assert.equal(summaryLine(6, 9, { good: 18, slow: 2, wrong: 0 }), 'Tu as révisé les tables de 6 à 9 : 18 bonnes, 2 lentes, 0 fausse.');
  assert.equal(summaryLine(7, 7, { good: 1, slow: 0, wrong: 3 }), 'Tu as révisé la table de 7 : 1 bonne, 0 lente, 3 fausses.');
});

test('l’objectif du jour ne reproche jamais un zéro', () => {
  assert.equal(goalLine(0, 1), 'Pas encore aujourd’hui');
  assert.equal(goalLine(1, 2), '1 session sur 2 faite');
  assert.equal(goalLine(2, 2), 'Objectif du jour atteint');
  assert.equal(goalLine(0, 0), '');
});

test('les opérations fragiles : le plus bas niveau d’abord, jamais une acquise', () => {
  const f = fragile([
    cell(7, 8, NOW, { level: 0, wrong: 3, lastResult: 'faux', status: 'en-cours' }),
    cell(6, 9, NOW, { level: 1, wrong: 1, lastResult: 'lent', status: 'en-cours' }),
    cell(2, 2, NOW, { level: 4, wrong: 1, status: 'acquise' }),
    cell(3, 3, NOW, { level: 2, wrong: 0, lastResult: 'bon', status: 'en-cours' }),
  ]);
  assert.deepEqual(f.map((c) => pairKey(c.a, c.b)), ['7x8', '6x9']);
});

test('un identifiant de session est un uuid v4, même sans crypto.randomUUID', () => {
  assert.match(sessionUuid((b) => b.fill(0xab)), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
