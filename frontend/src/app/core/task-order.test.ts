import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { byOrd, moveKey, singleMove } from './task-order';
import { applyTaskOp, inverseOf } from './task-ops';
import { TaskItem } from './models';

const t = (id: string, ord?: string, listId = 'l1'): TaskItem =>
  ({ id, listId, text: id, who: [], due: null, done: false, ...(ord ? { ord } : {}) });

describe('byOrd', () => {
  it('trie par clé puis identifiant, une tâche sans clé en dernier', () => {
    const items = [t('c', 'a2'), t('sans'), t('a', 'a0'), t('b', 'a1')];
    assert.deepEqual([...items].sort(byOrd).map((x) => x.id), ['a', 'b', 'c', 'sans']);
  });
  it('compare par point de code, pas en collation locale', () => {
    // « Z » (0x5A) précède « a » (0x61) : une clé de tête tombe bien avant « a0 ».
    assert.ok(byOrd(t('x', 'Zz'), t('y', 'a0')) < 0);
  });
});

describe('moveKey', () => {
  const base = [t('a', 'a0'), t('b', 'a1'), t('c', 'a2')];
  it('insère entre deux voisins', () => {
    const k = moveKey(base, 'c', { apres: 'a' })!;
    assert.ok('a0' < k && k < 'a1', `entre a0 et a1 : ${k}`);
  });
  it('place en tête et en fin', () => {
    assert.ok(moveKey(base, 'c', { position: 'debut' })! < 'a0');
    assert.ok(moveKey(base, 'a', { position: 'fin' })! > 'a2');
  });
  it('rend null quand c’est sans objet : déjà en place, autre liste, référence absente, terminée', () => {
    assert.equal(moveKey(base, 'b', { apres: 'a' }), null, 'b est déjà après a');
    assert.equal(moveKey([...base, t('x', 'b0', 'l2')], 'a', { avant: 'x' }), null, 'autre liste');
    assert.equal(moveKey(base, 'a', { apres: 'fantome' }), null, 'référence absente');
    assert.equal(moveKey([t('a', 'a0'), { ...t('b', 'a1'), done: true }], 'b', { position: 'debut' }), null, 'terminée');
  });
});

describe('singleMove', () => {
  it('déduit la tâche remontée et ce qu’elle suit', () => {
    assert.deepEqual(singleMove(['a', 'b', 'c'], ['c', 'a', 'b']), { id: 'c', position: 'debut' });
    assert.deepEqual(singleMove(['a', 'b', 'c'], ['a', 'c', 'b']), { id: 'c', apres: 'a' });
    assert.deepEqual(singleMove(['a', 'b', 'c'], ['b', 'c', 'a']), { id: 'a', apres: 'c' });
  });
  it('rend null quand rien n’a bougé', () => {
    assert.equal(singleMove(['a', 'b', 'c'], ['a', 'b', 'c']), null);
  });
});

describe('applyTaskOp : move optimiste et son inverse', () => {
  it('applique un déplacement à l’écran, et l’annulation remet la clé d’avant', () => {
    const items = [t('a', 'a0'), t('b', 'a1'), t('c', 'a2')];
    const moved = applyTaskOp(items, { op: 'move', id: 'c', apres: 'a', opId: 'o1' });
    const c = moved.find((x) => x.id === 'c')!;
    assert.ok('a0' < c.ord! && c.ord! < 'a1', 'c glisse entre a et b');
    // L'annulation restitue la clé exacte d'avant.
    const inv = inverseOf({ op: 'move', id: 'c', apres: 'a' }, items.find((x) => x.id === 'c'));
    assert.deepEqual(inv, { op: 'edit', id: 'c', ord: 'a2' });
  });
  it('un ajout reçoit une clé de fin par défaut, une clé de tête sur demande', () => {
    const one = applyTaskOp([], { op: 'add', id: 'a', listId: 'l1', text: 'A', who: [], due: null, opId: 'o1' });
    assert.equal(typeof one[0].ord, 'string');
    const tete = applyTaskOp(one, { op: 'add', id: 'b', listId: 'l1', text: 'B', who: [], due: null, position: 'debut', opId: 'o2' });
    const b = tete.find((x) => x.id === 'b')!;
    assert.ok(b.ord! < one[0].ord!, 'la tâche créée en tête passe avant la première');
  });
});
