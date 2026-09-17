// L'ordre manuel des tâches en indexation fractionnaire : insérer entre deux
// voisins ne touche qu'une tâche, cent insertions au même endroit gardent des
// clés distinctes, et deux déplacements concurrents ne perdent ni ne déplacent
// rien hors de la liste. C'est ce qui justifie la clé textuelle plutôt qu'un
// flottant (qui s'épuise) ou un entier (qui force à réécrire les voisins).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskItem, TaskOp, applyOps } from '../src/tasks/ops';
import { byOrd, orderedOf } from '../src/tasks/ordering';

const ctx = (lists = ['l1', 'l2']) => ({
  listIds: new Set(lists),
  listKind: (id: string) => (lists.includes(id) ? 'taches' : undefined),
  memberIds: new Set(['me', 'm1']),
  shopListIds: new Set(['cl1']),
  alreadyApplied: () => false,
});

let seq = 0;
const op = (o: Record<string, unknown> & { op: string }): TaskOp =>
  ({ opId: 'op-' + (seq++), ...o }) as unknown as TaskOp;

/** Ajoute une tâche (le serveur lui pose une clé de fin de liste). */
const add = (items: TaskItem[], id: string, listId = 'l1', position?: 'debut' | 'fin'): TaskItem[] =>
  applyOps(items, [op({ op: 'add', id, listId, text: id, position })], ctx()).items;

/** Les identifiants d'une liste, dans l'ordre courant. */
const order = (items: TaskItem[], listId = 'l1'): string[] => orderedOf(items, listId).map((t) => t.id);

// ---- insertion aux quatre coins ---------------------------------------------

test('une tâche neuve reçoit une clé de fin de liste', () => {
  let items: TaskItem[] = [];
  items = add(items, 'a');
  items = add(items, 'b');
  items = add(items, 'c');
  assert.deepEqual(order(items), ['a', 'b', 'c']);
  assert.equal(new Set(items.map((t) => t.ord)).size, 3, 'trois clés distinctes');
});

test('insérer entre deux voisins ne touche que la tâche déplacée', () => {
  let items = add(add(add([], 'a'), 'b'), 'c'); // a, b, c
  const avant = new Map(items.map((t) => [t.id, t.ord]));
  const r = applyOps(items, [op({ op: 'move', id: 'c', apres: 'a' })], ctx());
  assert.deepEqual(order(r.items), ['a', 'c', 'b']);
  // Seule « c » a changé de clé ; « a » et « b » sont intactes.
  assert.equal(r.items.find((t) => t.id === 'a')!.ord, avant.get('a'));
  assert.equal(r.items.find((t) => t.id === 'b')!.ord, avant.get('b'));
  assert.notEqual(r.items.find((t) => t.id === 'c')!.ord, avant.get('c'));
});

test('placer en tête, en fin, avant et après', () => {
  let items = add(add(add([], 'a'), 'b'), 'c');
  items = applyOps(items, [op({ op: 'move', id: 'c', position: 'debut' })], ctx()).items;
  assert.deepEqual(order(items), ['c', 'a', 'b']);
  items = applyOps(items, [op({ op: 'move', id: 'c', position: 'fin' })], ctx()).items;
  assert.deepEqual(order(items), ['a', 'b', 'c']);
  items = applyOps(items, [op({ op: 'move', id: 'c', avant: 'a' })], ctx()).items;
  assert.deepEqual(order(items), ['c', 'a', 'b']);
  items = applyOps(items, [op({ op: 'move', id: 'a', apres: 'b' })], ctx()).items;
  assert.deepEqual(order(items), ['c', 'b', 'a']);
});

test('liste vide et liste à un seul élément : le déplacement est sans objet, pas une erreur', () => {
  const un = add([], 'seul');
  const r = applyOps(un, [op({ op: 'move', id: 'seul', position: 'debut' })], ctx());
  assert.equal(r.skipped.length, 0);
  assert.deepEqual(order(r.items), ['seul']);
});

// ---- le test qui justifie la clé textuelle ----------------------------------

test('cent insertions au même endroit : clés distinctes, ordre correct', () => {
  let items = add(add([], 'a'), 'b'); // a, b
  // À chaque tour, une tâche neuve vient se glisser juste après « a ».
  for (let i = 0; i < 100; i++) {
    items = add(items, 't' + i);
    items = applyOps(items, [op({ op: 'move', id: 't' + i, apres: 'a' })], ctx()).items;
  }
  const ords = orderedOf(items, 'l1').map((t) => t.ord!);
  assert.equal(items.length, 102);
  assert.equal(new Set(ords).size, 102, 'toutes les clés restent distinctes');
  // L'ordre est strictement croissant sur (clé, id) : aucune paire à départager
  // par l'identifiant ne s'est glissée.
  for (let i = 1; i < ords.length; i++) assert.ok(ords[i - 1] < ords[i], `clés triées : ${ords[i - 1]} < ${ords[i]}`);
  // « a » d'abord, « b » en dernier, les cent autres entre les deux, le plus
  // récent (t99) juste après « a ».
  const ids = order(items);
  assert.equal(ids[0], 'a');
  assert.equal(ids[1], 't99');
  assert.equal(ids[101], 'b');
});

// ---- concurrence -------------------------------------------------------------

test('deux déplacements concurrents : rien ne disparaît, rien ne change de liste, ordre déterministe', () => {
  const base = add(add(add([], 'a'), 'b'), 'c'); // a, b, c
  // Deux appareils, partis du même état, envoient chacun un déplacement relatif.
  // Le serveur les sérialise : chacun relit les voisins réels au moment où il
  // s'applique, donc aucun ne s'appuie sur une clé périmée.
  const step1 = applyOps(base, [op({ op: 'move', id: 'c', position: 'debut' })], ctx());
  const step2 = applyOps(step1.items, [op({ op: 'move', id: 'a', position: 'fin' })], ctx());
  const ids = order(step2.items);
  assert.equal(ids.length, 3, 'les trois tâches sont toujours là');
  assert.equal(new Set(ids).size, 3, 'aucun doublon');
  assert.ok(step2.items.every((t) => t.listId === 'l1'), 'aucune n’a changé de liste');
  assert.deepEqual(ids, ['c', 'b', 'a']);
  // Déterministe : le même lot rejoué donne le même ordre.
  const rejeu = applyOps(applyOps(base, [op({ op: 'move', id: 'c', position: 'debut' })], ctx()).items,
    [op({ op: 'move', id: 'a', position: 'fin' })], ctx());
  assert.deepEqual(order(rejeu.items), ids);
});

// ---- refus et cas neutres ----------------------------------------------------

test('déplacer vers une référence d’une autre liste : refus motivé', () => {
  let items = add(add([], 'a', 'l1'), 'x', 'l2');
  const r = applyOps(items, [op({ op: 'move', id: 'a', avant: 'x' })], ctx());
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /autre liste/);
  assert.deepEqual(order(items, 'l1'), ['a'], 'l’ordre n’a pas bougé');
});

test('référence inexistante : refus motivé', () => {
  const items = add(add([], 'a'), 'b');
  const r = applyOps(items, [op({ op: 'move', id: 'a', apres: 'fantome' })], ctx());
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /référence introuvable/);
});

test('déjà à cette place : neutre, acquittée sans rien réécrire', () => {
  let items = add(add(add([], 'a'), 'b'), 'c'); // a, b, c
  const avant = new Map(items.map((t) => [t.id, t.ord]));
  // « b » déjà après « a » : neutre.
  const r = applyOps(items, [op({ op: 'move', id: 'b', apres: 'a' })], ctx());
  assert.equal(r.skipped.length, 0);
  assert.equal(r.applied.length, 1, 'acquittée');
  assert.equal(r.items.find((t) => t.id === 'b')!.ord, avant.get('b'), 'aucune clé réécrite');
});

test('déplacer une tâche terminée : refus motivé', () => {
  let items = add(add([], 'a'), 'b');
  items = applyOps(items, [op({ op: 'done', id: 'b' })], ctx()).items;
  const r = applyOps(items, [op({ op: 'move', id: 'b', position: 'debut' })], ctx());
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /terminée/);
});

test('un déplacement seul n’estampille pas « modifié »', () => {
  let items = add(add([], 'a'), 'b');
  const r = applyOps(items, [op({ op: 'move', id: 'b', position: 'debut' })], ctx());
  assert.equal(r.items.find((t) => t.id === 'b')!.upAt, undefined, 'ranger n’est pas modifier');
});

// ---- le filet : une tâche sans clé passe en fin ------------------------------

test('une tâche sans clé (client d’une version antérieure) se range en fin, sans planter le tri', () => {
  const items: TaskItem[] = [
    { id: 'sans', listId: 'l1', text: 'sans clé', who: [], due: null, done: false },
    ...add(add([], 'a'), 'b'),
  ];
  assert.deepEqual(order(items), ['a', 'b', 'sans']);
  // Et elle reste comparable : trier deux fois donne le même résultat.
  assert.deepEqual([...items].sort(byOrd).map((t) => t.id), ['a', 'b', 'sans']);
});
