// La recherche de logo : ce que le parseur retient d'une réponse d'autocomplétion,
// et le garde qui évite une requête inutile.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLogoCandidates, searchLogos } from '../src/logos';

describe('parseLogoCandidates', () => {
  it('retient nom et domaine, dédupliqués par domaine et bornés', () => {
    const json = [
      { name: 'Carrefour', domain: 'carrefour.fr' },
      { name: 'Carrefour Banque', domain: 'carrefour-banque.fr' },
      { name: 'Carrefour', domain: 'carrefour.fr' }, // doublon de domaine
      { name: 'Carrefour', domain: 'carrefour.com' },
    ];
    assert.deepEqual(parseLogoCandidates(json, 2), [
      { name: 'Carrefour', domain: 'carrefour.fr' },
      { name: 'Carrefour Banque', domain: 'carrefour-banque.fr' },
    ]);
    assert.equal(parseLogoCandidates(json).length, 3, 'le doublon de domaine est retiré');
  });

  it('écarte ce qui n’est pas un domaine, et retombe sur le domaine si le nom manque', () => {
    const json = [
      { name: 'Sans domaine' },
      { name: 'Chemin', domain: 'exemple.fr/logo' },
      { name: 'Port', domain: 'exemple.fr:8080' },
      { domain: 'fnac.com' },
    ];
    assert.deepEqual(parseLogoCandidates(json), [{ name: 'fnac.com', domain: 'fnac.com' }]);
  });

  it('résiste à une réponse malformée', () => {
    for (const bad of [null, {}, 'texte', [null, 42, { domain: 42 }]]) {
      assert.deepEqual(parseLogoCandidates(bad), []);
    }
  });
});

describe('searchLogos', () => {
  it('ne sort pas sous deux caractères (aucune requête)', async () => {
    for (const n of ['', ' ', 'a', '  x ']) assert.deepEqual(await searchLogos(n), []);
  });
});
