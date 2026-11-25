// Le module Épopée : les règles pures du grand livre (plancher, ce qui
// s'annule), puis ses vraies routes : qui lit et écrit quoi (un enfant ne voit
// que sa besace et n'écrit rien), l'amorce versée une seule fois, le bravo reçu
// deux fois compté une fois, l'annulation par contre-écriture, et le module
// éteint puis rallumé sans rien perdre.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';
import { AMORCE, Entry, balance, bravoEcus, cancelRefusal } from '../src/epopee/rules';

describe('règles', () => {
  const amorce: Entry = { id: 'a', kind: 'amorce', delta: AMORCE, ref: null };
  const bravo: Entry = { id: 'b', kind: 'bravo', delta: 2, ref: null };
  const annul: Entry = { id: 'c', kind: 'annulation', delta: -2, ref: 'b' };

  it('le solde est la somme des écritures', () => {
    assert.equal(balance([]), 0);
    assert.equal(balance([amorce, bravo]), AMORCE + 2);
    assert.equal(balance([amorce, bravo, annul]), AMORCE);
  });
  it('un bravo vaut 1, 2 ou 3 écus, rien d’autre', () => {
    assert.deepEqual([1, 2, 3].map(bravoEcus), [1, 2, 3]);
    for (const v of [0, 4, -1, 1.5, '2', null, undefined, NaN]) assert.equal(bravoEcus(v), null, String(v));
  });
  it('l’amorce ne se reprend pas, une annulation ne s’annule pas, une écriture ne s’annule qu’une fois', () => {
    assert.match(cancelRefusal(amorce, [amorce, bravo], AMORCE)!, /acquis/);
    assert.match(cancelRefusal(annul, [amorce, bravo, annul], AMORCE)!, /ne s’annule pas/);
    assert.match(cancelRefusal(bravo, [amorce, bravo, annul], AMORCE)!, /déjà annulée/);
    assert.equal(cancelRefusal(bravo, [amorce, bravo], AMORCE), null);
  });
  it('reprendre des écus ne fait jamais passer la besace sous son plancher', () => {
    // Des écus déjà dépensés (une écriture négative à venir avec l'Armurerie) : le bravo ne se reprend plus.
    const depense = { id: 'd', kind: 'annulation', delta: -2, ref: 'x' } as Entry;
    assert.match(cancelRefusal(bravo, [amorce, bravo, depense], AMORCE)!, /plancher/);
  });
});

let ctx: Contexte;
let lena = '', camille = '';
const uuid = () => crypto.randomUUID();
const besace = async (jeton: string, id = lena) => appel(ctx.base, 'GET', `/epopee/membres/${id}`, undefined, jeton);

before(async () => {
  ctx = await demarrer();
  const ms = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin)).json.state.members as { id: string; name: string }[];
  lena = ms.find((m) => m.name === 'Lena')!.id;
  camille = ms.find((m) => m.name === 'Camille')!.id;
});
after(async () => { await arreter(ctx); });

describe('enrôlement', () => {
  it('avant : l’enfant figure, sans besace ; un bravo est refusé', async () => {
    const l = await appel(ctx.base, 'GET', '/epopee/membres', undefined, ctx.jetons.membre);
    assert.deepEqual(l.json.enfants, [{ memberId: lena, enrolled: false, floor: null, balance: null, enrolledAt: null }]);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: uuid(), ecus: 1 }, ctx.jetons.membre)).status, 409);
  });
  it('un enfant ne s’enrôle pas lui-même, un adulte ne s’enrôle pas', async () => {
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/enrolement`, undefined, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${camille}/enrolement`, undefined, ctx.jetons.membre)).status, 400);
    assert.equal((await appel(ctx.base, 'POST', '/epopee/membres/inconnu/enrolement', undefined, ctx.jetons.membre)).status, 404);
  });
  it('un adulte enrôle : la besace commence à son plancher, et l’amorce n’est versée qu’une fois', async () => {
    const un = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/enrolement`, undefined, ctx.jetons.membre);
    assert.equal(un.status, 201); assert.equal(un.json.balance, AMORCE); assert.equal(un.json.floor, AMORCE);
    const deux = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/enrolement`, undefined, ctx.jetons.admin);
    assert.equal(deux.status, 200); assert.equal(deux.json.balance, AMORCE);
    const b = await besace(ctx.jetons.membre);
    assert.deepEqual(b.json.journal.map((e: { kind: string; delta: number; by: string }) => [e.kind, e.delta, e.by]), [['amorce', AMORCE, 'Camille']]);
  });
});

describe('bravos et annulation', () => {
  let bravo = '';
  it('un adulte donne un bravo ; le même geste reçu deux fois ne compte qu’une fois', async () => {
    bravo = uuid();
    const un = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: bravo, ecus: 2, note: '  Table mise sans rappel ' }, ctx.jetons.membre);
    assert.equal(un.status, 201); assert.equal(un.json.balance, AMORCE + 2); assert.equal(un.json.entry.note, 'Table mise sans rappel');
    const deux = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: bravo, ecus: 2 }, ctx.jetons.membre);
    assert.equal(deux.status, 200); assert.equal(deux.json.duplicate, true); assert.equal(deux.json.balance, AMORCE + 2);
  });
  it('refuse un montant hors barème, un identifiant mal formé, une note trop longue', async () => {
    for (const corps of [{ id: uuid(), ecus: 4 }, { id: uuid(), ecus: 0 }, { id: 'x', ecus: 1 }, { ecus: 1 }, { id: uuid(), ecus: 1, note: 'x'.repeat(121) }]) {
      assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, corps, ctx.jetons.membre)).status, 400, JSON.stringify(corps));
    }
  });
  it('un enfant lit sa besace, et seulement la sienne ; il n’écrit rien', async () => {
    const b = await besace(ctx.jetons.enfant);
    assert.equal(b.status, 200); assert.equal(b.json.balance, AMORCE + 2);
    assert.equal(b.json.balance, b.json.journal.reduce((s: number, e: { delta: number }) => s + e.delta, 0), 'le solde est la somme du journal');
    assert.deepEqual((await appel(ctx.base, 'GET', '/epopee/membres', undefined, ctx.jetons.enfant)).json.enfants.map((e: { memberId: string }) => e.memberId), [lena]);
    assert.equal((await besace(ctx.jetons.enfant, camille)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: uuid(), ecus: 3 }, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/journal/${bravo}/annulation`, undefined, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'DELETE', `/epopee/membres/${lena}/enrolement`, undefined, ctx.jetons.enfant)).status, 403);
  });
  it('annuler écrit la contre-écriture, une seule fois ; l’amorce ne se reprend pas', async () => {
    const un = await appel(ctx.base, 'POST', `/epopee/journal/${bravo}/annulation`, undefined, ctx.jetons.admin);
    assert.equal(un.status, 201); assert.equal(un.json.entry.delta, -2); assert.equal(un.json.balance, AMORCE);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/journal/${bravo}/annulation`, undefined, ctx.jetons.admin)).status, 409);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/journal/${un.json.entry.id}/annulation`, undefined, ctx.jetons.admin)).status, 409);
    const j = (await besace(ctx.jetons.membre)).json.journal as { id: string; kind: string; cancelled: boolean }[];
    assert.equal(j.length, 3, 'rien n’est effacé');
    assert.equal(j.find((e) => e.id === bravo)!.cancelled, true);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/journal/${j.find((e) => e.kind === 'amorce')!.id}/annulation`, undefined, ctx.jetons.admin)).status, 409);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/journal/${uuid()}/annulation`, undefined, ctx.jetons.admin)).status, 404);
  });
});

describe('accès et module', () => {
  it('refuse sans session, sans membre, et avec un jeton d’accès', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/epopee/membres')).status, 401);
    assert.equal((await appel(ctx.base, 'GET', '/epopee/membres', undefined, ctx.jetons.sansMembre)).status, 403);
    const jeton = await appel(ctx.base, 'POST', '/me/tokens', { name: 'Script', scope: 'write', password: 'MotDePasseSolide2' }, ctx.jetons.membre);
    assert.equal(jeton.status, 201, JSON.stringify(jeton.json));
    assert.equal((await appel(ctx.base, 'GET', '/epopee/membres', undefined, jeton.json.token)).status, 403);
  });
  it('retiré puis réenrôlé : la besace revient telle quelle, sans seconde amorce', async () => {
    await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: uuid(), ecus: 1 }, ctx.jetons.membre);
    assert.equal((await appel(ctx.base, 'DELETE', `/epopee/membres/${lena}/enrolement`, undefined, ctx.jetons.membre)).json.enrolled, false);
    assert.deepEqual((await besace(ctx.jetons.enfant)).json.journal, []);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: uuid(), ecus: 1 }, ctx.jetons.membre)).status, 409);
    const retour = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/enrolement`, undefined, ctx.jetons.membre);
    assert.equal(retour.status, 200); assert.equal(retour.json.balance, AMORCE + 1);
  });
  it('module éteint : tout répond 403, rien n’est perdu, tout revient', async () => {
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { modEpopee: false } }, ctx.jetons.admin)).status, 200);
    assert.equal((await appel(ctx.base, 'GET', '/epopee/membres', undefined, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: uuid(), ecus: 1 }, ctx.jetons.membre)).status, 403);
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { modEpopee: true } }, ctx.jetons.admin)).status, 200);
    assert.equal((await besace(ctx.jetons.enfant)).json.balance, AMORCE + 1);
  });
  it('la remise à zéro du module efface profils et grand livre', async () => {
    const compte = (await appel(ctx.base, 'GET', '/modules', undefined, ctx.jetons.admin)).json.counts.epopee;
    assert.deepEqual(compte, { enfants: 1, ecritures: 4 });
    assert.equal((await appel(ctx.base, 'POST', '/modules/epopee/reset', { confirm: 'SUPPRIMER' }, ctx.jetons.admin)).status, 200);
    assert.deepEqual((await appel(ctx.base, 'GET', '/modules', undefined, ctx.jetons.admin)).json.counts.epopee, { enfants: 0, ecritures: 0 });
    assert.equal((await besace(ctx.jetons.membre)).json.enrolled, false);
  });
});
