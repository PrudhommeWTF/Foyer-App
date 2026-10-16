// /live renvoie l'état lu des notifications (members[].readNotifs), mais seulement
// celui du membre authentifié : jamais celui d'un autre. C'est ce qui fait suivre
// la cloche et la pastille d'un appareil quand une notification est lue ailleurs.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

describe('/live et l’état lu des notifications', () => {
  it('renvoie le readNotifs du membre authentifié, jamais celui d’un autre', async () => {
    // Pose un readNotifs différent sur l'admin (Thomas) et sur le membre (Camille).
    const etat = await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin);
    const members = (etat.json.state.members as { id: string; name: string }[]);
    const admin = members.find((m) => m.name === 'Thomas')!;
    const camille = members.find((m) => m.name === 'Camille')!;
    const next = members.map((m) =>
      m.id === admin.id ? { ...m, readNotifs: ['n-admin'] }
        : m.id === camille.id ? { ...m, readNotifs: ['n-camille'] } : m);
    const put = await appel(ctx.base, 'PUT', '/state', { version: etat.json.version, state: { ...etat.json.state, members: next } }, ctx.jetons.admin);
    assert.equal(put.status, 200, 'écriture du readNotifs : ' + JSON.stringify(put.json));

    const vuAdmin = await appel(ctx.base, 'GET', '/live', undefined, ctx.jetons.admin);
    assert.equal(vuAdmin.status, 200);
    assert.deepEqual(vuAdmin.json.readNotifs, ['n-admin'], 'l’admin voit son propre readNotifs');
    assert.ok(!(vuAdmin.json.readNotifs as string[]).includes('n-camille'), 'l’admin ne voit pas celui de Camille');

    const vuMembre = await appel(ctx.base, 'GET', '/live', undefined, ctx.jetons.membre);
    assert.equal(vuMembre.status, 200);
    assert.deepEqual(vuMembre.json.readNotifs, ['n-camille'], 'le membre voit son propre readNotifs');
    assert.ok(!(vuMembre.json.readNotifs as string[]).includes('n-admin'), 'le membre ne voit pas celui de l’admin');
  });

  it('une version inchangée reste une réponse légère, sans readNotifs', async () => {
    const v = (await appel(ctx.base, 'GET', '/live', undefined, ctx.jetons.admin)).json.version as number;
    const r = await appel(ctx.base, 'GET', `/live?since=${v}`, undefined, ctx.jetons.admin);
    assert.equal(r.status, 200);
    assert.equal(r.json.unchanged, true);
    assert.equal(r.json.readNotifs, undefined, 'rien de renvoyé quand rien n’a changé (la version porte aussi readNotifs)');
  });
});
