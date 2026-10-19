// Les files hors ligne rangées par membre : une file ne repart que sous la
// session qui l'a remplie, et l'ancienne file sans membre est reprise une fois.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { KeyStore, adoptQueue, queueKey, readOwner, readQueue, writeOwner, writeQueue } from './op-queues';

const memoire = (): KeyStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
};
const op = (opId: string) => ({ opId });

test('chaque membre a sa file, et celle d’un autre ne se lit pas', () => {
  const s = memoire();
  writeQueue(s, 'foyer.taskQueue', 'nolw', [op('a')]);
  writeQueue(s, 'foyer.taskQueue', 'raph', [op('b')]);
  assert.deepEqual(readQueue(s, 'foyer.taskQueue', 'nolw'), [op('a')]);
  assert.deepEqual(readQueue(s, 'foyer.taskQueue', 'raph'), [op('b')]);
  assert.equal(queueKey('foyer.taskQueue', 'raph'), 'foyer.taskQueue.raph');
});

test('une file vidée ne laisse pas de clé derrière elle', () => {
  const s = memoire();
  writeQueue(s, 'foyer.shopQueue', 'nolw', [op('a')]);
  writeQueue(s, 'foyer.shopQueue', 'nolw', []);
  assert.equal(s.map.size, 0);
});

test('l’ancienne file sans membre rejoint celle du premier membre qui se présente, une seule fois', () => {
  const s = memoire();
  s.setItem('foyer.taskQueue', JSON.stringify([op('ancien'), op('commun')]));
  writeQueue(s, 'foyer.taskQueue', 'nolw', [op('commun'), op('neuf')]);
  assert.deepEqual(adoptQueue(s, 'foyer.taskQueue', 'nolw'), [op('ancien'), op('commun'), op('neuf')]);
  assert.equal(s.getItem('foyer.taskQueue'), null, 'l’ancienne clé disparaît');
  // Le membre suivant ne récupère rien de la file d'avant.
  assert.deepEqual(adoptQueue(s, 'foyer.taskQueue', 'raph'), []);
});

test('un contenu abîmé ou absent donne une file vide, pas une erreur', () => {
  const s = memoire();
  s.setItem('foyer.placeQueue.nolw', '{pas du json');
  assert.deepEqual(readQueue(s, 'foyer.placeQueue', 'nolw'), []);
  assert.deepEqual(readQueue(null, 'foyer.placeQueue', 'nolw'), []);
});

test('le propriétaire est retenu pour un démarrage hors ligne', () => {
  const s = memoire();
  assert.equal(readOwner(s), null);
  writeOwner(s, 'raph');
  assert.equal(readOwner(s), 'raph');
});
