// Le module Épopée : les règles pures du grand livre (plancher, ce qui
// s'annule), puis ses vraies routes : qui lit et écrit quoi (un enfant ne voit
// que sa besace et n'écrit rien), l'amorce versée une seule fois, le bravo reçu
// deux fois compté une fois, l'annulation par contre-écriture, et le module
// éteint puis rallumé sans rien perdre.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, brut, demarrer } from './securite-helpers';
import { jpeg, png } from './equipements-fixtures';
import { AMORCE, Entry, REWARD_COST_MIN, balance, bravoEcus, canExchange, cancelRefusal, dateInput, dayAccepted, dayBefore, exploitInput, kindOf, optionalText, pactTopUp, rewardInput, stepsInput } from '../src/epopee/rules';
import { parseExploits, parseGabarit, parseRewards } from '../src/epopee/gabarit';
import { EpopeeEvent, emit, eventMessage, onEpopeeEvent, recipients } from '../src/epopee/events';
import { BilanInput, computeBilan, councilPdf, eventful, lines, weekLine, weeklyHits } from '../src/epopee/bilan';

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

describe('Armurerie : règles', () => {
  it('une récompense coûte au moins deux fois l’amorce, et dit ce qui manque', () => {
    assert.deepEqual(rewardInput({ title: ' Cinéma ', cost: 40, category: 'duo' }), { title: 'Cinéma', description: '', cost: 40, category: 'duo' });
    assert.equal(REWARD_COST_MIN, 2 * AMORCE);
    assert.match(rewardInput({ title: 'x', cost: REWARD_COST_MIN - 1, category: 'duo' }) as string, /cost/);
    assert.match(rewardInput({ title: 'x', cost: 20, category: 'loterie' }) as string, /category/);
    assert.match(rewardInput({ cost: 20, category: 'duo' }) as string, /title/);
    const lignes: string[] = [];
    assert.equal(parseRewards({ recompenses: [{ title: 'Film', cost: 20, category: 'privilege' }, { title: 'Gratuit', cost: 1, category: 'petit' }] }, 'test', (l) => lignes.push(l)).length, 1);
    assert.equal(lignes.length, 1);
  });
  it('un échange dépense le coût entier, plancher compris ; sceller un pacte ramène la besace à l’amorce', () => {
    assert.ok(canExchange(20, 20)); assert.ok(!canExchange(19, 20));
    assert.equal(pactTopUp(0, AMORCE), AMORCE); assert.equal(pactTopUp(3, AMORCE), 2); assert.equal(pactTopUp(12, AMORCE), 0);
  });
  it('un trésor échangé ne se reprend pas', () => {
    const e: Entry = { id: 'echange:q', kind: 'echange', delta: -20, ref: null };
    assert.match(cancelRefusal(e, [e], AMORCE)!, /pacte est scellé/);
  });
  it('textes facultatifs et dates', () => {
    assert.equal(optionalText(undefined, 10), ''); assert.equal(optionalText('  ', 10), ''); assert.equal(optionalText(' ok ', 10), 'ok');
    assert.equal(optionalText('x'.repeat(11), 10), null); assert.equal(optionalText(12, 10), null);
    assert.equal(dateInput('2026-12-05'), '2026-12-05'); assert.equal(dateInput('05/12/2026'), null); assert.equal(dateInput('2026-13-45'), null);
  });
});

describe('le bilan de la semaine : calcul', () => {
  const base: BilanInput = {
    member: { id: 'k', name: 'Raphaël' }, from: '2026-10-12', to: '2026-10-18',
    entries: [
      { kind: 'etape', delta: 1, note: 'Dents', cancelled: false }, { kind: 'etape', delta: 1, note: 'Dents', cancelled: false }, { kind: 'etape', delta: 1, note: 'Cartable', cancelled: true },
      { kind: 'exploit', delta: 2, note: 'Mettre la table', cancelled: false }, { kind: 'exploit', delta: 2, note: 'Mettre la table', cancelled: false }, { kind: 'exploit', delta: 3, note: 'Aider', cancelled: false },
      { kind: 'bravo', delta: 2, note: 'Calme pendant les devoirs', cancelled: false }, { kind: 'bravo', delta: 1, note: null, cancelled: false },
      { kind: 'amorce', delta: 5, note: null, cancelled: false }, { kind: 'echange', delta: -20, note: 'Cinéma', cancelled: false }, { kind: 'annulation', delta: -1, note: null, cancelled: false },
    ],
    routinesDone: 9, routinesPossible: 14, stepsSkipped: 1, pauses: 2, won: ['Cinéma'], lived: [], quest: { title: 'Nuit sous la tente', cost: 50 }, balance: 12,
  };
  const vide: BilanInput = { ...base, entries: [], routinesDone: 0, stepsSkipped: 0, pauses: 0, won: [], quest: null, balance: 5 };

  it('ne compte que ce qui a été gagné : ni l’amorce, ni l’échange, ni ce qui a été annulé', () => {
    const b = computeBilan(base);
    assert.deepEqual([b.earned, b.etapes, b.exploits, b.bravos], [12, 2, 7, 3]);
    assert.deepEqual(b.feats, [{ title: 'Mettre la table', times: 2 }, { title: 'Aider', times: 1 }]);
    assert.deepEqual(b.words, ['Calme pendant les devoirs']);
    assert.deepEqual(b.quest, { title: 'Nuit sous la tente', cost: 50, missing: 38 });
    assert.equal(b.label, 'Semaine du lundi 12 au dimanche 18 octobre 2026');
  });
  it('la phrase du dimanche raconte la semaine, et une semaine calme se dit sans reproche', () => {
    assert.equal(weekLine(computeBilan(base)), 'Raphaël cette semaine : 12 écus gagnés, 9 routines menées au bout sur 14, 2 pauses grain de sable, trésor gagné : Cinéma.');
    assert.equal(weekLine(computeBilan({ ...base, won: [] })), 'Raphaël cette semaine : 12 écus gagnés, 9 routines menées au bout sur 14, 2 pauses grain de sable, encore 38 écus pour « Nuit sous la tente ».');
    const calme = computeBilan(vide);
    assert.equal(eventful(calme), false);
    assert.equal(weekLine(calme), 'Raphaël cette semaine : une semaine calme, sans écu gagné. Demain est une nouvelle quête.');
    assert.equal(lines(calme).length, 1); assert.match(lines(calme)[0], /pas un reproche/);
  });
  it('les lignes du bilan et son PDF', () => {
    const l = lines(computeBilan(base));
    assert.equal(l[0], '12 écus gagnés : 2 par les routines, 7 par les exploits, 3 par les bravos.');
    assert.ok(l.includes('2 pauses grain de sable, 1 étape passée : autant de fois où ça coinçait et où l’on a su s’arrêter.'));
    assert.ok(lines(computeBilan({ ...base, stepsSkipped: 0 })).includes('2 pauses grain de sable : autant de fois où ça coinçait et où l’on a su s’arrêter.'), 'un zéro ne se dit pas');
    assert.ok(l.includes('Exploits : Mettre la table (2 fois), Aider.')); assert.ok(l.includes('Besace en fin de semaine : 12 écus.'));
    const pdf = councilPdf([computeBilan(base), computeBilan({ ...vide, member: { id: 'g', name: 'Gaëtan' } })], '2026-10-12', 'On avance le coucher d’un quart d’heure.', '2026-10-18');
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-'); assert.ok(pdf.length > 1500);
    assert.equal(councilPdf([], '2026-10-12', '', '2026-10-18').subarray(0, 5).toString('latin1'), '%PDF-');
  });
  it('une notification par enfant enrôlé, le dimanche à partir de l’heure, pour les adultes', () => {
    const kids = [{ id: 'k', name: 'Raphaël' }, { id: 'g', name: 'Gaëtan' }];
    const de = (k: { id: string; name: string }) => computeBilan(k.id === 'k' ? base : { ...vide, member: k });
    assert.deepEqual(weeklyHits(kids, ['a'], '2026-10-18T17:59', '18:00', de), [], 'pas avant l’heure');
    assert.deepEqual(weeklyHits(kids, ['a'], '2026-10-17T19:00', '18:00', de), [], 'pas le samedi');
    assert.deepEqual(weeklyHits(kids, [], '2026-10-18T18:00', '18:00', de), [], 'personne à prévenir');
    const hits = weeklyHits(kids, ['a', 'b'], '2026-10-18T18:00', '18:00', de);
    assert.deepEqual(hits.map((h) => [h.key, h.title, h.memberIds.length]), [['epopee-hebdo|k|2026-10-12', 'L’Épopée de Raphaël', 2], ['epopee-hebdo|g|2026-10-12', 'L’Épopée de Gaëtan', 2]]);
    assert.match(hits[1].body, /une semaine calme/);
  });
});

describe('notifications sur le moment : mots et destinataires', () => {
  const exploit: EpopeeEvent = { kind: 'exploit', id: 'd1', childId: 'k', child: 'Raphaël', actorId: 'k', title: 'Mettre la table', ecus: 2 };
  const quete: EpopeeEvent = { kind: 'quete', id: 'q1', childId: 'k', child: 'Raphaël', actorId: 'k', title: 'Soirée cinéma à deux', cost: 40 };
  const tresor: EpopeeEvent = { kind: 'tresor', id: 'q1', childId: 'k', child: 'Raphaël', actorId: 'k', title: 'Soirée cinéma à deux', date: '2026-12-05' };

  it('chaque moment dit qui, quoi, et ce qui est attendu du parent', () => {
    assert.deepEqual(eventMessage(exploit), { key: 'epopee|exploit|d1', tag: 'epopee-k', title: 'Raphaël signale un exploit', body: '« Mettre la table », +2 écus si vous validez.' });
    assert.equal(eventMessage({ ...exploit, ecus: 1 }).body, '« Mettre la table », +1 écu si vous validez.');
    assert.deepEqual([eventMessage(quete).title, eventMessage(quete).body], ['Raphaël vise un trésor', '« Soirée cinéma à deux », 40 écus. Il reste à sceller le pacte ensemble.']);
    assert.equal(eventMessage(tresor).body, '« Soirée cinéma à deux » : à vous de tenir le pacte, prévu samedi 5 décembre.');
    assert.equal(eventMessage({ ...tresor, date: null }).body, '« Soirée cinéma à deux » : à vous de tenir le pacte.');
    assert.notEqual(eventMessage(quete).key, eventMessage(tresor).key, 'viser puis gagner la même quête : deux notifications');
  });
  it('les adultes qui le veulent sont prévenus, sauf celui qui vient de faire le geste', () => {
    assert.deepEqual(recipients(exploit, ['a', 'b', 'c'], (m) => m !== 'c'), ['a', 'b']);
    assert.deepEqual(recipients({ ...tresor, actorId: 'a' }, ['a', 'b'], () => true), ['b'], 'un parent qui échange pour son enfant le sait déjà');
    assert.deepEqual(recipients(exploit, [], () => true), []);
  });
  it('un abonné en panne ne fait pas échouer le geste', () => {
    onEpopeeEvent(() => { throw new Error('push en panne'); });
    assert.doesNotThrow(() => emit(exploit));
    onEpopeeEvent(null); assert.doesNotThrow(() => emit(exploit));
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
    assert.deepEqual(l.json.enfants, [{ memberId: lena, enrolled: false, floor: null, balance: null, enrolledAt: null, display: null, timer: null, swornAt: null, swornBy: null }]);
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

describe('Armurerie : récompenses, quêtes, pacte, souvenir', () => {
  type Recompense = { id: string; title: string; cost: number };
  type Quete = { id: string; title: string; cost: number; status: string; pact: { date: string | null; note: string; by: string } | null; memory: { child: string; parent: string } | null };
  let petite: Recompense, quete = '';
  const etat = async (jeton = ctx.jetons.membre) => (await besace(jeton)).json as { balance: number; quetes: Quete[]; souvenirs: Quete[] };
  const proposer = (rewardId: string, jeton: string, membre = lena) => appel(ctx.base, 'POST', `/epopee/membres/${membre}/quetes`, { id: uuid(), rewardId }, jeton);

  it('le catalogue proposé est posé au premier enrôlement ; un adulte le tient, un enfant le lit', async () => {
    const liste = (await appel(ctx.base, 'GET', '/epopee/recompenses', undefined, ctx.jetons.enfant)).json.recompenses as Recompense[];
    assert.ok(liste.length >= 3); assert.deepEqual(liste.map((r) => r.cost), [...liste.map((r) => r.cost)].sort((a, b) => a - b), 'du moins cher au plus cher');
    petite = liste[0];
    const plus = await appel(ctx.base, 'POST', '/epopee/recompenses', { title: 'Choisir le dessert', cost: 12, category: 'privilege' }, ctx.jetons.membre);
    assert.equal(plus.status, 201);
    assert.equal((await appel(ctx.base, 'PUT', `/epopee/recompenses/${plus.json.recompense.id}`, { title: 'Choisir le dessert', cost: 15, category: 'privilege' }, ctx.jetons.membre)).json.recompense.cost, 15);
    assert.equal((await appel(ctx.base, 'DELETE', `/epopee/recompenses/${plus.json.recompense.id}`, undefined, ctx.jetons.membre)).status, 200);
    assert.equal((await appel(ctx.base, 'POST', '/epopee/recompenses', { title: 'Presque gratuit', cost: 2, category: 'petit' }, ctx.jetons.membre)).status, 400);
    assert.equal((await appel(ctx.base, 'POST', '/epopee/recompenses', { title: 'Console', cost: 10, category: 'petit' }, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'DELETE', `/epopee/recompenses/${petite.id}`, undefined, ctx.jetons.enfant)).status, 403);
  });

  it('un enfant choisit un trésor : une seule quête à la fois, et il peut y renoncer avant le pacte', async () => {
    const un = await proposer(petite.id, ctx.jetons.enfant);
    assert.equal(un.status, 201); assert.deepEqual([un.json.quete.status, un.json.quete.title, un.json.quete.cost, un.json.quete.pact], ['proposee', petite.title, petite.cost, null]);
    assert.equal((await proposer(petite.id, ctx.jetons.enfant)).status, 409);
    assert.equal((await proposer('inconnue', ctx.jetons.enfant)).status, 404);
    assert.equal((await proposer(petite.id, ctx.jetons.enfant, noe)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${un.json.quete.id}/pacte`, {}, ctx.jetons.enfant)).status, 403, 'un enfant ne scelle pas son propre pacte');
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${un.json.quete.id}/abandon`, undefined, ctx.jetons.enfant)).status, 200);
    assert.deepEqual((await etat()).quetes, []);
  });

  it('un adulte scelle le pacte ; sans assez d’écus, l’échange est refusé', async () => {
    quete = (await proposer(petite.id, ctx.jetons.membre)).json.quete.id;
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/pacte`, { date: 'samedi' }, ctx.jetons.membre)).status, 400);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/pacte`, { note: 'x'.repeat(201) }, ctx.jetons.membre)).status, 400);
    const avant = (await etat()).balance;
    const scelle = await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/pacte`, { date: '2030-01-05', items: 'Le livre des dragons', rule: 'Lumière éteinte à 21 h', note: 'Je suis fière de toi.' }, ctx.jetons.membre);
    assert.equal(scelle.status, 200); assert.deepEqual([scelle.json.quete.status, scelle.json.quete.pact.date, scelle.json.quete.pact.by, scelle.json.balance], ['active', '2030-01-05', 'Camille', avant]);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/pacte`, {}, ctx.jetons.membre)).status, 409);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/abandon`, undefined, ctx.jetons.enfant)).status, 403, 'pacte scellé : l’enfant ne renonce plus seul');
    if (avant < petite.cost) {
      const refus = await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/echange`, undefined, ctx.jetons.enfant);
      assert.equal(refus.status, 409); assert.match(refus.json.error, /Il manque encore/);
    }
  });

  it('l’échange dépense le coût entier, une seule fois, et ne s’annule pas', async () => {
    while ((await etat()).balance < petite.cost) await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: uuid(), ecus: 3 }, ctx.jetons.membre);
    const avant = (await etat()).balance;
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/echange`, undefined, ctx.jetons.sansMembre)).status, 403);
    const fait = await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/echange`, undefined, ctx.jetons.enfant);
    assert.equal(fait.status, 201); assert.deepEqual([fait.json.quete.status, fait.json.balance], ['atteinte', avant - petite.cost]);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/echange`, undefined, ctx.jetons.enfant)).status, 409);
    const j = (await besace(ctx.jetons.membre)).json.journal as { id: string; kind: string; delta: number; note: string }[];
    assert.deepEqual([j[0].kind, j[0].delta, j[0].note], ['echange', -petite.cost, petite.title]);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/journal/${encodeURIComponent(j[0].id)}/annulation`, undefined, ctx.jetons.membre)).status, 409);
  });

  it('la besace vidée repart à l’amorce quand le pacte suivant est scellé', async () => {
    // Bring the pouch under its floor is only possible by exchanging: drain it with a second quest priced at the balance.
    const solde = (await etat()).balance;
    if (solde >= AMORCE) {
      const juste = (await appel(ctx.base, 'POST', '/epopee/recompenses', { title: 'Tout dépenser', cost: Math.max(solde, 10), category: 'petit' }, ctx.jetons.membre)).json.recompense as Recompense;
      while ((await etat()).balance < juste.cost) await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: uuid(), ecus: 1 }, ctx.jetons.membre);
      const q = (await proposer(juste.id, ctx.jetons.membre)).json.quete.id;
      await appel(ctx.base, 'POST', `/epopee/quetes/${q}/pacte`, {}, ctx.jetons.membre);
      assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${q}/echange`, undefined, ctx.jetons.membre)).json.balance, 0);
    }
    const avantChoix = (await etat()).balance;
    const q = (await proposer(petite.id, ctx.jetons.enfant)).json.quete.id;
    assert.equal((await etat()).balance, avantChoix, 'choisir un trésor ne verse rien');
    const bas = (await etat()).balance;
    assert.ok(bas < AMORCE, 'la besace est passée sous son plancher par un échange, jamais par un retrait');
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${q}/pacte`, {}, ctx.jetons.membre)).json.balance, AMORCE);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${q}/abandon`, undefined, ctx.jetons.membre)).json.balance, AMORCE, 'abandonner ne retire rien');
  });

  it('le moment vécu devient un souvenir, que l’enfant relit', async () => {
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/vecu`, { child: 'Le dragon !' }, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/vecu`, { date: '2999-01-01' }, ctx.jetons.membre)).status, 400);
    const vecu = await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/vecu`, { child: 'Quand le dragon a éternué.', parent: 'Tu as écouté jusqu’au bout, blotti contre moi.' }, ctx.jetons.membre);
    assert.equal(vecu.status, 200); assert.equal(vecu.json.quete.status, 'honoree');
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${quete}/vecu`, {}, ctx.jetons.membre)).status, 409);
    const e = await etat(ctx.jetons.enfant);
    assert.ok(!e.quetes.some((q) => q.id === quete));
    const souvenir = e.souvenirs.find((q) => q.id === quete)!;
    assert.deepEqual([souvenir.title, souvenir.memory!.child, souvenir.pact!.note], [petite.title, 'Quand le dragon a éternué.', 'Je suis fière de toi.']);
  });
});

describe('le serment de l’alliance', () => {
  it('un adulte le scelle avec l’enfant, une seule fois ; la date du premier serment reste', async () => {
    assert.equal((await besace(ctx.jetons.enfant)).json.swornAt, null);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/serment`, undefined, ctx.jetons.enfant)).status, 403, 'un enfant ne scelle pas seul');
    const un = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/serment`, undefined, ctx.jetons.membre);
    assert.equal(un.status, 201); assert.ok(un.json.swornAt); assert.equal(un.json.swornBy, 'Camille');
    const deux = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/serment`, undefined, ctx.jetons.admin);
    assert.equal(deux.status, 200); assert.deepEqual([deux.json.swornAt, deux.json.swornBy], [un.json.swornAt, 'Camille']);
    assert.equal((await besace(ctx.jetons.enfant)).json.swornBy, 'Camille', 'l’enfant relit son serment');
  });
  it('pas de serment sans enrôlement', async () => {
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${camille}/serment`, undefined, ctx.jetons.membre)).status, 400);
    await appel(ctx.base, 'DELETE', `/epopee/membres/${noe}/enrolement`, undefined, ctx.jetons.membre);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${noe}/serment`, undefined, ctx.jetons.membre)).status, 409);
  });
});

describe('le conseil de famille', () => {
  type Conseil = { from: string; to: string; label: string; current: boolean; notes: string; notesBy: string | null; rituel: unknown[]; enfants: { memberId: string; earned: number; lines: string[]; words: string[] }[] };
  const conseil = async (jeton: string, q = '') => appel(ctx.base, 'GET', '/epopee/conseil' + q, undefined, jeton);

  it('le bilan de la semaine en cours compte ce que l’enfant a gagné, et seulement les enfants enrôlés', async () => {
    await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: uuid(), ecus: 2, note: 'A consolé son frère' }, ctx.jetons.membre);
    const c = (await conseil(ctx.jetons.membre)).json as Conseil;
    assert.equal(c.current, true); assert.match(c.label, /^Semaine du lundi/); assert.equal(c.rituel.length, 3);
    assert.deepEqual(c.enfants.map((e) => e.memberId), [lena], 'Noé, retiré, n’a pas de bilan');
    assert.ok(c.enfants[0].earned >= 2); assert.ok(c.enfants[0].words.includes('A consolé son frère'));
    assert.match(c.enfants[0].lines[0], /écus? gagnés? :/);
  });
  it('une semaine passée se relit ; une semaine à venir ou un jour qui n’est pas un lundi sont refusés', async () => {
    const lundi = (await conseil(ctx.jetons.membre)).json.from as string;
    const avant = dayBefore(dayBefore(dayBefore(dayBefore(dayBefore(dayBefore(dayBefore(lundi)))))));
    const passe = await conseil(ctx.jetons.membre, `?semaine=${avant}`);
    assert.equal(passe.status, 200); assert.equal(passe.json.current, false); assert.equal(passe.json.enfants[0].earned, 0);
    assert.equal((await conseil(ctx.jetons.membre, `?semaine=${dayBefore(lundi)}`)).status, 400);
    assert.equal((await conseil(ctx.jetons.membre, '?semaine=2999-01-04')).status, 400);
    assert.equal((await conseil(ctx.jetons.membre, '?semaine=hier')).status, 400);
  });
  it('les notes du conseil se gardent par semaine, et le PDF se télécharge ; rien de cela pour un enfant', async () => {
    const lundi = (await conseil(ctx.jetons.membre)).json.from as string;
    const ecrit = await appel(ctx.base, 'PUT', '/epopee/conseil', { semaine: lundi, notes: ' On avance le coucher. ' }, ctx.jetons.membre);
    assert.deepEqual([ecrit.status, ecrit.json.notes, ecrit.json.notesBy], [200, 'On avance le coucher.', 'Camille']);
    assert.equal((await conseil(ctx.jetons.admin)).json.notes, 'On avance le coucher.');
    assert.equal((await appel(ctx.base, 'PUT', '/epopee/conseil', { notes: 'x'.repeat(2001) }, ctx.jetons.membre)).status, 400);
    const pdf = await fetch(ctx.base + '/epopee/conseil.pdf', { headers: { authorization: 'Bearer ' + ctx.jetons.membre } });
    assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal((await conseil(ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'PUT', '/epopee/conseil', { notes: 'Plus de dessert' }, ctx.jetons.enfant)).status, 403);
    assert.equal((await fetch(ctx.base + '/epopee/conseil.pdf', { headers: { authorization: 'Bearer ' + ctx.jetons.enfant } })).status, 403);
  });
});

describe('notifications sur le moment : ce que les routes émettent', () => {
  const vus: EpopeeEvent[] = [];
  let table = '', petite = '';
  before(async () => {
    onEpopeeEvent((e) => vus.push(e));
    table = (await appel(ctx.base, 'GET', '/epopee/exploits', undefined, ctx.jetons.membre)).json.exploits[0].id;
    petite = (await appel(ctx.base, 'GET', '/epopee/recompenses', undefined, ctx.jetons.membre)).json.recompenses[0].id;
    // A clean slate: no pending request, no open quest.
    const b = (await besace(ctx.jetons.membre)).json as { demandes: { id: string; status: string }[]; quetes: { id: string; status: string }[] };
    for (const d of b.demandes.filter((x) => x.status === 'attente')) await appel(ctx.base, 'POST', `/epopee/demandes/${d.id}/decision`, { accept: false }, ctx.jetons.membre);
    for (const q of b.quetes.filter((x) => x.status !== 'atteinte')) await appel(ctx.base, 'POST', `/epopee/quetes/${q.id}/abandon`, undefined, ctx.jetons.membre);
    vus.length = 0;
  });
  after(() => onEpopeeEvent(null));

  it('un exploit signalé émet une fois ; le signaler à nouveau en attente n’émet rien', async () => {
    await appel(ctx.base, 'POST', `/epopee/membres/${lena}/demandes`, { id: uuid(), exploitId: table }, ctx.jetons.enfant);
    await appel(ctx.base, 'POST', `/epopee/membres/${lena}/demandes`, { id: uuid(), exploitId: table }, ctx.jetons.enfant);
    assert.deepEqual(vus.map((e) => [e.kind, e.childId, e.actorId, e.child]), [['exploit', lena, lena, 'Lena']]);
  });
  it('un crédit, un bravo ou une étape n’émettent rien : personne n’attend de réponse', async () => {
    vus.length = 0;
    await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: uuid(), ecus: 1 }, ctx.jetons.membre);
    await appel(ctx.base, 'POST', `/epopee/membres/${lena}/exploits`, { id: uuid(), exploitId: table }, ctx.jetons.membre);
    assert.deepEqual(vus, []);
  });
  it('un trésor visé puis gagné : deux moments, avec l’auteur du geste', async () => {
    vus.length = 0;
    const q = (await appel(ctx.base, 'POST', `/epopee/membres/${lena}/quetes`, { id: uuid(), rewardId: petite }, ctx.jetons.enfant)).json.quete as { id: string; cost: number };
    await appel(ctx.base, 'POST', `/epopee/quetes/${q.id}/pacte`, { date: '2030-01-05' }, ctx.jetons.membre);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/quetes/${q.id}/echange`, undefined, ctx.jetons.enfant)).status === 409 ? vus.length : 1, 1, 'un échange refusé n’émet rien');
    while ((await besace(ctx.jetons.membre)).json.balance < q.cost) await appel(ctx.base, 'POST', `/epopee/membres/${lena}/bravos`, { id: uuid(), ecus: 3 }, ctx.jetons.membre);
    if (!vus.some((e) => e.kind === 'tresor')) await appel(ctx.base, 'POST', `/epopee/quetes/${q.id}/echange`, undefined, ctx.jetons.membre);
    assert.deepEqual(vus.map((e) => e.kind), ['quete', 'tresor']);
    const tresor = vus[1] as Extract<EpopeeEvent, { kind: 'tresor' }>;
    assert.deepEqual([tresor.id, tresor.date, tresor.actorId === camille || tresor.actorId === lena], [q.id, '2030-01-05', true]);
  });
});

describe('la photo d’un souvenir', () => {
  let souvenir = '', enCours = '';
  const voir = async (id: string, jeton: string) => {
    const res = await fetch(`${ctx.base}/epopee/quetes/${id}/photo`, { headers: { authorization: 'Bearer ' + jeton } });
    return { status: res.status, type: res.headers.get('content-type'), nosniff: res.headers.get('x-content-type-options'), corps: Buffer.from(await res.arrayBuffer()) };
  };
  const photoDe = async (id: string) => ((await besace(ctx.jetons.membre)).json.souvenirs as { id: string; photo: number | null }[]).find((q) => q.id === id)?.photo ?? null;

  before(async () => {
    souvenir = ((await besace(ctx.jetons.membre)).json.souvenirs as { id: string }[])[0].id;
    enCours = ((await besace(ctx.jetons.membre)).json.quetes as { id: string }[])[0].id;
  });

  it('un adulte pose une photo sur un souvenir ; l’enfant la voit', async () => {
    assert.equal(await photoDe(souvenir), null);
    assert.equal((await voir(souvenir, ctx.jetons.membre)).status, 404);
    const image = jpeg(800, 600, 1);
    const pose = await brut(ctx.base, `/epopee/quetes/${souvenir}/photo`, image, ctx.jetons.membre);
    assert.equal(pose.status, 201); assert.equal(typeof pose.json.quete.photo, 'number');
    const vue = await voir(souvenir, ctx.jetons.enfant);
    assert.deepEqual([vue.status, vue.type, vue.nosniff], [200, 'image/jpeg', 'nosniff']); assert.ok(vue.corps.equals(image));
  });

  it('seul un adulte la pose ou la retire, et seulement sur un moment vécu', async () => {
    assert.equal((await brut(ctx.base, `/epopee/quetes/${souvenir}/photo`, jpeg(100, 100, 2), ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'DELETE', `/epopee/quetes/${souvenir}/photo`, undefined, ctx.jetons.enfant)).status, 403);
    assert.equal((await brut(ctx.base, `/epopee/quetes/${enCours}/photo`, jpeg(100, 100, 2), ctx.jetons.membre)).status, 409);
    assert.equal((await brut(ctx.base, '/epopee/quetes/inconnue/photo', jpeg(100, 100, 2), ctx.jetons.membre)).status, 404);
  });

  it('refuse ce qui n’est pas une photo, ou une photo non réduite', async () => {
    assert.equal((await brut(ctx.base, `/epopee/quetes/${souvenir}/photo`, Buffer.from('%PDF-1.4 pas une photo'), ctx.jetons.membre)).status, 415);
    assert.equal((await brut(ctx.base, `/epopee/quetes/${souvenir}/photo`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), ctx.jetons.membre)).status, 415);
    assert.equal((await brut(ctx.base, `/epopee/quetes/${souvenir}/photo`, jpeg(9000, 9000, 3), ctx.jetons.membre)).status, 422);
    assert.equal((await voir(souvenir, ctx.jetons.membre)).type, 'image/jpeg', 'la photo en place n’a pas bougé');
  });

  it('une nouvelle photo remplace l’ancienne, et la retirer rend le souvenir sans photo', async () => {
    const avant = await photoDe(souvenir);
    const autre = png(640, 480);
    assert.equal((await brut(ctx.base, `/epopee/quetes/${souvenir}/photo`, autre, ctx.jetons.admin)).status, 201);
    assert.notEqual(await photoDe(souvenir), avant);
    assert.ok((await voir(souvenir, ctx.jetons.membre)).corps.equals(autre));
    assert.equal((await appel(ctx.base, 'GET', `/files/${avant}`, undefined, ctx.jetons.membre)).status, 404, 'genre gardé : la route commune des fichiers ne la sert pas');
    assert.equal((await appel(ctx.base, 'DELETE', `/epopee/quetes/${souvenir}/photo`, undefined, ctx.jetons.membre)).status, 200);
    assert.equal(await photoDe(souvenir), null); assert.equal((await voir(souvenir, ctx.jetons.enfant)).status, 404);
    assert.equal((await appel(ctx.base, 'DELETE', `/epopee/quetes/${souvenir}/photo`, undefined, ctx.jetons.membre)).status, 404);
  });
});

describe('une routine de plus que le matin et le soir', () => {
  type R = { id: string; kind: string; title: string; time: string; steps: { id: string; title: string; ecus: number }[] };
  const etape = { title: 'Goûter', icon: 'repas', seconds: 600, ecus: 1 };
  const routines = async () => (await besace(ctx.jetons.membre)).json.routines as R[];
  let creee = '';

  it('le moment d’une routine se déduit de son heure', () => {
    assert.deepEqual(['06:30', '11:59', '12:00', '16:45', '17:59', '18:00', '21:00'].map(kindOf), ['matin', 'matin', 'journee', 'journee', 'journee', 'soir', 'soir']);
  });

  it('un adulte crée une routine avec ses étapes ; elle se range à son heure', async () => {
    const avant = await routines();
    const fait = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/routines`, { title: ' Le retour de l’école ', time: '16:45', steps: [etape, { ...etape, title: 'Devoirs', icon: 'ecole', seconds: 1200, ecus: 2 }] }, ctx.jetons.membre);
    assert.equal(fait.status, 201, JSON.stringify(fait.json));
    creee = fait.json.id;
    const apres = fait.json.routines as R[];
    assert.equal(apres.length, avant.length + 1);
    const r = apres.find((x) => x.id === creee)!;
    assert.deepEqual([r.title, r.time, r.kind, r.steps.map((s) => s.title)], ['Le retour de l’école', '16:45', 'journee', ['Goûter', 'Devoirs']]);
    assert.deepEqual(apres.map((x) => x.time), [...apres.map((x) => x.time)].sort(), 'dans l’ordre de la journée');
  });

  it('elle se déroule comme les autres : une étape faite verse son écu', async () => {
    const r = (await routines()).find((x) => x.id === creee)!;
    const avant = (await besace(ctx.jetons.enfant)).json.balance as number;
    const fait = await appel(ctx.base, 'POST', `/epopee/etapes/${r.steps[1].id}`, { status: 'fait' }, ctx.jetons.enfant);
    assert.deepEqual([fait.status, fait.json.ecus, fait.json.balance], [201, 2, avant + 2]);
  });

  it('déplacer une routine change son moment', async () => {
    const r = (await routines()).find((x) => x.id === creee)!;
    const corps = { title: r.title, time: '18:30', steps: r.steps.map((s) => ({ id: s.id, title: s.title, icon: 'repas', seconds: 600, ecus: s.ecus })) };
    const regle = await appel(ctx.base, 'PUT', `/epopee/routines/${creee}`, corps, ctx.jetons.membre);
    assert.equal((regle.json.routines as R[]).find((x) => x.id === creee)!.kind, 'soir');
  });

  it('refuse une saisie incomplète, un enfant, un enfant non enrôlé, et une septième routine', async () => {
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/routines`, { title: 'Sans étape', time: '16:00', steps: [] }, ctx.jetons.membre)).status, 400);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/routines`, { title: '', time: '16:00', steps: [etape] }, ctx.jetons.membre)).status, 400);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/routines`, { title: 'x', time: '16h', steps: [etape] }, ctx.jetons.membre)).status, 400);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/routines`, { title: 'Jeux', time: '16:00', steps: [etape] }, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${noe}/routines`, { title: 'Jeux', time: '16:00', steps: [etape] }, ctx.jetons.membre)).status, 409);
    while ((await routines()).length < 6) assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/routines`, { title: 'Une de plus', time: '14:00', steps: [etape] }, ctx.jetons.membre)).status, 201);
    const trop = await appel(ctx.base, 'POST', `/epopee/membres/${lena}/routines`, { title: 'La septième', time: '15:00', steps: [etape] }, ctx.jetons.membre);
    assert.equal(trop.status, 409); assert.match(trop.json.error, /déjà 6 routines/);
  });

  it('retirer une routine ne reprend rien de ce qu’elle a fait gagner', async () => {
    const avant = (await besace(ctx.jetons.membre)).json.balance as number;
    assert.equal((await appel(ctx.base, 'DELETE', `/epopee/routines/${creee}`, undefined, ctx.jetons.enfant)).status, 403);
    const retire = await appel(ctx.base, 'DELETE', `/epopee/routines/${creee}`, undefined, ctx.jetons.membre);
    assert.equal(retire.status, 200); assert.ok(!(retire.json.routines as R[]).some((x) => x.id === creee));
    assert.equal((await besace(ctx.jetons.membre)).json.balance, avant);
    assert.equal((await appel(ctx.base, 'DELETE', `/epopee/routines/${creee}`, undefined, ctx.jetons.membre)).status, 404);
    assert.equal((await appel(ctx.base, 'PUT', `/epopee/routines/${creee}`, { title: 'x', time: '10:00', steps: [etape] }, ctx.jetons.membre)).status, 404);
  });
});
