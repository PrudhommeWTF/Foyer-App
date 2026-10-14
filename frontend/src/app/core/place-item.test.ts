// Les fiches des lieux : enregistrer sans rien toucher n'envoie rien, une
// modification n'envoie que ce qui change, une affaire supprimée se remet.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Place, PlaceItem } from './models';
import { placeFields, placeItemFields, placeItemOps, placeItemRestoreOps, placeOps } from './place-item';

const chalet: Place = { id: 'l1', name: 'Chalet', color: '#4E93B8', icon: 'voyage', position: 0, note: 'Code 1234' };
const skis: PlaceItem = { id: 'pi1', placeId: 'l1', name: 'Skis', qty: 'x2', state: 'ici', by: 'me', at: '2026-10-14T10:00:00Z' };

test('lieu ouvert puis enregistré tel quel : aucune opération', () => {
  assert.deepEqual(placeOps('l1', chalet, placeFields(chalet)), []);
  assert.deepEqual(placeOps('l1', { ...chalet, note: null, icon: '' }, placeFields({ ...chalet, note: null, icon: '' })), []);
});

test('lieu : seuls les champs changés partent, une note vidée compris', () => {
  assert.deepEqual(placeOps('l1', chalet, { ...placeFields(chalet), note: ' ' }), [{ op: 'place-edit', id: 'l1', note: '' }]);
  assert.deepEqual(placeOps('l2', null, { name: ' Mobil-home ', note: '', color: '#7A9B76', icon: 'voyage' }),
    [{ op: 'place-add', id: 'l2', name: 'Mobil-home', color: '#7A9B76', icon: 'voyage' }]);
});

test('affaire : rien de changé, rien n’est envoyé ; un déplacement de lieu part seul', () => {
  assert.deepEqual(placeItemOps(skis, placeItemFields(skis)), []);
  assert.deepEqual(placeItemOps(skis, { ...placeItemFields(skis), placeId: 'l2' }), [{ op: 'edit', id: 'pi1', placeId: 'l2' }]);
});

test('une affaire supprimée revient à l’identique, état compris', () => {
  assert.deepEqual(placeItemRestoreOps(skis), [{ op: 'add', id: 'pi1', placeId: 'l1', name: 'Skis', qty: 'x2', state: 'ici' }]);
});
