import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resumeLine, roomLine, weekLine } from './atelier';

describe('Atelier code : ce que dit l’accueil', () => {
  it('un enfant reprend son dernier projet, ou la tuile se tait', () => {
    assert.equal(resumeLine({ name: 'Le robot' }), 'Reprendre : Le robot');
    assert.equal(resumeLine(null), '');
  });

  it('un adulte lit qui a travaillé cette semaine, jamais qui n’a rien fait', () => {
    assert.equal(weekLine([{ name: 'Raphaël', recents: 2 }, { name: 'Gaëtan', recents: 0 }]), 'Raphaël a travaillé sur 2 projets cette semaine');
    assert.equal(weekLine([{ name: 'Raphaël', recents: 1 }, { name: 'Gaëtan', recents: 3 }]), 'Raphaël a travaillé sur 1 projet cette semaine, Gaëtan a travaillé sur 3 projets cette semaine');
    assert.equal(weekLine([{ name: 'Gaëtan', recents: 0 }]), '');
    assert.equal(weekLine([]), '');
  });

  it('la place utilisée se lit en mégaoctets', () => {
    assert.equal(roomLine(0, 500), '0,0 Mo sur 500');
    assert.equal(roomLine(2.6 * 1048576, 500), '2,6 Mo sur 500');
    assert.equal(roomLine(123.4 * 1048576, 500), '123 Mo sur 500');
  });
});
