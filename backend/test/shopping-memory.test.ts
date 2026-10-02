// La mémoire d'achats, module pur : la clé qui regroupe les libellés, et
// l'élagage qui l'empêche d'enfler sans fin.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ShopMemory, memoryKey, normaliseName, pruneMemory } from '../src/shopping/memory';

test('normaliseName rapproche casse, accents et ponctuation', () => {
  assert.equal(normaliseName('Lait'), 'lait');
  assert.equal(normaliseName('LAIT'), 'lait');
  assert.equal(normaliseName('  Pâtes   fraîches '), 'pates fraiches');
  assert.equal(normaliseName("Pain d'épices"), "pain d'epices");
});

test('memoryKey : clé d’article si connue, sinon nom normalisé', () => {
  assert.equal(memoryKey({ art: 'lait', name: 'Lait demi-écrémé' }), 'lait');
  assert.equal(memoryKey({ art: null, name: 'Sauce tomate' }), 'sauce tomate');
  assert.equal(memoryKey({ name: 'Pistaches' }), 'pistaches');
  assert.equal(memoryKey({ name: '   ' }), '', 'rien d’exploitable : clé vide');
});

const entry = (lastAt: string, over: Record<string, unknown> = {}) => ({ name: 'x', count: 1, lastAt, ...over });

test('pruneMemory retire les entrées de plus de douze mois', () => {
  const now = Date.parse('2026-10-02T00:00:00.000Z');
  const mem: ShopMemory = {
    recent: entry('2026-09-01T00:00:00.000Z'),
    vieux: entry('2025-01-01T00:00:00.000Z'),
  };
  const out = pruneMemory(mem, now);
  assert.ok(out['recent'], 'le récent reste');
  assert.equal(out['vieux'], undefined, 'le vieux part');
});

test('pruneMemory borne la table aux plus récentes', () => {
  const now = Date.parse('2026-10-02T00:00:00.000Z');
  const mem: ShopMemory = {};
  // 600 entrées, toutes dans l'année : seules les 500 plus récentes survivent.
  for (let i = 0; i < 600; i++) {
    const d = new Date(now - i * 60_000).toISOString();
    mem['k' + i] = entry(d);
  }
  const out = pruneMemory(mem, now);
  assert.equal(Object.keys(out).length, 500);
  assert.ok(out['k0'], 'la plus récente est gardée');
  assert.equal(out['k599'], undefined, 'la plus ancienne est écartée');
});

test('pruneMemory ne réécrit rien quand tout est frais et sous la borne', () => {
  const now = Date.parse('2026-10-02T00:00:00.000Z');
  const mem: ShopMemory = { a: entry('2026-09-01T00:00:00.000Z'), b: entry('2026-09-15T00:00:00.000Z') };
  assert.equal(pruneMemory(mem, now), mem, 'même référence : pas d’écriture inutile');
});

test('une date illisible ne fait pas disparaître l’entrée en silence', () => {
  const now = Date.parse('2026-10-02T00:00:00.000Z');
  const mem: ShopMemory = { casse: entry('pas-une-date') };
  assert.ok(pruneMemory(mem, now)['casse'], 'gardée plutôt qu’effacée sans trace');
});
