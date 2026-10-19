// Le journal des sessions d'enfant, en mots : qui, quand (heure de Paris),
// sur quel appareil, et comment la session s'est refermée.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SwitchEntry } from './api.service';
import { quand, switchLine, switchState } from './switch-log';

const base: SwitchEntry = {
  id: 1, by: 'nolw', byName: 'Nolwenn', device: 'iPad', startedAt: '2026-10-19T16:42:00.000Z',
  endedAt: null, endReason: null, endedBy: null, open: true,
};
const nom = (id: string | null) => (id === 'nolw' ? 'Nolwenn' : id === 'thom' ? 'Thomas' : 'quelqu’un');

test('l’heure est celle de Paris, été comme hiver', () => {
  assert.equal(quand('2026-10-19T16:42:00.000Z'), 'le 19/10 à 18 h 42');
  assert.equal(quand('2026-12-03T07:05:00.000Z'), 'le 03/12 à 08 h 05');
});

test('la ligne dit qui, quand et sur quel appareil', () => {
  assert.equal(switchLine(base), 'Session ouverte par Nolwenn le 19/10 à 18 h 42 sur iPad');
});

test('l’état dit si elle est ouverte, et sinon comment elle s’est refermée', () => {
  assert.equal(switchState(base, nom), 'Toujours ouverte');
  const fin = { ...base, open: false, endedAt: '2026-10-19T17:10:00.000Z' };
  assert.equal(switchState({ ...fin, endReason: 'retour', endedBy: 'nolw' }, nom), 'Refermée le 19/10 à 19 h 10 : retour de Nolwenn');
  assert.equal(switchState({ ...fin, endReason: 'deconnexion' }, nom), 'Refermée le 19/10 à 19 h 10 : déconnexion');
  assert.equal(switchState({ ...fin, endReason: 'fermee', endedBy: 'thom' }, nom), 'Fermée à distance par Thomas le 19/10 à 19 h 10');
  assert.equal(switchState({ ...base, open: false }, nom), 'Session expirée');
});
