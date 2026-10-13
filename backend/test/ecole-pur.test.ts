// Module École, ce qui se teste sans base ni réseau : la proposition
// d'association élève / membre, la cadence des synchronisations, et le
// chiffrement des identifiants.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { propose } from '../src/ecole/match';
import { Cadence, inQuietWindow, isDue, mayRun, nextRunAt } from '../src/ecole/cadence';
import { keyState, open, seal } from '../src/storage/secret-box';

const MEMBRES = [
  { id: 'm-thomas', name: 'Thomas' },
  { id: 'm-nolan', name: 'Nolan', enfant: true },
  { id: 'm-leo', name: 'Léo', enfant: true },
];

describe('École : proposition d’association', () => {
  it('prénom sans accents ni casse', () => {
    assert.deepEqual(propose('LEO', 'FAMILLE', MEMBRES, []), { memberId: 'm-leo', matchSource: 'prenom' });
    assert.deepEqual(propose('nolan', 'FAMILLE', MEMBRES, []), { memberId: 'm-nolan', matchSource: 'prenom' });
  });

  it('un prénom composé ne se devine pas', () => {
    assert.equal(propose('Nolan-Pierre', 'FAMILLE', MEMBRES, []), null);
  });

  it('le premier mot du nom du membre compte, et deux homonymes : on préfère l’enfant, sinon rien', () => {
    assert.deepEqual(propose('Nolan', 'X', [{ id: 'a', name: 'Nolan Prudhomme' }], []), { memberId: 'a', matchSource: 'prenom' });
    assert.deepEqual(propose('Nolan', 'X', [{ id: 'p', name: 'Nolan' }, { id: 'e', name: 'Nolan', enfant: true }], []), { memberId: 'e', matchSource: 'prenom' });
    assert.equal(propose('Nolan', 'X', [{ id: 'e1', name: 'Nolan', enfant: true }, { id: 'e2', name: 'nolan', enfant: true }], []), null);
  });

  it('à la rentrée, un choix manuel sous le même prénom et le même nom est repris', () => {
    const prior = [{ firstName: 'Nolan-Pierre', lastName: 'FAMILLE', memberId: 'm-nolan', matchSource: 'manuel' as const, linkState: 'confirme' }];
    assert.deepEqual(propose('Nolan-Pierre', 'Famille', MEMBRES, prior), { memberId: 'm-nolan', matchSource: 'manuel' });
    // Un ancien choix vers un membre disparu, ou jamais confirmé, ne compte pas.
    assert.equal(propose('Nolan-Pierre', 'FAMILLE', MEMBRES, [{ ...prior[0], memberId: 'm-parti' }]), null);
    assert.equal(propose('Nolan-Pierre', 'FAMILLE', MEMBRES, [{ ...prior[0], linkState: 'propose' }]), null);
  });
});

describe('École : cadence', () => {
  const C: Cadence = { refreshMin: 30, pauseFrom: '22:00', pauseTo: '06:00', sundayFrom: '16:00' };

  it('pause de nuit qui enjambe minuit, et dimanche matin', () => {
    assert.equal(inQuietWindow('2026-10-14T21:59', C), false);
    assert.equal(inQuietWindow('2026-10-14T22:00', C), true);
    assert.equal(inQuietWindow('2026-10-15T05:59', C), true);
    assert.equal(inQuietWindow('2026-10-15T06:00', C), false);
    assert.equal(inQuietWindow('2026-10-18T15:59', C), true, 'dimanche avant 16 h');
    assert.equal(inQuietWindow('2026-10-18T16:00', C), false);
    assert.equal(inQuietWindow('2026-10-18T03:00', { ...C, pauseFrom: '00:00', pauseTo: '00:00', sundayFrom: '00:00' }), false, 'bornes égales : aucune pause');
    assert.equal(inQuietWindow('2026-10-14T13:00', { ...C, pauseFrom: '12:00', pauseTo: '14:00' }), true, 'pause dans la journée');
  });

  it('intervalle, blocage, pause manuelle et pause automatique', () => {
    const now = new Date('2026-10-14T10:00:00Z');
    assert.equal(isDue(null, now, C), true);
    assert.equal(isDue('2026-10-14T09:31:00Z', now, C), false);
    assert.equal(isDue('2026-10-14T09:30:00Z', now, C), true);
    const ok = { enabled: true, blocked: null, pausedUntil: null, archivedAt: null };
    assert.equal(mayRun(ok, now), true);
    assert.equal(mayRun({ ...ok, blocked: 'qcm' as const }, now), false, 'question en attente : rien ne part');
    assert.equal(mayRun({ ...ok, enabled: false }, now), false);
    assert.equal(mayRun({ ...ok, pausedUntil: '2026-10-14T15:00:00Z' }, now), false);
    assert.equal(mayRun({ ...ok, pausedUntil: '2026-10-14T09:00:00Z' }, now), true);
  });

  it('prochain passage : après l’intervalle, repoussé à la fin de la pause de nuit', () => {
    const base = { enabled: true, blocked: null, pausedUntil: null, archivedAt: null };
    // 10:00 Paris (08:00Z), dernière tentative 09:50 Paris : 10:20 Paris.
    assert.equal(nextRunAt({ ...base, lastSyncAt: '2026-10-14T07:50:00Z' }, new Date('2026-10-14T08:00:00Z'), C), '2026-10-14T08:20:00.000Z');
    // 21:50 Paris : la suivante tomberait à 22:20, elle attend 06:00 Paris (04:00Z).
    assert.equal(nextRunAt({ ...base, lastSyncAt: '2026-10-14T19:50:00Z' }, new Date('2026-10-14T19:55:00Z'), C), '2026-10-15T04:00:00.000Z');
    // Samedi 21:50 Paris : la nuit, puis le dimanche matin, jusqu'à 16:00 Paris (14:00Z).
    assert.equal(nextRunAt({ ...base, lastSyncAt: '2026-10-17T19:50:00Z' }, new Date('2026-10-17T19:55:00Z'), C), '2026-10-18T14:00:00.000Z');
    assert.equal(nextRunAt({ ...base, blocked: 'identifiants' as const, lastSyncAt: null }, new Date(), C), null, 'bloqué : pas de prochain passage');
  });
});

describe('École : chiffrement des identifiants', () => {
  const avant = process.env.FOYER_SECRET_KEY;
  afterEach(() => { if (avant === undefined) delete process.env.FOYER_SECRET_KEY; else process.env.FOYER_SECRET_KEY = avant; });

  it('aller-retour, jamais en clair, et un sel neuf à chaque fois', () => {
    process.env.FOYER_SECRET_KEY = 'une-cle-de-test-de-plus-de-trente-deux-caracteres';
    assert.equal(keyState(), 'ok');
    const a = seal('mot de passe & 100%');
    assert.doesNotMatch(a, /mot de passe/);
    assert.notEqual(a, seal('mot de passe & 100%'));
    assert.equal(open(a), 'mot de passe & 100%');
  });

  it('clé changée ou absente : null, jamais une exception ; valeur altérée : null', () => {
    process.env.FOYER_SECRET_KEY = 'une-cle-de-test-de-plus-de-trente-deux-caracteres';
    const a = seal('secret');
    const parts = a.split('.');
    parts[4] = Buffer.from('autre chose').toString('base64url');
    assert.equal(open(parts.join('.')), null, 'altérée');
    process.env.FOYER_SECRET_KEY = 'une-autre-cle-de-test-de-plus-de-trente-deux-caracteres';
    assert.equal(open(a), null, 'autre clé');
    delete process.env.FOYER_SECRET_KEY;
    assert.equal(keyState(), 'absente');
    assert.equal(open(a), null, 'clé absente');
    assert.throws(() => seal('x'), /FOYER_SECRET_KEY/, 'on n’enregistre jamais en clair faute de clé');
    process.env.FOYER_SECRET_KEY = 'courte';
    assert.equal(keyState(), 'trop-courte');
    assert.throws(() => seal('x'), /au moins 32/);
  });
});
