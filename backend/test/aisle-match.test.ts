// Résolution tolérante d'un rayon depuis un texte libre (bug : « Frais » ou
// « fruits & legumes » ne correspondaient à rien, l'article tombait au repli et
// l'outil répondait quand même « ajouté »). On couvre la normalisation, la
// correspondance (reconnu / inconnu / ambigu) et le texte des deux échecs.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Aisle } from '../src/models';
import { normRayonText, matchAisle, nearestAisleNames, rayonFailureNote } from '../src/shopping/aisle-match';

/** Un extrait des rayons par défaut (seed.ts), repli compris. */
const AISLES: Aisle[] = [
  { id: 'a-repli', name: '📦 Non classé', color: '#000', position: 0 },
  { id: 'a-legumes', name: '🍎 Fruits & Légumes', color: '#000', position: 1, kind: 'legumes' },
  { id: 'a-viande', name: '🥩 Viande', color: '#000', position: 2, kind: 'viande' },
  { id: 'a-poisson', name: '🐟 Poissonnerie', color: '#000', position: 3 },
  { id: 'a-frais', name: '🥛 Frais', color: '#000', position: 5, kind: 'frais' },
  { id: 'a-surgele', name: '❄️ Surgelés', color: '#000', position: 6, kind: 'surgele' },
];

describe('normRayonText', () => {
  it('retire emoji, accents et casse', () => {
    assert.equal(normRayonText('🥛 Frais'), 'frais');
    assert.equal(normRayonText('FRAIS'), 'frais');
    assert.equal(normRayonText('Surgelés'), 'surgeles');
  });
  it('tolère « & », « et » et les espaces', () => {
    assert.equal(normRayonText('Fruits & Légumes'), 'fruits legumes');
    assert.equal(normRayonText('fruits et legumes'), 'fruits legumes');
    assert.equal(normRayonText('Fruits   Légumes'), 'fruits legumes');
  });
});

describe('matchAisle', () => {
  it('reconnaît le libellé, l’emoji, la casse et la variante & / et', () => {
    for (const q of ['Frais', '🥛 Frais', 'FRAIS', 'frais']) {
      const m = matchAisle(AISLES, q);
      assert.equal(m.kind, 'one', `« ${q} » devrait être reconnu`);
      assert.equal(m.kind === 'one' && m.aisle.id, 'a-frais');
    }
    for (const q of ['fruits et legumes', 'Fruits & Légumes', 'fruits legumes']) {
      const m = matchAisle(AISLES, q);
      assert.equal(m.kind === 'one' && m.aisle.id, 'a-legumes', `« ${q} » devrait viser les légumes`);
    }
  });
  it('reconnaît aussi par le type (kind) du rayon', () => {
    // « legumes » n'est pas dans le libellé « Fruits & Légumes », mais c'est le kind.
    const m = matchAisle(AISLES, 'legumes');
    assert.equal(m.kind === 'one' && m.aisle.id, 'a-legumes');
    const v = matchAisle(AISLES, 'viande');
    assert.equal(v.kind === 'one' && v.aisle.id, 'a-viande');
  });
  it('rend « none » pour un rayon inconnu', () => {
    assert.equal(matchAisle(AISLES, 'Fraix').kind, 'none');
    assert.equal(matchAisle(AISLES, '').kind, 'none');
  });
  it('rend « ambiguous » et ne choisit pas quand plusieurs correspondent', () => {
    // Deux rayons normalisent vers « frais » : le libellé « 🧀 Frais » et le kind
    // « frais » de « 🥛 Produits frais ».
    const ambigu: Aisle[] = [
      { id: 'a1', name: '🧀 Frais', color: '#000', position: 1 },
      { id: 'a2', name: '🥛 Produits frais', color: '#000', position: 2, kind: 'frais' },
    ];
    const m = matchAisle(ambigu, 'frais');
    assert.equal(m.kind, 'ambiguous');
    assert.deepEqual(m.kind === 'ambiguous' && m.aisles.map((a) => a.id), ['a1', 'a2']);
  });
});

describe('nearestAisleNames', () => {
  it('propose les libellés les plus proches, repli exclu', () => {
    const near = nearestAisleNames(AISLES, 'Fraix', 3, (a) => a.id === 'a-repli');
    assert.equal(near[0], '🥛 Frais', 'le plus proche de « Fraix »');
    assert.ok(!near.includes('📦 Non classé'), 'le repli n’est jamais suggéré');
    assert.ok(near.length <= 3);
  });
});

describe('rayonFailureNote', () => {
  it('dit « inconnu », le repli et les rayons possibles', () => {
    const note = rayonFailureNote('Fraix', 'inconnu', '📦 Non classé', ['🥛 Frais', '🐟 Poissonnerie', '🥩 Viande']);
    assert.equal(note, 'Rayon « Fraix » inconnu, article placé dans « 📦 Non classé ». Rayons possibles : 🥛 Frais, 🐟 Poissonnerie, 🥩 Viande.');
  });
  it('dit « ambigu » et liste les candidats', () => {
    const note = rayonFailureNote('frais', 'ambigu', '📦 Non classé', ['🧀 Frais', '🥛 Produits frais']);
    assert.equal(note, 'Rayon « frais » ambigu (plusieurs rayons correspondent), article placé dans « 📦 Non classé ». Rayons possibles : 🧀 Frais, 🥛 Produits frais.');
  });
  it('nomme les articles touchés dans un ajout groupé', () => {
    const note = rayonFailureNote('fraix', 'inconnu', '📦 Non classé', ['🥛 Frais'], ['chorizo', 'jambon']);
    assert.equal(note, 'Rayon « fraix » inconnu, chorizo, jambon placés dans « 📦 Non classé ». Rayons possibles : 🥛 Frais.');
  });
});
