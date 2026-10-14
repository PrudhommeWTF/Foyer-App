// La fiche d'un article : enregistrer sans rien toucher n'envoie rien, une
// modification n'envoie que ce qui change, une suppression se défait.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ShopItem } from './models';
import { shopFields, shopOps, shopRestoreOps } from './shop-item';

const lait: ShopItem = { id: 's1', name: 'Lait', qty: 'x2', aisleId: 'a1', state: 'panier', listId: 'l1', by: 'me', at: '2026-10-14T10:00:00Z', photoId: 7 };
const def = { aisleId: 'a9', listId: 'l1' };

test('ouvert puis enregistré tel quel : aucune opération', () => {
  assert.deepEqual(shopOps('s1', lait, shopFields(lait, def)), []);
});

test('une modification n’envoie que les champs changés, et l’état à part', () => {
  const f = { ...shopFields(lait, def), qty: ' x3 ', state: 'a-prendre' as const };
  assert.deepEqual(shopOps('s1', lait, f), [{ op: 'edit', id: 's1', qty: 'x3' }, { op: 'set-state', id: 's1', state: 'a-prendre' }]);
  assert.deepEqual(shopOps('s1', lait, { ...shopFields(lait, def), photoId: null }), [{ op: 'edit', id: 's1', photoId: null }]);
});

test('une création part dans la liste et le rayon par défaut, à prendre', () => {
  const f = { ...shopFields(null, def), name: ' Pain ' };
  assert.deepEqual(shopOps('s2', null, f), [{ op: 'add', id: 's2', name: 'Pain', qty: '', aisleId: 'a9', listId: 'l1' }]);
});

test('remettre un article supprimé le rend tel qu’il était, photo et état compris', () => {
  assert.deepEqual(shopRestoreOps(lait), [
    { op: 'add', id: 's1', name: 'Lait', qty: 'x2', aisleId: 'a1', listId: 'l1', photoId: 7 },
    { op: 'set-state', id: 's1', state: 'panier' },
  ]);
});
