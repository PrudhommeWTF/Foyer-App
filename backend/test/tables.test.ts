// Le module Tables sur ses vraies routes : qui lit et écrit quoi, la réception
// idempotente d'une session, la correction refaite par le serveur, l'ordre
// d'arrivée qui ne change rien, le programme réglé par un adulte, et le module
// éteint puis rallumé sans rien perdre.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
let lena = '', camille = '', thomas = '';
const NOE = 'noe';

const jour = (d: number, h = 17): string => new Date(Date.UTC(2026, 9, 12 + d, h, 0, 0)).toISOString();
const q = (a: number, b: number, given: number | null, ms: number, at: string) => ({ a, b, given, ms, askedAt: at });
const session = (answers: ReturnType<typeof q>[], extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), mode: 'entrainer', operation: 'multiplication', from: 6, to: 9,
  startedAt: answers[0]?.askedAt ?? jour(0), endedAt: answers.at(-1)?.askedAt ?? jour(0), aborted: false, answers, ...extra,
});
const poster = (body: unknown, jeton: string) => appel(ctx.base, 'POST', '/tables/sessions', body, jeton);
const grille = async (membre: string, jeton = ctx.jetons.admin) => (await appel(ctx.base, 'GET', `/tables/members/${membre}`, undefined, jeton)).json.mastery as
  { a: number; b: number; level: number; good: number; wrong: number; nextAt: string; status: string }[];

before(async () => {
  ctx = await demarrer();
  const etat = await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin);
  const ms = etat.json.state.members as { id: string; name: string }[];
  lena = ms.find((m) => m.name === 'Lena')!.id;
  camille = ms.find((m) => m.name === 'Camille')!.id;
  thomas = ms.find((m) => m.name === 'Thomas')!.id;
  const members = [
    ...etat.json.state.members.map((m: { id: string }) => (m.id === lena ? { ...m, birthday: '2018-03-12' } : m)),
    { id: NOE, name: 'Noé', role: '', color: '#7A9B76', ini: 'N', enfant: true, birthday: '2020-01-01' },
  ];
  const put = await appel(ctx.base, 'PUT', '/state', { version: etat.json.version, state: { ...etat.json.state, members } }, ctx.jetons.admin);
  assert.equal(put.status, 200, JSON.stringify(put.json));
});
after(async () => { await arreter(ctx); });

describe('recevoir une session', () => {
  it('un enfant enregistre sa session : le serveur compte et colorie', async () => {
    const r = await poster(session([q(6, 7, 42, 2500, jour(0)), q(8, 9, 72, 6000, jour(0, 18)), q(7, 8, 54, 2000, jour(0, 19))]), ctx.jetons.enfant);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual([r.json.session.good, r.json.session.slow, r.json.session.wrong], [1, 1, 1], 'Lena a 8 ans : rapide sous 4 s');
    const c = new Map(r.json.changes.map((x: { a: number; b: number; after: string }) => [`${x.a}x${x.b}`, x.after]));
    assert.equal(c.get('6x7'), 'peu');
    assert.equal(c.get('7x8'), 'peu');
  });

  it('deux envois de la même session n’en font qu’une', async () => {
    const s = session([q(6, 6, 36, 2000, jour(1))]);
    assert.equal((await poster(s, ctx.jetons.enfant)).status, 201);
    const again = await poster(s, ctx.jetons.enfant);
    assert.equal(again.status, 200);
    assert.equal(again.json.duplicate, true);
    const list = (await appel(ctx.base, 'GET', `/tables/members/${lena}/sessions`, undefined, ctx.jetons.enfant)).json.sessions;
    assert.equal(list.filter((x: { id: string }) => x.id === s.id).length, 1);
    assert.equal((await grille(lena)).find((x) => x.a === 6 && x.b === 6)!.good, 1, 'la maîtrise ne compte la réponse qu’une fois');
  });

  it('juste ou faux se décide sur le serveur, d’après la question', async () => {
    const r = await poster(session([q(6, 8, 49, 1000, jour(2))]), ctx.jetons.enfant);
    assert.equal(r.json.session.wrong, 1);
  });

  it('6 × 7 et 7 × 6 remplissent la même case', async () => {
    await poster(session([q(7, 6, 42, 2000, jour(3))]), ctx.jetons.enfant);
    const cases = (await grille(lena)).filter((x) => (x.a === 6 && x.b === 7) || (x.a === 7 && x.b === 6));
    assert.equal(cases.length, 1);
    assert.equal(cases[0].good, 2);
  });

  it('le mode Apprendre est gardé, sans toucher à la maîtrise', async () => {
    const avant = await grille(lena);
    const r = await poster(session([q(9, 9, 81, 0, jour(4))], { mode: 'apprendre' }), ctx.jetons.enfant);
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.changes, []);
    assert.deepEqual(await grille(lena), avant);
  });

  it('une session abandonnée compte ses réponses déjà données', async () => {
    const r = await poster(session([q(9, 6, 54, 3000, jour(5))], { aborted: true }), ctx.jetons.enfant);
    assert.equal(r.json.session.aborted, true);
    assert.ok((await grille(lena)).some((x) => x.a === 6 && x.b === 9));
  });

  it('ce qui n’est pas une session est refusé, nommé', async () => {
    for (const bad of [
      { ...session([q(6, 7, 42, 1000, jour(6))]), id: 'pas-un-uuid' },
      { ...session([q(6, 7, 42, 1000, jour(6))]), mode: 'duel' },
      { ...session([q(6, 7, 42, 1000, jour(6))]), operation: 'division' },
      session([q(6, 77, 42, 1000, jour(6))]),
      session(Array.from({ length: 301 }, () => q(6, 7, 42, 1000, jour(6)))),
    ]) {
      const r = await poster(bad, ctx.jetons.enfant);
      assert.equal(r.status, 400, JSON.stringify(r.json));
      assert.ok(r.json.error);
    }
  });

  it('une réponse datée dans le futur est ramenée à maintenant', async () => {
    const r = await poster(session([q(3, 3, 9, 1000, new Date(Date.now() + 86400_000).toISOString())], { from: 3, to: 3 }), ctx.jetons.enfant);
    assert.ok(Date.parse(r.json.session.startedAt) <= Date.now() + 1000);
  });
});

describe('l’ordre d’arrivée ne change rien', () => {
  it('deux sessions arrivées dans le désordre donnent la grille de l’ordre', async () => {
    const lundi = session([q(4, 5, 20, 1500, jour(0)), q(4, 6, 23, 1500, jour(0, 18))], { from: 4, to: 4 });
    const mardi = session([q(4, 5, 20, 1500, jour(1)), q(4, 6, 24, 1500, jour(1, 18))], { from: 4, to: 4 });
    const jeudi = session([q(5, 4, 20, 1500, jour(4)), q(6, 4, 24, 1500, jour(4, 18))], { from: 4, to: 4 });
    for (const s of [lundi, mardi, jeudi]) await poster({ ...s, id: crypto.randomUUID() }, ctx.jetons.admin);
    for (const s of [jeudi, lundi, mardi]) await poster({ ...s, id: crypto.randomUUID() }, ctx.jetons.membre);
    const net = (g: Awaited<ReturnType<typeof grille>>) => g.map(({ a, b, level, good, wrong, nextAt, status }) => ({ a, b, level, good, wrong, nextAt, status }));
    assert.deepEqual(net(await grille(camille)), net(await grille(thomas)));
    assert.equal((await grille(thomas)).find((x) => x.a === 4 && x.b === 5)!.level, 3, 'lundi, mardi, jeudi : trois montées, chaque fois dû');
  });
});

describe('qui lit, qui écrit', () => {
  it('une session ne s’enregistre qu’au nom de qui s’entraîne, adulte compris', async () => {
    assert.equal((await poster({ ...session([q(2, 2, 4, 1000, jour(0))]), memberId: NOE }, ctx.jetons.enfant)).status, 403);
    assert.equal((await poster({ ...session([q(2, 2, 4, 1000, jour(0))]), memberId: lena }, ctx.jetons.admin)).status, 403);
  });

  it('un enfant ne lit que lui ; un adulte lit tout le monde', async () => {
    for (const chemin of [`/tables/members/${NOE}`, `/tables/members/${NOE}/sessions`, `/tables/members/${NOE}/pairs/multiplication/6/7`, `/tables/members/${camille}`]) {
      assert.equal((await appel(ctx.base, 'GET', chemin, undefined, ctx.jetons.enfant)).status, 403, chemin);
    }
    assert.equal((await appel(ctx.base, 'GET', `/tables/members/${lena}`, undefined, ctx.jetons.enfant)).status, 200);
    assert.equal((await appel(ctx.base, 'GET', `/tables/members/${lena}`, undefined, ctx.jetons.membre)).status, 200);
  });

  it('l’historique d’une case réunit les deux sens, les plus récentes d’abord', async () => {
    const h = (await appel(ctx.base, 'GET', `/tables/members/${lena}/pairs/multiplication/7/6`, undefined, ctx.jetons.enfant)).json;
    assert.deepEqual([h.a, h.b], [6, 7]);
    assert.deepEqual(h.answers.map((x: { a: number; b: number }) => `${x.a}x${x.b}`), ['7x6', '6x7']);
  });

  it('un jeton d’accès n’entre pas dans le module', async () => {
    const t = await appel(ctx.base, 'POST', '/me/tokens', { name: 'Assistant', scope: 'write', password: 'MotDePasseSolide1' }, ctx.jetons.admin);
    assert.equal((await appel(ctx.base, 'GET', '/tables/config', undefined, t.json.token)).status, 403);
  });

  it('sans membre du foyer, rien', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/tables/config', undefined, ctx.jetons.sansMembre)).status, 403);
  });
});

describe('le programme d’un enfant', () => {
  const prog = { operation: 'multiplication', from: 6, to: 9, questions: 20, secondsAllowed: null, fastSeconds: null, dailyGoal: 1, bothDirections: true };

  it('se règle par un adulte, pour un enfant seulement', async () => {
    assert.equal((await appel(ctx.base, 'PUT', `/tables/members/${lena}/program`, prog, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'PUT', `/tables/members/${camille}/program`, prog, ctx.jetons.admin)).status, 400);
    const r = await appel(ctx.base, 'PUT', `/tables/members/${lena}/program`, prog, ctx.jetons.membre);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.program.setBy, camille);
    const vue = (await appel(ctx.base, 'GET', `/tables/members/${lena}`, undefined, ctx.jetons.enfant)).json;
    assert.equal(vue.program.to, 9);
    assert.equal(vue.timing.source, 'bareme');
    assert.equal(vue.timing.allowedMs, 8000);
  });

  it('refuse ce qui n’a pas de sens', async () => {
    for (const bad of [{ ...prog, from: 9, to: 6 }, { ...prog, to: 11 }, { ...prog, questions: 2 }, { ...prog, secondsAllowed: 3, fastSeconds: 5 }, { ...prog, operation: 'division' }]) {
      assert.equal((await appel(ctx.base, 'PUT', `/tables/members/${lena}/program`, bad, ctx.jetons.admin)).status, 400, JSON.stringify(bad));
    }
  });

  it('un nouveau programme remplace l’ancien, qui reste en base', async () => {
    const r = await appel(ctx.base, 'PUT', `/tables/members/${lena}/program`, { ...prog, from: 2, to: 5, secondsAllowed: 10 }, ctx.jetons.admin);
    const vue = (await appel(ctx.base, 'GET', `/tables/members/${lena}`, undefined, ctx.jetons.admin)).json;
    assert.equal(vue.program.id, r.json.program.id);
    assert.equal(vue.timing.source, 'programme');
    assert.equal(vue.timing.allowedMs, 10000);
    const { programById } = await import('../src/tables/repo');
    assert.equal(programById(r.json.program.id - 1)?.active, 0, 'l’ancien programme existe toujours, inactif');
  });

  it('jusqu’à 12 si le foyer le demande', async () => {
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { tablesMax: 12 } }, ctx.jetons.admin)).status, 200);
    assert.equal((await appel(ctx.base, 'PUT', `/tables/members/${lena}/program`, { ...prog, to: 12 }, ctx.jetons.admin)).status, 200);
    assert.equal((await appel(ctx.base, 'GET', '/tables/config', undefined, ctx.jetons.enfant)).json.tablesMax, 12);
    await appel(ctx.base, 'PATCH', '/settings', { changes: { tablesMax: 10 } }, ctx.jetons.admin);
  });
});

describe('la session d’un enfant ouverte par un parent', () => {
  it('s’enregistre au nom de l’enfant, avec le parent qui l’a ouverte', async () => {
    const login = await fetch(ctx.base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'membre@example.fr', password: 'MotDePasseSolide2' }) });
    const cookie = (c: Response) => c.headers.getSetCookie().find((x) => x.startsWith('foyer_session='))!.split(';')[0];
    const sw = await fetch(ctx.base + `/auth/switch/${NOE}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(login) }, body: '{}' });
    const r = await fetch(ctx.base + '/tables/sessions', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(sw) }, body: JSON.stringify(session([q(2, 3, 6, 4000, jour(0))], { from: 2, to: 3 })) });
    const j = await r.json();
    assert.equal(r.status, 201, JSON.stringify(j));
    assert.equal(j.session.via, camille);
    assert.equal(j.session.good, 1, 'Noé a 6 ans : 4 s restent rapides pour lui');
  });
});

describe('la commande tables:recalcul', () => {
  const lancer = (...args: string[]): string => execFileSync(process.execPath, ['--import', 'tsx', path.join(__dirname, '..', 'src', 'tables', 'recalcul.ts'), ...args], {
    env: { ...process.env, FOYER_DATA_DIR: ctx.dir, FOYER_DB_PATH: path.join(ctx.dir, 'foyer.db') }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });

  it('reconstruit une grille effacée à l’identique, sans toucher aux réponses', async () => {
    const avant = await grille(thomas);
    const { db } = await import('../src/db');
    db.prepare('DELETE FROM tab_mastery WHERE member_id = ?').run(thomas);
    assert.deepEqual(await grille(thomas), []);
    assert.match(lancer('--membre', thomas), /opération\(s\) recalculée\(s\)/);
    assert.deepEqual(await grille(thomas), avant);
  });

  it('ne reclasse le passé que sur demande explicite', async () => {
    fs.writeFileSync(path.join(ctx.dir, 'tables-bareme.json'), JSON.stringify({ adulte: { accorde: 4, rapide: 1 } }));
    assert.doesNotMatch(lancer('--membre', thomas), /reclassée/);
    const { db } = await import('../src/db');
    const lentes = () => (db.prepare("SELECT COUNT(*) AS n FROM tab_answers WHERE member_id = ? AND result = 'lent'").get(thomas) as { n: number }).n;
    assert.equal(lentes(), 0, 'sans --reclasser, rien ne change');
    assert.match(lancer('--membre', thomas, '--reclasser'), /5 réponse\(s\) reclassée\(s\)/);
    assert.equal(lentes(), 5, 'les cinq justes, en 1,5 s, dépassent désormais le seuil rapide d’un adulte ; la fausse reste fausse');
    fs.rmSync(path.join(ctx.dir, 'tables-bareme.json'));
  });

  it('dit quand il n’y a personne à recalculer', () => {
    assert.match(lancer('--membre', 'personne'), /aucun membre ni aucune réponse/);
  });
});

describe('le module éteint', () => {
  it('ferme ses accès, et rallumé retrouve tout', async () => {
    const avant = await grille(lena);
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { modTables: false } }, ctx.jetons.admin)).status, 200);
    assert.equal((await poster(session([q(6, 7, 42, 1000, jour(7))]), ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', `/tables/members/${lena}`, undefined, ctx.jetons.admin)).status, 403);
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { modTables: true } }, ctx.jetons.admin)).status, 200);
    assert.deepEqual(await grille(lena), avant);
  });
});
