// Une mise à jour qui ne finit pas ne doit pas condamner l'application.
//
// Le fichier d'état est écrit par deux mains, et rien ne le nettoie si le script
// s'arrête en route. L'interface, elle, remplace ses deux boutons par « Mise à
// jour en cours… » tant qu'il vaut « running » : sans péremption, une coupure
// pendant une compilation bloque définitivement le seul moyen de mettre à jour.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UPDATE_STALE_MS, freshStatus, sinceLabel } from '../src/update-status';

const NOW = Date.parse('2026-09-02T18:00:00Z');
const LOG = '/var/lib/foyer/update.log';

describe('freshStatus', () => {
  it('laisse passer une mise à jour qui progresse', () => {
    const s = { state: 'running', message: 'Compilation du frontend…', ts: NOW - 60_000 };
    assert.deepEqual(freshStatus(s, NOW, LOG), s);
  });

  it('laisse passer jusqu’au délai, une étape lente restant une étape', () => {
    const s = { state: 'running', message: 'Installation…', ts: NOW - UPDATE_STALE_MS };
    assert.equal(freshStatus(s, NOW, LOG).state, 'running');
  });

  it('déclare interrompue une mise à jour sans nouvelles', () => {
    const s = { state: 'running', message: 'Compilation du backend…', ts: NOW - UPDATE_STALE_MS - 1000 };
    const out = freshStatus(s, NOW, LOG);
    assert.equal(out.state, 'error');
    assert.match(out.message!, /interrompue/);
    assert.match(out.message!, /update\.log/, 'le message nomme le journal à lire');
  });

  it('déclare interrompue une mise à jour sans horodatage', () => {
    // Format antérieur : la mise à jour qu'il décrivait est terminée depuis longtemps.
    assert.equal(freshStatus({ state: 'running', message: 'x' }, NOW, LOG).state, 'error');
  });

  it('ne touche pas aux états terminaux', () => {
    for (const state of ['done', 'error', 'idle']) {
      const s = { state, message: 'peu importe', ts: 0 };
      assert.deepEqual(freshStatus(s, NOW, LOG), s, state);
    }
  });

  it('dit depuis quand, dans une unité lisible', () => {
    const depuis = (min: number) => freshStatus({ state: 'running', ts: NOW - min * 60_000 }, NOW, LOG).message!;
    assert.match(depuis(90), /90 minutes/);
    assert.match(depuis(5 * 60), /5 heures/);
    assert.match(depuis(6 * 24 * 60), /6 jours/);
    // Un fichier sans horodatage ne peut pas prétendre à une durée.
    assert.match(freshStatus({ state: 'running' }, NOW, LOG).message!, /un long moment/);
  });
});

describe('sinceLabel', () => {
  it('accorde le singulier', () => assert.equal(sinceLabel(60_000), '1 minute'));
  it('passe aux heures après deux heures', () => assert.equal(sinceLabel(119 * 60_000), '119 minutes'));
  it('passe aux jours après deux jours', () => assert.equal(sinceLabel(49 * 3600_000), '2 jours'));
});
