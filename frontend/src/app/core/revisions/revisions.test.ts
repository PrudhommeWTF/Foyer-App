// Le module Révisions côté écran : le tirage des questions (dus d'abord, jamais
// vus au plus un tiers, toujours dans l'univers, jamais deux fois de suite le
// même item), pour Tables et pour un exercice fictif qui ne ressemble à rien
// de connu ; la correction ; et les mots du bilan et de l'objectif.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ExerciseDef, readParams } from './exercises/contract';
import { TABLES, TablesQuestion } from './exercises/tables';
import { DICTEE } from './exercises/dictee';
import { MasteryItem, activityDays, classify, dayLine, drawQuestions, fragile, goalLine, kidsLine, periodOf, programGroups, sessionUuid, summaryLine } from './revisions';

/** Un hasard reproductible : le même tirage à chaque passage. */
const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const item = (key: string, nextAt: string, extra: Partial<MasteryItem> = {}): MasteryItem =>
  ({ key, label: key, level: 1, good: 1, wrong: 0, lastResult: 'bon', lastAt: nextAt, nextAt, status: 'peu', ...extra });
const NOW = '2026-10-19T17:00:00.000Z';

/** Un exercice fictif : des couleurs à nommer. Rien à voir avec des nombres. */
const COULEURS: ExerciseDef<{ c: string }> = {
  id: 'couleurs', label: 'Couleurs', matiere: 'francais', icon: 'grille', desc: '', input: 'clavier', prompt: 'texte', view: 'liste',
  params: [], universe: () => ['rouge', 'vert', 'bleu'], question: (k) => ({ c: k }), parse: () => null,
  itemKey: (q) => q.c, itemLabel: (k) => k, text: (q) => q.c, groups: () => [],
  check: (q, g) => ({ ok: g === q.c, expected: q.c }), summary: () => 'Les couleurs',
};

test('le tirage reste dans l’univers et fait le compte demandé', () => {
  const p = readParams(TABLES, { tables: [6, 9], bothDirections: false });
  const qs = drawQuestions(TABLES, p, { count: 20, mastery: [], now: NOW, rand: seeded() });
  assert.equal(qs.length, 20);
  const universe = new Set(TABLES.universe(p));
  assert.ok(qs.every((q) => universe.has(TABLES.itemKey(q))));
  assert.ok(qs.every((q) => q.a >= 6 && q.a <= 9), 'sans les deux sens, l’exercice pose la table travaillée en premier');
});

test('les items dus passent d’abord, les jamais vus au plus un tiers', () => {
  const p = readParams(TABLES, { tables: [6, 9] });
  const due = [item('mult:6x7', '2026-10-18T00:00:00.000Z'), item('mult:7x8', '2026-10-17T00:00:00.000Z')];
  const later = TABLES.universe(p).filter((k) => !['mult:6x7', 'mult:7x8'].includes(k)).slice(0, 20).map((k) => item(k, '2026-11-01T00:00:00.000Z'));
  const keys = drawQuestions(TABLES, p, { count: 9, mastery: [...due, ...later], now: NOW, rand: seeded(3) }).map((q) => TABLES.itemKey(q));
  assert.ok(keys.includes('mult:6x7') && keys.includes('mult:7x8'), 'les deux dus sont posés');
  const known = new Set([...due, ...later].map((m) => m.key));
  assert.ok(keys.filter((k) => !known.has(k)).length <= 3, 'au plus un tiers de nouveaux');
});

test('un petit univers se répète, jamais deux fois de suite le même item', () => {
  const qs = drawQuestions(COULEURS, {}, { count: 12, mastery: [], now: NOW, rand: seeded(11) });
  assert.equal(qs.length, 12);
  for (let i = 1; i < qs.length; i++) assert.notEqual(qs[i].c, qs[i - 1].c, `questions ${i} et ${i + 1}`);
  const add = readParams(TABLES, { operation: 'add', tables: [2, 2], max: 10 });
  const t = drawQuestions(TABLES, add, { count: 30, mastery: [], now: NOW, rand: seeded(5) }) as TablesQuestion[];
  assert.ok(t.every((q) => q.op === 'add'));
});

test('une dictée se tire dans la liste choisie, avec le contexte de l’exercice', () => {
  const ctx = { lists: [{ id: 's', label: 'Semaine', items: ['oiseau', 'école', 'maison'], source: 'foyer' as const }] };
  const p = readParams(DICTEE, {}, ctx);
  const qs = drawQuestions(DICTEE, p, { count: 7, mastery: [], now: NOW, rand: seeded(2), ctx });
  assert.equal(qs.length, 7);
  assert.ok(qs.every((q) => ['oiseau', 'école', 'maison'].includes(q.mot)));
  for (let i = 1; i < qs.length; i++) assert.notEqual(qs[i].mot, qs[i - 1].mot);
  assert.equal(summaryLine(DICTEE, p, { good: 2, slow: 0, wrong: 1 }, ctx), 'Tu as révisé la liste « Semaine » (3 mots) : 2 bonnes, 0 lente, 1 fausse.');
  assert.deepEqual(drawQuestions(DICTEE, p, { count: 5, mastery: [], now: NOW }), [], 'sans le contexte, pas de mots');
});

test('la correction : bonne, lente, fausse, passée', () => {
  assert.equal(classify(true, '56', 3999, 4000), 'bon');
  assert.equal(classify(true, '56', 4001, 4000), 'lent');
  assert.equal(classify(false, '54', 1000, 4000), 'faux');
  assert.equal(classify(false, null, 8000, 4000), 'passe');
});

test('le bilan reprend le résumé de l’exercice, et s’accorde au nombre', () => {
  assert.equal(summaryLine(TABLES, readParams(TABLES, { tables: [6, 9] }), { good: 18, slow: 2, wrong: 0 }),
    'Tu as révisé les tables de 6 à 9, multiplication : 18 bonnes, 2 lentes, 0 fausse.');
  assert.equal(summaryLine(COULEURS, {}, { good: 1, slow: 0, wrong: 3 }), 'Tu as révisé les couleurs : 1 bonne, 0 lente, 3 fausses.');
});

test('l’objectif du jour ne reproche jamais un zéro', () => {
  assert.equal(goalLine(0, 1), 'Pas encore aujourd’hui');
  assert.equal(goalLine(1, 2), '1 session sur 2 faite');
  assert.equal(goalLine(2, 2), 'Objectif du jour atteint');
  assert.equal(goalLine(3, 2), 'Objectif atteint : 3 sessions aujourd’hui');
  assert.equal(goalLine(0, 0), '');
});

test('l’entraînement du jour : l’objectif d’un exercice seul, sinon combien sont faits', () => {
  assert.equal(dayLine([{ done: 1, goal: 2 }]), '1 session sur 2 faite');
  assert.equal(dayLine([{ done: 0, goal: 1 }, { done: 0, goal: 1 }]), 'Pas encore aujourd’hui');
  assert.equal(dayLine([{ done: 1, goal: 1 }, { done: 0, goal: 2 }]), '1 exercice sur 2 fait aujourd’hui');
  assert.equal(dayLine([{ done: 1, goal: 1 }, { done: 3, goal: 2 }, { done: 0, goal: 0 }]), 'Objectif du jour atteint');
  assert.equal(dayLine([{ done: 0, goal: 0 }, { done: 0, goal: 0 }]), '');
});

test('les items fragiles : le plus bas niveau d’abord, jamais un acquis', () => {
  const f = fragile([
    item('mult:7x8', NOW, { level: 0, wrong: 3, lastResult: 'faux', status: 'en-cours' }),
    item('mult:6x9', NOW, { level: 1, wrong: 1, lastResult: 'lent', status: 'en-cours' }),
    item('mult:2x2', NOW, { level: 4, wrong: 1, status: 'acquise' }),
    item('mult:3x3', NOW, { level: 2, wrong: 0, lastResult: 'bon', status: 'en-cours' }),
  ]);
  assert.deepEqual(f.map((c) => c.key), ['mult:7x8', 'mult:6x9']);
  assert.deepEqual(fragile([item('mult:7x8', NOW, { wrong: 1, status: 'en-cours' }), item('mult:2x3', NOW, { wrong: 1, status: 'en-cours' })], 6, ['mult:2x3']).map((c) => c.key),
    ['mult:2x3'], 'hors du programme en vigueur : pas montré');
});

test('le suivi montre tous les groupes du programme, même ceux pas encore vus, dans l’ordre des nombres', () => {
  const p = readParams(TABLES, { tables: [8, 11], max: 12 });
  const g = programGroups(TABLES, p, [{ group: 'Table de 9', questions: 4, correct: 3, fast: 2 }]);
  assert.deepEqual(g.map((x) => x.group), ['Table de 8', 'Table de 9', 'Table de 10', 'Table de 11']);
  assert.deepEqual(g[1], { group: 'Table de 9', questions: 4, pct: 75, fastPct: 50 });
  assert.equal(g[0].questions, 0);
});

test('vingt-huit jours d’activité, aujourd’hui en dernier, à l’heure de Paris', () => {
  const now = new Date('2026-10-19T22:30:00.000Z'); // 00 h 30 le 20 à Paris
  const d = activityDays([{ day: '2026-10-20', sessions: 2 }, { day: '2026-09-22', sessions: 9 }], now);
  assert.equal(d.length, 28);
  assert.deepEqual(d[27], { day: '2026-10-20', sessions: 2 });
  assert.equal(d[0].day, '2026-09-23');
  assert.ok(d.every((x) => x.day !== '2026-09-22'), 'hors des quatre semaines');
});

test('les périodes du bilan : la semaine va du lundi, le mois du premier', () => {
  assert.deepEqual(periodOf('semaine', '2026-10-21'), { from: '2026-10-19', to: '2026-10-21' });
  assert.deepEqual(periodOf('semaine', '2026-10-19'), { from: '2026-10-19', to: '2026-10-19' }, 'un lundi');
  assert.deepEqual(periodOf('semaine-derniere', '2026-10-18'), { from: '2026-10-05', to: '2026-10-11' }, 'un dimanche : la semaine d’avant');
  assert.deepEqual(periodOf('mois', '2026-10-21'), { from: '2026-10-01', to: '2026-10-21' });
  assert.deepEqual(periodOf('mois-dernier', '2026-03-05'), { from: '2026-02-01', to: '2026-02-28' });
});

test('la tuile d’un adulte : chaque enfant, sans reprocher un zéro', () => {
  assert.equal(kidsLine([{ name: 'Raphaël', sessions: 2 }, { name: 'Gaëtan', sessions: 0 }, { name: 'Noé', sessions: undefined }]),
    'Raphaël : 2 sessions aujourd’hui, Gaëtan : pas encore aujourd’hui');
});

test('un identifiant de session est un uuid v4, même sans crypto.randomUUID', () => {
  assert.match(sessionUuid((b) => b.fill(0xab)), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
