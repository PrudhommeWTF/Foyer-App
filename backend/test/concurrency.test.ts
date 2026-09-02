// Le contrôle de version du document du foyer.
//
// Ce qui est en jeu : à deux sur l'application, une écriture partie d'un
// document périmé effaçait le travail de l'autre sans un mot. Ces tests fixent
// le seul comportement acceptable, y compris pour un client qui ignore encore
// le mécanisme.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conflictOf, isUpToDate } from '../src/state/concurrency';

describe('isUpToDate', () => {
  it('accepte une écriture partie de la version courante', () => {
    assert.equal(isUpToDate(7, 7), true);
  });

  it('refuse une écriture partie d’une version périmée', () => {
    assert.equal(isUpToDate(6, 7), false);
  });

  it('accepte une version absente : un onglet d’avant la mise à jour n’est pas bloqué', () => {
    assert.equal(isUpToDate(undefined, 7), true);
    assert.equal(isUpToDate(null, 7), true);
  });

  it('accepte ce qui n’est pas un nombre plutôt que de bloquer sur une valeur douteuse', () => {
    assert.equal(isUpToDate('7', 7), true);
    assert.equal(isUpToDate(NaN, 7), true);
  });

  it('accepte une version en avance : elle ne peut venir que de ce serveur', () => {
    // Le cas n'arrive qu'après une restauration de sauvegarde, où la base repart
    // en arrière. Refuser condamnerait alors le client jusqu'au rechargement.
    assert.equal(isUpToDate(9, 7), true);
  });
});

describe('conflictOf', () => {
  it('rend la version courante et son document, pour un rejeu sans second appel', () => {
    const c = conflictOf({ state: { familyName: 'Dupont' }, version: 12 });
    assert.equal(c.version, 12);
    assert.deepEqual(c.state, { familyName: 'Dupont' });
    assert.match(c.error, /enregistré entre-temps/);
  });
});
