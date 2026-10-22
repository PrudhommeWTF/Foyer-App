// Les pièces de la maison : le nom accepté (pas de doublon, à la création comme
// au renommage) et ce qu'une pièce contient, dit avant de la supprimer.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { roomNameCheck, roomUsage, usageLabel } from './rooms';

const rooms = [{ id: 'p1', name: 'Cuisine', position: 0 }, { id: 'p2', name: 'Chambre 1', position: 1 }, { id: 'p3', name: 'Garage', position: 2 }];

describe('Pièces : nom accepté', () => {
  it('refuse un doublon (casse et accents ignorés), à la création comme au renommage', () => {
    assert.deepEqual(roomNameCheck(rooms, '  cuisine '), { ok: false, error: 'La pièce « Cuisine » existe déjà.' });
    assert.equal(roomNameCheck(rooms, 'Chambre 1', 'p3').ok, false, 'renommer le garage en « Chambre 1 » est refusé');
    assert.deepEqual(roomNameCheck(rooms, 'CHAMBRE 1', 'p2'), { ok: true, name: 'CHAMBRE 1' }, 'changer la casse de sa propre pièce passe');
    assert.deepEqual(roomNameCheck(rooms, 'Chambre  de   Nolan', 'p2'), { ok: true, name: 'Chambre de Nolan' }, 'espaces resserrés');
  });
  it('refuse un nom vide ou trop long', () => {
    assert.equal(roomNameCheck(rooms, '   ').ok, false);
    assert.equal(roomNameCheck(rooms, 'x'.repeat(61)).ok, false);
  });
});

describe('Pièces : ce qu’elles contiennent', () => {
  it('compte les appareils non archivés et les gestes en cours, pièce par pièce', () => {
    const u = roomUsage(rooms,
      [{ roomId: 'p1' }, { roomId: 'p1' }, { roomId: 'p1', archivedAt: '2026-01-01' }, { roomId: 'p3' }, { roomId: null }, { roomId: 'inconnue' }],
      [{ maintenance: { roomId: 'p1' } }, { done: true, maintenance: { roomId: 'p1' } }, { maintenance: { roomId: 'p2' } }, { maintenance: null }]);
    assert.deepEqual(u.get('p1'), { equipements: 2, gestes: 1 });
    assert.deepEqual(u.get('p2'), { equipements: 0, gestes: 1 });
    assert.equal(usageLabel(u.get('p1')), '2 appareils et 1 geste d’entretien');
    assert.equal(usageLabel(u.get('p3')), '1 appareil');
    assert.equal(usageLabel({ equipements: 0, gestes: 0 }), '', 'une pièce vide ne demande pas de confirmation');
  });
});
