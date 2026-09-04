// Le stockage des mots de passe : ce qu'on range, et à quel prix.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COUT, aRehacher, hacher, verifier } from '../src/auth/passwords';

describe('un mot de passe se range haché, salé, et coûteux', () => {
  it('le condensat porte bcrypt et le coût courant', async () => {
    const h = await hacher('un mot de passe de famille');
    assert.match(h, /^\$2[aby]\$12\$/, `coût attendu ${COUT}`);
  });

  it('deux fois le même mot de passe donnent deux condensats : le sel fait son travail', async () => {
    const [a, b] = await Promise.all([hacher('identique'), hacher('identique')]);
    assert.notEqual(a, b);
    assert.equal(await verifier('identique', a), true);
    assert.equal(await verifier('identique', b), true);
  });

  it('un mauvais mot de passe ne passe pas', async () => {
    const h = await hacher('le bon');
    assert.equal(await verifier('le mauvais', h), false);
    assert.equal(await verifier('', h), false);
  });

  it('le coût est au moins douze : dix est bas pour aujourd’hui', () => {
    assert.ok(COUT >= 12, 'monter le coût multiplie le travail d’un attaquant qui aurait la base');
  });
});

describe('les condensats d’hier restent valides, et se remettent à niveau', () => {
  it('un condensat de coût inférieur se vérifie toujours', async () => {
    // Un vrai condensat bcrypt de « secret », calculé à coût 10.
    const vieux = '$2a$10$fl2HGU1galH5Vqzl1y8UUOExqUioYJWMYn2blcOnuTz9s2gmzBut.';
    assert.equal(await verifier('secret', vieux), true, 'personne ne doit se retrouver dehors');
  });

  it('mais il est signalé comme à refaire', () => {
    assert.equal(aRehacher('$2a$10$fl2HGU1galH5Vqzl1y8UUOExqUioYJWMYn2blcOnuTz9s2gmzBut.'), true);
  });

  it('un condensat au coût courant n’est pas refait pour rien', async () => {
    assert.equal(aRehacher(await hacher('déjà bien rangé')), false);
  });

  it('ce qui n’est pas un condensat bcrypt n’est pas touché', () => {
    for (const v of ['', 'pas-un-condensat', 'md5:0123456789abcdef']) assert.equal(aRehacher(v), false, v);
  });
});

describe('le hachage rend la main', () => {
  it('deux hachages simultanés progressent ensemble', async () => {
    // La version synchrone tenait la boucle d'événements pendant tout le calcul :
    // sur une route publique, quelques appels figeaient l'application. Ici, un
    // minuteur posé avant les hachages doit se déclencher pendant qu'ils tournent.
    let tickPasse = false;
    const tick = new Promise<void>((r) => setTimeout(() => { tickPasse = true; r(); }, 5));
    await Promise.all([hacher('un'), hacher('deux'), tick]);
    assert.equal(tickPasse, true, 'la boucle d’événements doit rester vivante pendant un hachage');
  });
});
