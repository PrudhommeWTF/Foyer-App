// La journalisation du service.
//
// Ce qui compte : baisser le niveau doit **taire** ce qui n'est pas une erreur,
// et une erreur doit sortir quoi qu'il arrive. Un journal qu'on ne peut pas
// calmer finit ignoré ; un journal qui avale les erreurs est pire que pas de
// journal du tout.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { LogLevel, log, setLogLevelSource } from '../src/log';

let sortie: string[];
let erreurs: string[];
let vraiLog: typeof console.log;
let vraiErr: typeof console.error;

const capture = (): void => {
  sortie = []; erreurs = [];
  vraiLog = console.log; vraiErr = console.error;
  console.log = (l: string) => { sortie.push(l); };
  console.error = (l: string) => { erreurs.push(l); };
};

beforeEach(capture);
afterEach(() => { console.log = vraiLog; console.error = vraiErr; setLogLevelSource(() => 'info'); });

const au = (n: LogLevel): void => setLogLevelSource(() => n);

describe('niveaux', () => {
  it('au niveau normal : info et attention passent, debug non', () => {
    au('info');
    log.info('fait'); log.attention('bizarre'); log.debug('détail');
    assert.deepEqual(sortie, ['[foyer] fait']);
    assert.deepEqual(erreurs, ['[foyer] bizarre']);
  });

  it('au niveau « erreurs seulement » : seule l’erreur sort', () => {
    au('erreur');
    log.info('fait'); log.attention('bizarre'); log.debug('détail'); log.erreur('cassé');
    assert.deepEqual(sortie, []);
    assert.deepEqual(erreurs, ['[foyer] cassé']);
  });

  it('au niveau détaillé : tout sort', () => {
    au('debug');
    log.info('fait'); log.debug('détail');
    assert.deepEqual(sortie, ['[foyer] fait', '[foyer] détail']);
  });

  it('une erreur sort à tous les niveaux, sans exception', () => {
    for (const n of ['erreur', 'info', 'debug'] as LogLevel[]) {
      capture(); au(n);
      log.erreur('cassé');
      assert.deepEqual(erreurs, ['[foyer] cassé'], n);
    }
  });
});

describe('robustesse', () => {
  it('une erreur jointe est recopiée dans la ligne', () => {
    au('info');
    log.erreur('sauvegarde impossible', new Error('disque plein'));
    assert.deepEqual(erreurs, ['[foyer] sauvegarde impossible : disque plein']);
  });

  it('un niveau illisible retombe sur « normal » plutôt que de tout taire', () => {
    setLogLevelSource(() => 'n’importe quoi' as LogLevel);
    log.info('fait');
    assert.deepEqual(sortie, ['[foyer] fait']);
  });

  it('une source qui lève ne fait pas échouer la ligne à journaliser', () => {
    setLogLevelSource(() => { throw new Error('base pas encore ouverte'); });
    log.info('démarrage');
    assert.deepEqual(sortie, ['[foyer] démarrage']);
  });
});
