// L'autocomplétion de lieu : ce que le parseur retient d'une réponse BAN, et le
// garde qui évite une requête inutile.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBanLabels, suggestPlaces } from '../src/places';

describe('parseBanLabels', () => {
  it('retient les libellés, dédupliqués et bornés', () => {
    const json = { features: [
      { properties: { label: '12 Rue des Lilas 59000 Lille' } },
      { properties: { label: 'Salle des fêtes, Lille' } },
      { properties: { label: '12 Rue des Lilas 59000 Lille' } }, // doublon
      { properties: { label: 'Place de la République, Lille' } },
    ] };
    assert.deepEqual(parseBanLabels(json, 2), ['12 Rue des Lilas 59000 Lille', 'Salle des fêtes, Lille']);
    assert.equal(parseBanLabels(json).length, 3, 'le doublon est retiré');
  });

  it('résiste à une réponse malformée', () => {
    for (const bad of [null, {}, { features: null }, { features: [{}, { properties: {} }, { properties: { label: 42 } }] }]) {
      assert.deepEqual(parseBanLabels(bad), []);
    }
  });
});

describe('suggestPlaces', () => {
  it('ne sort pas sous trois caractères (aucune requête)', async () => {
    for (const q of ['', ' ', 'ab', '  a ']) assert.deepEqual(await suggestPlaces(q), []);
  });
});
