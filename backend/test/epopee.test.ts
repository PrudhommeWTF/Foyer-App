// Le module Épopée : les règles pures du grand livre (plancher, ce qui
// s'annule), puis ses vraies routes : qui lit et écrit quoi (un enfant ne voit
// que sa besace et n'écrit rien), l'amorce versée une seule fois, le bravo reçu
// deux fois compté une fois, l'annulation par contre-écriture, et le module
// éteint puis rallumé sans rien perdre.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';
import { AMORCE, Entry, balance, bravoEcus, cancelRefusal, dayAccepted, dayBefore } from '../src/epopee/rules';
import { parseGabarit } from '../src/epopee/gabarit';

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

describe('routines : règles et gabarit', () => {
  it('un appareil annonce aujourd’hui ou hier, rien d’autre', () => {
    assert.equal(dayBefore('2026-03-01'), '2026-02-28'); assert.equal(dayBefore('2026-01-01'), '2025-12-31');
    assert.ok(dayAccepted('2026-03-01', '2026-03-01')); assert.ok(dayAccepted('2026-02-28', '2026-03-01'));
    for (const d of ['2026-02-27', '2026-03-02', '', null, 20260301]) assert.equal(dayAccepted(d, '2026-03-01'), false, String(d));
  });
  it('le gabarit écarte ce qui est mal formé et garde le reste', () => {
    const lignes: string[] = [];
    const etape = { title: 'Dents', icon: 'dent', seconds: 120, ecus: 1 };
    const g = parseGabarit({ routines: [
      { kind: 'matin', title: 'Matin', time: '07:20', steps: [etape, { ...etape, seconds: 5 }, { ...etape, ecus: 9 }, { title: 'Sans icône', seconds: 60, ecus: 1 }] },
      { kind: 'matin', title: 'Second matin', time: '08:00', steps: [etape] },
      { kind: 'midi', title: 'Midi', time: '12:00', steps: [etape] },
      { kind: 'soir', title: 'Soir', time: '25:00', steps: [etape] },
      { kind: 'soir', title: 'Soir vide', time: '19:00', steps: [] },
    ] }, 'test', (l) => lignes.push(l));
    assert.deepEqual(g, [{ kind: 'matin', title: 'Matin', time: '07:20', steps: [{ ...etape, hint: '' }] }]);
    assert.equal(lignes.length, 7);
    assert.deepEqual(parseGabarit(null, 'test', () => undefined), []);
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

describe('routines', () => {
  type Etape = { id: string; title: string; ecus: number; status: string | null };
  type Routine = { id: string; kind: string; pauses: number; endedAt: string | null; steps: Etape[] };
  let noe = '', matin: Routine, soir: Routine;
  const hier = () => dayBefore(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()));
  const noter = (id: string, corps: Record<string, unknown>, jeton: string) => appel(ctx.base, 'POST', `/epopee/etapes/${id}`, corps, jeton);

  before(async () => {
    // Un second enfant, sans compte : pour vérifier qu'un enfant ne touche pas aux routines d'un autre.
    const etat = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin)).json;
    noe = 'm-noe';
    const marque = await appel(ctx.base, 'PUT', '/state', { state: { ...etat.state, members: [...etat.state.members, { id: noe, name: 'Noé', role: 'Enfant', color: '#4E93B8', ini: 'NO', enfant: true }] }, version: etat.version }, ctx.jetons.admin);
    assert.equal(marque.status, 200, JSON.stringify(marque.json));
  });

  it('l’enrôlement pose les routines du gabarit, une seule fois', async () => {
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/enrolement`, undefined, ctx.jetons.membre)).status, 201);
    const b = await besace(ctx.jetons.enfant);
    [matin, soir] = b.json.routines;
    assert.deepEqual([matin.kind, soir.kind], ['matin', 'soir']);
    assert.ok(matin.steps.length >= 3 && matin.steps.every((e) => e.status === null));
    const encore = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/routines/gabarit`, undefined, ctx.jetons.membre);
    assert.equal(encore.status, 200); assert.equal(encore.json.routines.length, 2);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/routines/gabarit`, undefined, ctx.jetons.enfant)).status, 403);
  });

  it('une étape faite verse son écu, une seule fois par jour', async () => {
    const e = matin.steps[0];
    const un = await noter(e.id, { status: 'fait' }, ctx.jetons.enfant);
    assert.equal(un.status, 201); assert.deepEqual([un.json.ecus, un.json.balance, un.json.routineDone], [e.ecus, AMORCE + e.ecus, false]);
    const deux = await noter(e.id, { status: 'fait' }, ctx.jetons.enfant);
    assert.equal(deux.status, 200); assert.equal(deux.json.duplicate, true); assert.equal(deux.json.balance, AMORCE + e.ecus);
    const b = (await besace(ctx.jetons.enfant)).json;
    assert.equal(b.routines[0].steps[0].status, 'fait');
    assert.deepEqual([b.journal[0].kind, b.journal[0].note, b.journal[0].delta], ['etape', e.title, e.ecus]);
  });

  it('la même étape se refait hier (tablette restée sans réseau), pas avant-hier ni demain', async () => {
    const e = matin.steps[0];
    assert.equal((await noter(e.id, { status: 'fait', day: hier() }, ctx.jetons.enfant)).status, 201);
    assert.equal((await noter(e.id, { status: 'fait', day: dayBefore(hier()) }, ctx.jetons.enfant)).status, 400);
    assert.equal((await noter(e.id, { status: 'fait', day: '2999-01-01' }, ctx.jetons.enfant)).status, 400);
    assert.equal((await noter(e.id, { status: 'peut-être' }, ctx.jetons.enfant)).status, 400);
    assert.equal((await noter('inconnue', { status: 'fait' }, ctx.jetons.enfant)).status, 404);
  });

  it('une étape passée ne rapporte rien et ne coûte rien ; la routine va au bout quand tout est noté', async () => {
    const avant = (await besace(ctx.jetons.enfant)).json.balance as number;
    const passe = await noter(matin.steps[1].id, { status: 'saute' }, ctx.jetons.enfant);
    assert.deepEqual([passe.status, passe.json.ecus, passe.json.balance], [201, 0, avant]);
    let dernier = passe;
    for (const e of matin.steps.slice(2)) dernier = await noter(e.id, { status: 'fait' }, ctx.jetons.membre);
    assert.equal(dernier.json.routineDone, true);
    const r = (await besace(ctx.jetons.enfant)).json.routines[0] as Routine;
    assert.ok(r.endedAt); assert.deepEqual(r.steps.map((e) => e.status), ['fait', 'saute', ...matin.steps.slice(2).map(() => 'fait')]);
  });

  it('une pause « grain de sable » se compte et ne retire rien', async () => {
    const avant = (await besace(ctx.jetons.enfant)).json.balance as number;
    assert.equal((await appel(ctx.base, 'POST', `/epopee/routines/${soir.id}/pauses`, {}, ctx.jetons.enfant)).json.pauses, 1);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/routines/${soir.id}/pauses`, {}, ctx.jetons.enfant)).json.pauses, 2);
    const b = (await besace(ctx.jetons.enfant)).json;
    assert.equal(b.balance, avant); assert.equal(b.routines[1].pauses, 2); assert.equal(b.routines[1].endedAt, null);
  });

  it('un enfant ne note pas les étapes d’un autre', async () => {
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${noe}/enrolement`, undefined, ctx.jetons.membre)).status, 201);
    const autre = (await besace(ctx.jetons.membre, noe)).json.routines[0] as Routine;
    assert.equal((await noter(autre.steps[0].id, { status: 'fait' }, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/routines/${autre.id}/pauses`, {}, ctx.jetons.enfant)).status, 403);
    assert.equal((await besace(ctx.jetons.membre, noe)).json.balance, AMORCE);
  });

  it('un adulte annule l’écu d’une étape ; l’étape reste notée et ne se regagne pas', async () => {
    const b = (await besace(ctx.jetons.membre)).json;
    const ecriture = b.journal.find((e: { kind: string; cancelled: boolean }) => e.kind === 'etape' && !e.cancelled) as { id: string; delta: number };
    const annule = await appel(ctx.base, 'POST', `/epopee/journal/${encodeURIComponent(ecriture.id)}/annulation`, undefined, ctx.jetons.membre);
    assert.equal(annule.status, 201); assert.equal(annule.json.balance, b.balance - ecriture.delta);
    assert.equal((await noter(soir.steps[0].id, { status: 'fait' }, ctx.jetons.enfant)).status, 201);
    assert.equal((await noter(matin.steps[2].id, { status: 'fait' }, ctx.jetons.enfant)).json.duplicate, true);
  });

  it('enfant retiré : ses étapes ne se notent plus', async () => {
    await appel(ctx.base, 'DELETE', `/epopee/membres/${lena}/enrolement`, undefined, ctx.jetons.membre);
    assert.equal((await noter(soir.steps[1].id, { status: 'fait' }, ctx.jetons.enfant)).status, 409);
    assert.deepEqual((await besace(ctx.jetons.enfant)).json.routines, []);
  });
});
