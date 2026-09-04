// Le document gardé pour un démarrage hors ligne. Ce qui compte ici : ne jamais
// évincer les files d'attente pour un confort d'affichage, et ne jamais rendre
// un document à moitié écrit comme s'il était bon.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CachedDoc, MAX_DOC_BYTES, byteSize, packDoc, readDoc, staleLabel } from './offline-doc';

const doc = { familyName: 'Prudhomme', tasks: [{ id: 't1' }] };

test('un document se met en forme avec sa version et sa date, et se relit à l’identique', () => {
  const raw = packDoc(doc, 42, '2026-09-04T14:12:00.000Z')!;
  const relu = readDoc<typeof doc>(raw);
  assert.deepEqual(relu, { state: doc, version: 42, at: '2026-09-04T14:12:00.000Z' });
});

test('un document trop gros n’est pas gardé : une coche en attente vaut mieux qu’un démarrage rapide', () => {
  const enorme = { note: 'x'.repeat(MAX_DOC_BYTES) };
  assert.equal(packDoc(enorme, 1, '2026-09-04T14:12:00.000Z'), null);
  // Juste en dessous, il passe : la borne ne rejette pas tout par précaution.
  assert.notEqual(packDoc({ note: 'x'.repeat(1000) }, 1, '2026-09-04T14:12:00.000Z'), null);
});

test('un document impossible à sérialiser ne fait pas tomber l’enregistrement', () => {
  const cyclique: Record<string, unknown> = {};
  cyclique['moi'] = cyclique;
  assert.equal(packDoc(cyclique, 1, '2026-09-04T14:12:00.000Z'), null);
});

test('rien, du charabia, ou une forme incomplète : on repart du réseau plutôt que de deviner', () => {
  assert.equal(readDoc(null), null);
  assert.equal(readDoc(''), null);
  assert.equal(readDoc('{ pas du json'), null);
  assert.equal(readDoc('"une chaîne"'), null);
  assert.equal(readDoc(JSON.stringify({ version: 1, at: 'x' })), null, 'sans document');
  assert.equal(readDoc(JSON.stringify({ state: doc, at: 'x' })), null, 'sans version');
  assert.equal(readDoc(JSON.stringify({ state: doc, version: 1 })), null, 'sans date');
  assert.equal(readDoc(JSON.stringify({ state: doc, version: 'trois', at: 'x' })), null, 'version illisible');
  assert.equal(readDoc(JSON.stringify({ state: doc, version: 1, at: '' })), null, 'date vide');
});

test('la version zéro est une version : un foyer neuf se garde comme les autres', () => {
  const relu = readDoc<typeof doc>(packDoc(doc, 0, '2026-09-04T14:12:00.000Z')!);
  assert.equal((relu as CachedDoc<typeof doc>).version, 0);
});

test('la taille se compte en octets, pas en caractères : les accents pèsent double', () => {
  assert.equal(byteSize('abc'), 3);
  assert.equal(byteSize('éàü'), 6);
});

test('le libellé dit de quand date ce qui est à l’écran, et se tait sur une date illisible', () => {
  const fmt = (iso: string): string => iso.split('-').reverse().join('/');
  assert.match(staleLabel('2026-09-04T14:12:00.000Z', fmt), /^le 04\/09\/2026 à \d{2}:\d{2}$/);
  assert.equal(staleLabel('pas une date', fmt), '');
});
