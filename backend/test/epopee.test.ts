// Le module Épopée : les règles pures du grand livre (plancher, ce qui
// s'annule), puis ses vraies routes : qui lit et écrit quoi (un enfant ne voit
// que sa besace et n'écrit rien), l'amorce versée une seule fois, le bravo reçu
// deux fois compté une fois, l'annulation par contre-écriture, et le module
// éteint puis rallumé sans rien perdre.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';
import { AMORCE, Entry, balance, bravoEcus, cancelRefusal, dayAccepted, dayBefore, exploitInput, stepsInput } from '../src/epopee/rules';
import { parseExploits, parseGabarit } from '../src/epopee/gabarit';

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

describe('réglages des parents : règles de saisie', () => {
  const etape = { title: ' Dents ', icon: 'dent', seconds: 120, ecus: 1 };
  it('les étapes d’une routine : la première faute est nommée', () => {
    assert.deepEqual(stepsInput([etape, { ...etape, id: 'x', hint: 'En cercles' }]), [{ id: null, title: 'Dents', hint: '', icon: 'dent', seconds: 120, ecus: 1 }, { id: 'x', title: 'Dents', hint: 'En cercles', icon: 'dent', seconds: 120, ecus: 1 }]);
    assert.match(stepsInput([]) as string, /de 1 à 12/);
    assert.match(stepsInput(Array(13).fill(etape)) as string, /de 1 à 12/);
    assert.match(stepsInput([etape, { ...etape, title: '' }]) as string, /Étape 2 : un titre/);
    assert.match(stepsInput([{ ...etape, seconds: 5 }]) as string, /durée/);
    assert.match(stepsInput([{ ...etape, ecus: 4 }]) as string, /0 à 3 écus/);
    assert.match(stepsInput([{ ...etape, icon: '<svg>' }]) as string, /pictogramme/);
    assert.match(stepsInput([{ ...etape, id: 'a' }, { ...etape, id: 'a' }]) as string, /deux fois/);
  });
  it('un exploit convenu vaut 1 à 3 écus', () => {
    assert.deepEqual(exploitInput({ title: ' Mettre la table ', ecus: 2 }), { title: 'Mettre la table', ecus: 2 });
    assert.equal(typeof exploitInput({ title: 'x', ecus: 0 }), 'string'); assert.equal(typeof exploitInput({ title: 'x', ecus: 4 }), 'string'); assert.equal(typeof exploitInput({ ecus: 1 }), 'string');
    const lignes: string[] = [];
    assert.deepEqual(parseExploits({ exploits: [{ title: 'Ranger', ecus: 2 }, { title: 'Trop', ecus: 9 }] }, 'test', (l) => lignes.push(l)), [{ title: 'Ranger', ecus: 2 }]);
    assert.equal(lignes.length, 1);
  });
});

let ctx: Contexte;
let lena = '', camille = '', noe = '';
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
    assert.deepEqual(l.json.enfants, [{ memberId: lena, enrolled: false, floor: null, balance: null, enrolledAt: null, display: null, timer: null }]);
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
  let matin: Routine, soir: Routine;
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

describe('réglages, exploits convenus et demandes', () => {
  type Exploit = { id: string; title: string; ecus: number };
  let table: Exploit;
  const solde = async () => (await besace(ctx.jetons.membre)).json.balance as number;

  before(async () => { await appel(ctx.base, 'POST', `/epopee/membres/${lena}/enrolement`, undefined, ctx.jetons.membre); });

  it('les exploits proposés sont posés au premier enrôlement ; un adulte en ajoute, en règle et en retire', async () => {
    const liste = (await appel(ctx.base, 'GET', '/epopee/exploits', undefined, ctx.jetons.enfant)).json.exploits as Exploit[];
    assert.ok(liste.length >= 2);
    table = liste[0];
    const plus = await appel(ctx.base, 'POST', '/epopee/exploits', { title: 'Arroser les plantes', ecus: 1 }, ctx.jetons.membre);
    assert.equal(plus.status, 201);
    assert.equal((await appel(ctx.base, 'PUT', `/epopee/exploits/${plus.json.exploit.id}`, { title: 'Arroser le jardin', ecus: 2 }, ctx.jetons.membre)).json.exploit.ecus, 2);
    assert.equal((await appel(ctx.base, 'DELETE', `/epopee/exploits/${plus.json.exploit.id}`, undefined, ctx.jetons.membre)).status, 200);
    assert.equal((await appel(ctx.base, 'GET', '/epopee/exploits', undefined, ctx.jetons.membre)).json.exploits.length, liste.length);
    assert.equal((await appel(ctx.base, 'POST', '/epopee/exploits', { title: 'x', ecus: 9 }, ctx.jetons.membre)).status, 400);
    assert.equal((await appel(ctx.base, 'POST', '/epopee/exploits', { title: 'Tricher', ecus: 3 }, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'DELETE', `/epopee/exploits/${table.id}`, undefined, ctx.jetons.enfant)).status, 403);
  });

  it('crédit express : le montant est celui de l’exploit, un renvoi ne compte pas, et il s’annule', async () => {
    const avant = await solde(), id = uuid();
    const un = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/exploits`, { id, exploitId: table.id, ecus: 99 }, ctx.jetons.membre);
    assert.equal(un.status, 201); assert.deepEqual([un.json.entry.kind, un.json.entry.delta, un.json.entry.note, un.json.balance], ['exploit', table.ecus, table.title, avant + table.ecus]);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/exploits`, { id, exploitId: table.id }, ctx.jetons.membre)).json.duplicate, true);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/journal/${id}/annulation`, undefined, ctx.jetons.membre)).json.balance, avant);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/exploits`, { id: uuid(), exploitId: 'inconnu' }, ctx.jetons.membre)).status, 404);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/exploits`, { id: uuid(), exploitId: table.id }, ctx.jetons.enfant)).status, 403);
  });

  it('un enfant signale un exploit : rien n’est versé avant la réponse, et il ne le signale pas deux fois', async () => {
    const avant = await solde();
    const un = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/demandes`, { id: uuid(), exploitId: table.id }, ctx.jetons.enfant);
    assert.equal(un.status, 201); assert.deepEqual(un.json.demandes.map((d: { status: string; title: string }) => [d.status, d.title]), [['attente', table.title]]);
    const deux = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/demandes`, { id: uuid(), exploitId: table.id }, ctx.jetons.enfant);
    assert.equal(deux.status, 200); assert.equal(deux.json.demandes.length, 1);
    assert.equal(await solde(), avant);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/demandes`, { id: uuid(), exploitId: table.id }, ctx.jetons.membre)).status, 403, 'un adulte ne signale pas à la place de l’enfant');
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${noe}/demandes`, { id: uuid(), exploitId: table.id }, ctx.jetons.enfant)).status, 403);
  });

  it('« pas tout à fait » ne retire rien ; validé, l’écu est versé une seule fois', async () => {
    const avant = await solde();
    const demande = (await besace(ctx.jetons.membre)).json.demandes[0] as { id: string };
    assert.equal((await appel(ctx.base, 'POST', `/epopee/demandes/${demande.id}/decision`, { accept: false }, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/demandes/${demande.id}/decision`, {}, ctx.jetons.membre)).status, 400);
    const non = await appel(ctx.base, 'POST', `/epopee/demandes/${demande.id}/decision`, { accept: false }, ctx.jetons.membre);
    assert.deepEqual([non.status, non.json.status, non.json.balance], [200, 'refusee', avant]);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/demandes/${demande.id}/decision`, { accept: true }, ctx.jetons.membre)).status, 409);
    // The child may ask again, and this time it is granted.
    const encore = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/demandes`, { id: uuid(), exploitId: table.id }, ctx.jetons.enfant);
    const attente = encore.json.demandes.find((d: { status: string }) => d.status === 'attente') as { id: string };
    const oui = await appel(ctx.base, 'POST', `/epopee/demandes/${attente.id}/decision`, { accept: true }, ctx.jetons.admin);
    assert.deepEqual([oui.json.status, oui.json.balance], ['validee', avant + table.ecus]);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/demandes/${attente.id}/decision`, { accept: true }, ctx.jetons.admin)).status, 409);
    const vues = (await besace(ctx.jetons.enfant)).json.demandes as { status: string; decidedBy: string | null }[];
    assert.deepEqual(vues.map((d) => d.status).sort(), ['refusee', 'validee']); assert.ok(vues.every((d) => d.decidedBy));
  });

  it('réglages par enfant : affichage de la besace et sablier', async () => {
    assert.deepEqual([(await besace(ctx.jetons.enfant)).json.display, (await besace(ctx.jetons.enfant)).json.timer], ['nombre', true]);
    const r = await appel(ctx.base, 'PATCH', `/epopee/membres/${lena}/reglages`, { display: 'pieces', timer: false }, ctx.jetons.membre);
    assert.deepEqual([r.status, r.json.display, r.json.timer], [200, 'pieces', false]);
    assert.equal((await appel(ctx.base, 'PATCH', `/epopee/membres/${lena}/reglages`, { timer: true }, ctx.jetons.membre)).json.display, 'pieces', 'un réglage absent ne bouge pas');
    assert.equal((await appel(ctx.base, 'PATCH', `/epopee/membres/${lena}/reglages`, { display: 'hologramme' }, ctx.jetons.membre)).status, 400);
    assert.equal((await appel(ctx.base, 'PATCH', `/epopee/membres/${lena}/reglages`, { display: 'nombre' }, ctx.jetons.enfant)).status, 403);
  });

  it('régler une routine : titre, heure, étapes ajoutées, retirées et réordonnées ; les coches passées restent', async () => {
    type R = { id: string; title: string; time: string; steps: { id: string; title: string; status: string | null; ecus: number }[] };
    const r = ((await besace(ctx.jetons.membre)).json.routines as R[])[0];
    const [a, b, ...reste] = r.steps;
    const avant = await solde();
    const corps = { title: 'Le matin de Lena', time: '07:05', steps: [{ ...b, hint: '', icon: 'dent', seconds: 90 }, { title: 'Faire son lit', icon: 'home', seconds: 120, ecus: 2 }, ...reste.map((s) => ({ ...s, hint: '', icon: 'dent', seconds: 60 }))] };
    assert.equal((await appel(ctx.base, 'PUT', `/epopee/routines/${r.id}`, corps, ctx.jetons.enfant)).status, 403);
    const fait = await appel(ctx.base, 'PUT', `/epopee/routines/${r.id}`, corps, ctx.jetons.membre);
    assert.equal(fait.status, 200, JSON.stringify(fait.json));
    const apres = (fait.json.routines as R[])[0];
    assert.deepEqual([apres.title, apres.time], ['Le matin de Lena', '07:05']);
    assert.deepEqual(apres.steps.map((s) => s.title), [b.title, 'Faire son lit', ...reste.map((s) => s.title)]);
    assert.ok(!apres.steps.some((s) => s.id === a.id), 'l’étape retirée ne figure plus');
    assert.deepEqual(apres.steps.map((s) => s.status), [b.status, null, ...reste.map((s) => s.status)], 'les coches du jour suivent leurs étapes');
    assert.equal(await solde(), avant, 'régler une routine ne touche pas à la besace');
    assert.equal((await appel(ctx.base, 'PUT', `/epopee/routines/${r.id}`, { ...corps, steps: [{ ...corps.steps[1], id: 'autre-routine' }] }, ctx.jetons.membre)).status, 400);
    assert.equal((await appel(ctx.base, 'PUT', `/epopee/routines/${r.id}`, { ...corps, time: '7h' }, ctx.jetons.membre)).status, 400);
    assert.equal((await appel(ctx.base, 'PUT', `/epopee/routines/${r.id}`, { ...corps, steps: [] }, ctx.jetons.membre)).status, 400);
  });

  it('revenir aux routines proposées remplace celles de l’enfant', async () => {
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/routines/gabarit`, { replace: true }, ctx.jetons.enfant)).status, 403);
    const r = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/routines/gabarit`, { replace: true }, ctx.jetons.membre);
    assert.equal(r.status, 201); assert.equal(r.json.routines.length, 2);
    assert.notEqual(r.json.routines[0].title, 'Le matin de Lena');
    assert.ok(r.json.routines[0].steps.every((s: { status: string | null }) => s.status === null));
  });
});
