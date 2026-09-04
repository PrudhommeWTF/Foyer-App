// Ce qu'un jeton doit prouver pour être accepté.
//
// Trois attaques classiques, dont deux qui ont vidé des applications entières :
// signer soi-même en déclarant `alg: none`, signer avec un secret à soi, et
// continuer à se servir d'un jeton après que son compte a été révoqué. Aucune ne
// doit passer, et ce fichier le vérifie sur les vraies routes.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { Contexte, SECRET, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('un jeton se vérifie, il ne se déclare pas', () => {
  it('alg=none est refusé, même avec une charge utile parfaite', async () => {
    const forge = b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ id: ctx.ids.admin, email: 'admin@example.fr', tv: 0 }) + '.';
    const r = await appel(ctx.base, 'GET', '/state', undefined, forge);
    assert.equal(r.status, 401);
  });

  it('un jeton signé avec un autre secret est refusé', async () => {
    const autre = jwt.sign({ id: ctx.ids.admin, email: 'admin@example.fr', tv: 0 }, 'un-autre-secret-totalement-different', { expiresIn: '1d' });
    const r = await appel(ctx.base, 'GET', '/state', undefined, autre);
    assert.equal(r.status, 401);
  });

  it('un jeton expiré est refusé', async () => {
    const vieux = jwt.sign({ id: ctx.ids.admin, email: 'admin@example.fr', tv: 0 }, SECRET, { expiresIn: '-1h' });
    const r = await appel(ctx.base, 'GET', '/state', undefined, vieux);
    assert.equal(r.status, 401);
  });

  it('un jeton qui nomme un compte disparu est refusé', async () => {
    const fantome = jwt.sign({ id: 99999, email: 'fantome@example.fr', tv: 0 }, SECRET, { expiresIn: '1d' });
    const r = await appel(ctx.base, 'GET', '/state', undefined, fantome);
    assert.equal(r.status, 401);
  });

  it('un en-tête d’autorisation mal formé est refusé, pas ignoré', async () => {
    for (const brut of ['', 'Bearer', 'Basic YWRtaW46YWRtaW4=', 'Bearer ', 'Bearer null']) {
      const res = await fetch(ctx.base + '/state', { headers: { authorization: brut } });
      assert.equal(res.status, 401, `en-tête « ${brut} » accepté`);
    }
  });
});

describe('changer son mot de passe révoque les autres sessions', () => {
  it('l’ancien jeton ne vaut plus rien, le nouveau fonctionne', async () => {
    const avant = (await appel(ctx.base, 'POST', '/auth/login', { email: 'membre@example.fr', password: 'MotDePasseSolide2' })).json.token;
    assert.equal((await appel(ctx.base, 'GET', '/state', undefined, avant)).status, 200);

    // Une seconde session, celle depuis laquelle on change le mot de passe.
    const change = await appel(ctx.base, 'PUT', '/me/credentials', {
      currentPassword: 'MotDePasseSolide2', password: 'MotDePasseSolideNeuf5',
    }, avant);
    assert.equal(change.status, 200);
    assert.equal(change.json.othersLoggedOut, true);

    // L'ancien jeton est mort ; celui que la réponse vient de rendre est vivant.
    assert.equal((await appel(ctx.base, 'GET', '/state', undefined, avant)).status, 401);
    assert.equal((await appel(ctx.base, 'GET', '/state', undefined, change.json.token)).status, 200);
  });

  it('un jeton portant une version périmée est refusé', async () => {
    const perime = jwt.sign({ id: ctx.ids.membre, email: 'membre@example.fr', tv: 0 }, SECRET, { expiresIn: '1d' });
    const r = await appel(ctx.base, 'GET', '/state', undefined, perime);
    assert.equal(r.status, 401);
    assert.match(String(r.json.error), /révoquée/);
  });
});
