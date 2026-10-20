// Le module Révisions sur ses vraies routes, avec l'exercice Tables : qui lit et
// écrit quoi, la réception idempotente d'une session, la correction refaite par
// le serveur avec la définition de l'exercice, l'ordre d'arrivée qui ne change
// rien, le programme réglé par un adulte, et le module éteint puis rallumé sans
// rien perdre.
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
const q = (a: number, b: number, given: number | null, ms: number, at: string) => ({ question: { op: 'mult', a, b }, given: given === null ? null : String(given), ms, askedAt: at });
const tables = (from: number, to: number) => ({ operation: 'mult', tables: [from, to] });
const session = (answers: ReturnType<typeof q>[], extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), exerciseId: 'tables', mode: 'entrainer', params: tables(6, 9),
  startedAt: answers[0]?.askedAt ?? jour(0), endedAt: answers.at(-1)?.askedAt ?? jour(0), aborted: false, answers, ...extra,
});
const poster = (body: unknown, jeton: string) => appel(ctx.base, 'POST', '/revisions/sessions', body, jeton);
const vueTables = (membre: string) => `/revisions/members/${membre}/exercises/tables`;
const grille = async (membre: string, jeton = ctx.jetons.admin) => (await appel(ctx.base, 'GET', vueTables(membre), undefined, jeton)).json.mastery as
  { key: string; label: string; level: number; good: number; wrong: number; nextAt: string; status: string }[];
const caseDe = (g: Awaited<ReturnType<typeof grille>>, a: number, b: number) => g.find((x) => x.key === `mult:${Math.min(a, b)}x${Math.max(a, b)}`);

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
    const c = new Map(r.json.changes.map((x: { key: string; after: string }) => [x.key, x.after]));
    assert.equal(c.get('mult:6x7'), 'peu');
    assert.equal(c.get('mult:7x8'), 'peu');
    assert.equal(r.json.changes.find((x: { key: string }) => x.key === 'mult:6x7').label, '6 × 7');
  });

  it('deux envois de la même session n’en font qu’une', async () => {
    const s = session([q(6, 6, 36, 2000, jour(1))]);
    assert.equal((await poster(s, ctx.jetons.enfant)).status, 201);
    const again = await poster(s, ctx.jetons.enfant);
    assert.equal(again.status, 200);
    assert.equal(again.json.duplicate, true);
    const list = (await appel(ctx.base, 'GET', `/revisions/members/${lena}/sessions`, undefined, ctx.jetons.enfant)).json.sessions;
    assert.equal(list.filter((x: { id: string }) => x.id === s.id).length, 1);
    assert.equal(caseDe(await grille(lena), 6, 6)!.good, 1, 'la maîtrise ne compte la réponse qu’une fois');
  });

  it('juste ou faux se décide sur le serveur, d’après la question', async () => {
    const r = await poster(session([q(6, 8, 49, 1000, jour(2)), q(6, 8, 48, 1000, jour(2, 18))]), ctx.jetons.enfant);
    assert.equal(r.json.session.wrong, 1);
    assert.equal(r.json.session.good, 1);
    const h = (await appel(ctx.base, 'GET', `${vueTables(lena)}/items/mult:6x8`, undefined, ctx.jetons.enfant)).json;
    assert.deepEqual(h.answers.map((x: { given: string; expected: string; result: string }) => [x.given, x.expected, x.result]), [['48', '48', 'bon'], ['49', '48', 'faux']]);
  });

  it('6 × 7 et 7 × 6 remplissent la même case', async () => {
    await poster(session([q(7, 6, 42, 2000, jour(3))]), ctx.jetons.enfant);
    const cases = (await grille(lena)).filter((x) => x.key === 'mult:6x7' || x.key === 'mult:7x6');
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
    assert.ok(caseDe(await grille(lena), 6, 9));
  });

  it('ce qui n’est pas une session est refusé, nommé', async () => {
    for (const bad of [
      { ...session([q(6, 7, 42, 1000, jour(6))]), id: 'pas-un-uuid' },
      { ...session([q(6, 7, 42, 1000, jour(6))]), mode: 'duel' },
      { ...session([q(6, 7, 42, 1000, jour(6))]), exerciseId: 'dictee' },
      { ...session([q(6, 7, 42, 1000, jour(6))]), params: { operation: 'division' } },
      { ...session([q(6, 7, 42, 1000, jour(6))]), params: tables(9, 6) },
      session([q(6, 77, 42, 1000, jour(6))]),
      session([{ ...q(6, 7, 42, 1000, jour(6)), question: { mot: 'chat' } as unknown as ReturnType<typeof q>['question'] }]),
      session(Array.from({ length: 301 }, () => q(6, 7, 42, 1000, jour(6)))),
    ]) {
      const r = await poster(bad, ctx.jetons.enfant);
      assert.equal(r.status, 400, JSON.stringify(r.json));
      assert.ok(r.json.error);
    }
  });

  it('une réponse datée dans le futur est ramenée à maintenant', async () => {
    const r = await poster(session([q(3, 3, 9, 1000, new Date(Date.now() + 86400_000).toISOString())], { params: tables(3, 3) }), ctx.jetons.enfant);
    assert.ok(Date.parse(r.json.session.startedAt) <= Date.now() + 1000);
  });
});

describe('l’ordre d’arrivée ne change rien', () => {
  it('deux sessions arrivées dans le désordre donnent la grille de l’ordre', async () => {
    const lundi = session([q(4, 5, 20, 1500, jour(0)), q(4, 6, 23, 1500, jour(0, 18))], { params: tables(4, 4) });
    const mardi = session([q(4, 5, 20, 1500, jour(1)), q(4, 6, 24, 1500, jour(1, 18))], { params: tables(4, 4) });
    const jeudi = session([q(5, 4, 20, 1500, jour(4)), q(6, 4, 24, 1500, jour(4, 18))], { params: tables(4, 4) });
    for (const s of [lundi, mardi, jeudi]) await poster({ ...s, id: crypto.randomUUID() }, ctx.jetons.admin);
    for (const s of [jeudi, lundi, mardi]) await poster({ ...s, id: crypto.randomUUID() }, ctx.jetons.membre);
    const net = (g: Awaited<ReturnType<typeof grille>>) => g.map(({ key, level, good, wrong, nextAt, status }) => ({ key, level, good, wrong, nextAt, status }));
    assert.deepEqual(net(await grille(camille)), net(await grille(thomas)));
    assert.equal(caseDe(await grille(thomas), 4, 5)!.level, 3, 'lundi, mardi, jeudi : trois montées, chaque fois dû');
  });
});

describe('qui lit, qui écrit', () => {
  it('une session ne s’enregistre qu’au nom de qui s’entraîne, adulte compris', async () => {
    assert.equal((await poster({ ...session([q(2, 2, 4, 1000, jour(0))]), memberId: NOE }, ctx.jetons.enfant)).status, 403);
    assert.equal((await poster({ ...session([q(2, 2, 4, 1000, jour(0))]), memberId: lena }, ctx.jetons.admin)).status, 403);
  });

  it('un enfant ne lit que lui ; un adulte lit tout le monde', async () => {
    for (const chemin of [`/revisions/members/${NOE}`, vueTables(NOE), `/revisions/members/${NOE}/sessions`, `${vueTables(NOE)}/items/mult:6x7`, `${vueTables(NOE)}/stats`, vueTables(camille)]) {
      assert.equal((await appel(ctx.base, 'GET', chemin, undefined, ctx.jetons.enfant)).status, 403, chemin);
    }
    assert.equal((await appel(ctx.base, 'GET', vueTables(lena), undefined, ctx.jetons.enfant)).status, 200);
    assert.equal((await appel(ctx.base, 'GET', vueTables(lena), undefined, ctx.jetons.membre)).status, 200);
  });

  it('l’historique d’une case réunit les deux sens, les plus récentes d’abord', async () => {
    const h = (await appel(ctx.base, 'GET', `${vueTables(lena)}/items/mult:6x7`, undefined, ctx.jetons.enfant)).json;
    assert.equal(h.label, '6 × 7');
    assert.deepEqual(h.answers.map((x: { text: string }) => x.text), ['7 × 6', '6 × 7']);
  });

  it('le suivi regroupe par table, limitée aux tables travaillées (sans programme : celles par défaut, 2 à 5)', async () => {
    const st = (await appel(ctx.base, 'GET', `${vueTables(lena)}/stats?since=2026-10-01T00:00:00.000Z`, undefined, ctx.jetons.enfant)).json;
    const groupes = new Map(st.groups.map((g: { group: string; questions: number }) => [g.group, g.questions]));
    assert.equal(groupes.get('Table de 3'), 1, '3 × 3, une fois');
    assert.ok(!groupes.has('Table de 6'), '6 × 7 ne compte pour aucune table travaillée');
    assert.ok(st.days.length >= 1);
  });

  it('les exercices se décrivent, avec leur matière et leurs paramètres', async () => {
    const r = (await appel(ctx.base, 'GET', '/revisions/exercises', undefined, ctx.jetons.enfant)).json;
    const t = r.exercises.find((e: { id: string }) => e.id === 'tables');
    assert.equal(t.matiereLabel, 'Mathématiques');
    assert.equal(t.learn, true);
    assert.deepEqual(t.params.map((p: { key: string }) => p.key), ['operation', 'max', 'tables', 'bothDirections']);
  });

  it('un jeton d’accès n’entre pas dans le module', async () => {
    const t = await appel(ctx.base, 'POST', '/me/tokens', { name: 'Assistant', scope: 'write', password: 'MotDePasseSolide1' }, ctx.jetons.admin);
    assert.equal((await appel(ctx.base, 'GET', '/revisions/config', undefined, t.json.token)).status, 403);
  });

  it('sans membre du foyer, rien', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/revisions/config', undefined, ctx.jetons.sansMembre)).status, 403);
  });
});

describe('le programme d’un enfant', () => {
  const prog = { params: tables(6, 9), questions: 20, secondsAllowed: null, fastSeconds: null, dailyGoal: 1 };
  const regler = (membre: string, body: unknown, jeton: string) => appel(ctx.base, 'PUT', `${vueTables(membre)}/program`, body, jeton);

  it('se règle par un adulte, pour un enfant seulement', async () => {
    assert.equal((await regler(lena, prog, ctx.jetons.enfant)).status, 403);
    assert.equal((await regler(camille, prog, ctx.jetons.admin)).status, 400);
    const r = await regler(lena, prog, ctx.jetons.membre);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.program.setBy, camille);
    const vue = (await appel(ctx.base, 'GET', vueTables(lena), undefined, ctx.jetons.enfant)).json;
    assert.deepEqual(vue.program.params, { operation: 'mult', max: 10, tables: [6, 9], bothDirections: true }, 'les paramètres absents prennent leur défaut');
    assert.deepEqual(vue.params.tables, [6, 9]);
    const accueil = (await appel(ctx.base, 'GET', `/revisions/members/${lena}`, undefined, ctx.jetons.enfant)).json;
    assert.deepEqual(accueil.programs.map((p: { exerciseId: string }) => p.exerciseId), ['tables'], 'l’entraînement du jour : un programme par exercice');
    assert.equal(vue.timing.source, 'bareme');
    assert.equal(vue.timing.allowedMs, 8000);
  });

  it('refuse ce qui n’a pas de sens', async () => {
    for (const bad of [{ ...prog, params: tables(9, 6) }, { ...prog, params: tables(6, 11) }, { ...prog, questions: 2 }, { ...prog, secondsAllowed: 3, fastSeconds: 5 },
      { ...prog, params: { operation: 'division' } }, { ...prog, params: { max: 13 } }, { ...prog, params: { bothDirections: 'oui' } }]) {
      const r = await regler(lena, bad, ctx.jetons.admin);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.ok(r.json.error);
    }
    assert.equal((await appel(ctx.base, 'PUT', `/revisions/members/${lena}/exercises/conjugaison/program`, prog, ctx.jetons.admin)).status, 400, 'exercice inconnu');
  });

  it('un nouveau programme remplace l’ancien, qui reste en base', async () => {
    const r = await regler(lena, { ...prog, params: tables(2, 5), secondsAllowed: 10 }, ctx.jetons.admin);
    const vue = (await appel(ctx.base, 'GET', vueTables(lena), undefined, ctx.jetons.admin)).json;
    assert.equal(vue.program.id, r.json.program.id);
    assert.equal(vue.timing.source, 'programme');
    assert.equal(vue.timing.allowedMs, 10000);
    const { programById } = await import('../src/revisions/repo');
    assert.equal(programById(r.json.program.id - 1)?.active, 0, 'l’ancien programme existe toujours, inactif');
  });

  it('jusqu’à 12 si le programme le demande : la dernière table est un paramètre de l’exercice', async () => {
    assert.equal((await regler(lena, { ...prog, params: { ...tables(6, 12), max: 12 } }, ctx.jetons.admin)).status, 200);
    const vue = (await appel(ctx.base, 'GET', vueTables(lena), undefined, ctx.jetons.enfant)).json;
    assert.equal(vue.params.max, 12);
    const s = await poster(session([q(12, 11, 132, 1000, jour(8))], { programId: vue.program.id }), ctx.jetons.enfant);
    assert.equal(s.status, 201, JSON.stringify(s.json));
    assert.deepEqual(s.json.session.params.tables, [6, 12], 'une session de programme prend les paramètres du programme');
  });

  it('un programme ne sert qu’à son enfant, et qu’à son exercice', async () => {
    const vue = (await appel(ctx.base, 'GET', vueTables(lena), undefined, ctx.jetons.enfant)).json;
    assert.equal((await poster(session([q(6, 7, 42, 1000, jour(8))], { programId: vue.program.id }), ctx.jetons.admin)).status, 400);
  });

  it('se retire sans rien effacer', async () => {
    const vue = (await appel(ctx.base, 'GET', vueTables(lena), undefined, ctx.jetons.admin)).json;
    assert.equal((await appel(ctx.base, 'DELETE', `${vueTables(lena)}/program`, undefined, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'DELETE', `${vueTables(lena)}/program`, undefined, ctx.jetons.admin)).status, 200);
    assert.equal((await appel(ctx.base, 'GET', vueTables(lena), undefined, ctx.jetons.admin)).json.program, null);
    const { programById } = await import('../src/revisions/repo');
    assert.equal(programById(vue.program.id)?.active, 0);
    assert.equal((await appel(ctx.base, 'DELETE', `${vueTables(lena)}/program`, undefined, ctx.jetons.admin)).status, 404);
  });
});

describe('la dictée et ses listes', () => {
  const dict = (mots: [string, string | null][], params: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(), exerciseId: 'dictee', mode: 'entrainer', params, startedAt: jour(2), endedAt: jour(2), aborted: false,
    answers: mots.map(([mot, given], i) => ({ question: { mot }, given, ms: 6000, askedAt: jour(2, 17 + i) })), ...extra,
  });
  let semaine = '';

  it('les listes livrées se lisent par tout membre, enfant compris', async () => {
    const r = await appel(ctx.base, 'GET', '/revisions/exercises/dictee/content', undefined, ctx.jetons.enfant);
    assert.equal(r.status, 200);
    assert.ok(r.json.lists.some((l: { id: string; source: string }) => l.id === 'invariables-ce1' && l.source === 'livre'));
    assert.equal((await appel(ctx.base, 'GET', '/revisions/exercises/tables/content', undefined, ctx.jetons.enfant)).status, 400, 'Tables n’a pas de listes');
  });

  it('la liste de la semaine se saisit par un adulte, se modifie et s’archive sans s’effacer', async () => {
    const corps = { label: 'Semaine 12', items: ['oiseau', 'école', ' oiseau ', 'maison'] };
    assert.equal((await appel(ctx.base, 'POST', '/revisions/exercises/dictee/content', corps, ctx.jetons.enfant)).status, 403);
    for (const bad of [{ ...corps, label: '' }, { ...corps, items: [] }, { ...corps, items: ['x'.repeat(41)] }]) {
      assert.equal((await appel(ctx.base, 'POST', '/revisions/exercises/dictee/content', bad, ctx.jetons.admin)).status, 400, JSON.stringify(bad));
    }
    const r = await appel(ctx.base, 'POST', '/revisions/exercises/dictee/content', corps, ctx.jetons.membre);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    semaine = r.json.list.id;
    assert.match(semaine, /^foyer-\d+$/);
    assert.deepEqual(r.json.list.items, ['oiseau', 'école', 'maison'], 'sans doublon');
    const m = await appel(ctx.base, 'PATCH', `/revisions/exercises/dictee/content/${semaine}`, { items: ['oiseau', 'école', 'maison', 'aujourd’hui'] }, ctx.jetons.admin);
    assert.equal(m.json.list.items.length, 4);
    assert.equal((await appel(ctx.base, 'PATCH', '/revisions/exercises/dictee/content/invariables-ce1', { label: 'x' }, ctx.jetons.admin)).status, 400, 'une liste livrée ne se modifie pas ici');
    assert.equal((await appel(ctx.base, 'PATCH', '/revisions/exercises/dictee/content/foyer-9999', { label: 'x' }, ctx.jetons.admin)).status, 404);
  });

  it('une session de dictée : la correction du serveur tient compte des accents, pas de la casse', async () => {
    const r = await poster(dict([['oiseau', 'Oiseau'], ['école', 'ecole'], ['maison', null]], { liste: semaine }), ctx.jetons.enfant);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual([r.json.session.good + r.json.session.slow, r.json.session.wrong], [1, 2]);
    const v = (await appel(ctx.base, 'GET', `/revisions/members/${lena}/exercises/dictee`, undefined, ctx.jetons.enfant)).json;
    assert.deepEqual(v.mastery.map((x: { label: string }) => x.label).sort(), ['maison', 'oiseau', 'école']);
    assert.ok(v.timing.allowedMs >= 20000, 'la dictée a son propre temps dans le barème');
  });

  it('une question hors des réglages de la session est refusée, pour la dictée comme pour Tables', async () => {
    const r = await poster(dict([['papillon', 'papillon']], { liste: semaine }), ctx.jetons.enfant);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /hors des réglages/);
    assert.equal((await poster(dict([['oiseau', 'oiseau']], { liste: 'inconnue' }), ctx.jetons.enfant)).status, 400);
    assert.equal((await poster(session([q(2, 3, 6, 1000, jour(3))], { params: tables(6, 9) }), ctx.jetons.enfant)).status, 400, '2 × 3 hors des tables 6 à 9');
  });

  it('une liste archivée reste lisible par le programme qui la désigne', async () => {
    assert.equal((await appel(ctx.base, 'PUT', `/revisions/members/${lena}/exercises/dictee/program`, { params: { liste: semaine }, questions: 10, dailyGoal: 1 }, ctx.jetons.admin)).status, 200);
    await appel(ctx.base, 'PATCH', `/revisions/exercises/dictee/content/${semaine}`, { archived: true }, ctx.jetons.admin);
    const v = (await appel(ctx.base, 'GET', `/revisions/members/${lena}/exercises/dictee`, undefined, ctx.jetons.enfant)).json;
    assert.equal(v.params.liste, semaine);
    const l = (await appel(ctx.base, 'GET', '/revisions/exercises/dictee/content', undefined, ctx.jetons.enfant)).json.lists.find((x: { id: string }) => x.id === semaine);
    assert.equal(l.archived, true);
    await appel(ctx.base, 'DELETE', `/revisions/members/${lena}/exercises/dictee/program`, undefined, ctx.jetons.admin);
  });

  it('une liste livrée se surcharge ou s’ajoute dans le dossier de données', async () => {
    const dir = path.join(ctx.dir, 'revisions', 'dictee');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mots-invariables.json'), JSON.stringify({ listes: [{ id: 'invariables-ce1', label: 'Ma version', items: ['avec'] }] }));
    fs.writeFileSync(path.join(dir, 'animaux.json'), JSON.stringify({ listes: [{ id: 'animaux', label: 'Les animaux', items: ['chat', 'chien'] }, { id: 'foyer-1', label: 'interdit', items: ['x'] }] }));
    const lists = (await appel(ctx.base, 'GET', '/revisions/exercises/dictee/content', undefined, ctx.jetons.enfant)).json.lists as { id: string; label: string }[];
    assert.equal(lists.find((l) => l.id === 'invariables-ce1')!.label, 'Ma version', 'au même nom, le fichier remplace');
    assert.ok(!lists.some((l) => l.id === 'invariables-ce2'), 'tout le fichier livré est remplacé');
    assert.ok(lists.some((l) => l.id === 'animaux'), 'sous un autre nom, il s’ajoute');
    assert.ok(!lists.some((l) => l.label === 'interdit'), 'un identifiant réservé au foyer est écarté');
    fs.rmSync(dir, { recursive: true });
  });
});

describe('le bilan d’un enfant', () => {
  const brut = async (chemin: string, jeton: string) => {
    const r = await fetch(ctx.base + chemin, { headers: { authorization: 'Bearer ' + jeton } });
    return { status: r.status, type: r.headers.get('content-type') ?? '', disposition: r.headers.get('content-disposition') ?? '', body: Buffer.from(await r.arrayBuffer()) };
  };
  const periode = '?from=2026-10-12&to=2026-10-18';

  it('se lit par un adulte, pour un enfant, par matière puis par exercice', async () => {
    const r = await appel(ctx.base, 'GET', `/revisions/members/${lena}/bilan${periode}`, undefined, ctx.jetons.membre);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.label, 'Semaine du lundi 12 au dimanche 18 octobre 2026');
    assert.equal(r.json.matieres[0].label, 'Mathématiques');
    const e = r.json.matieres[0].exercises[0];
    assert.equal(e.id, 'tables');
    assert.ok(e.totals.sessions > 0 && e.groups.length > 0);
  });

  it('un enfant ne le lit pas, un adulte n’en a pas, une période absurde est refusée', async () => {
    assert.equal((await appel(ctx.base, 'GET', `/revisions/members/${lena}/bilan`, undefined, ctx.jetons.enfant)).status, 403);
    assert.equal((await brut(`/revisions/members/${lena}/bilan.pdf`, ctx.jetons.enfant)).status, 403);
    assert.equal((await brut(`/revisions/members/${lena}/sessions.csv`, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', `/revisions/members/${thomas}/bilan`, undefined, ctx.jetons.admin)).status, 400);
    assert.equal((await appel(ctx.base, 'GET', `/revisions/members/${lena}/bilan?from=2026-10-18&to=2026-10-12`, undefined, ctx.jetons.admin)).status, 400);
    assert.equal((await appel(ctx.base, 'GET', `/revisions/members/${lena}/bilan?from=12/10/2026`, undefined, ctx.jetons.admin)).status, 400);
    assert.equal((await appel(ctx.base, 'GET', `/revisions/members/${lena}/bilan?from=2024-01-01&to=2026-10-18`, undefined, ctx.jetons.admin)).status, 400);
  });

  it('en PDF pour la maîtresse : le nom de l’enfant, et celui d’aucun autre membre', async () => {
    const r = await brut(`/revisions/members/${lena}/bilan.pdf${periode}`, ctx.jetons.membre);
    assert.equal(r.status, 200);
    assert.equal(r.type, 'application/pdf');
    assert.match(r.disposition, /revisions-Lena-2026-10-12-2026-10-18\.pdf/);
    const txt = r.body.toString('latin1');
    assert.match(txt, /^%PDF/);
    assert.match(txt, /Révisions de Lena/);
    for (const autre of ['Camille', 'Thomas', 'Noé']) assert.doesNotMatch(txt, new RegExp(autre), autre);
  });

  it('les sessions en CSV', async () => {
    const r = await brut(`/revisions/members/${lena}/sessions.csv${periode}`, ctx.jetons.admin);
    assert.equal(r.status, 200);
    assert.match(r.type, /^text\/csv/);
    const texte = r.body.toString('utf-8');
    assert.ok(texte.startsWith('\ufeffDate;Heure;Exercice'), 'BOM et en-tête');
    const lignes = texte.trim().split('\r\n');
    assert.ok(lignes.length > 1);
    assert.ok(lignes.slice(1).every((l) => ['Tables', 'Dictée de mots'].includes(l.split(';')[2])));
    assert.ok(lignes.some((l) => l.split(';')[2] === 'Dictée de mots' && /La liste « Semaine 12 »/.test(l)), 'le résumé d’une session de dictée nomme sa liste');
  });
});

describe('la session d’un enfant ouverte par un parent', () => {
  it('s’enregistre au nom de l’enfant, avec le parent qui l’a ouverte', async () => {
    const login = await fetch(ctx.base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'membre@example.fr', password: 'MotDePasseSolide2' }) });
    const cookie = (c: Response) => c.headers.getSetCookie().find((x) => x.startsWith('foyer_session='))!.split(';')[0];
    const sw = await fetch(ctx.base + `/auth/switch/${NOE}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(login) }, body: '{}' });
    const r = await fetch(ctx.base + '/revisions/sessions', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(sw) }, body: JSON.stringify(session([q(2, 3, 6, 4000, jour(0))], { params: tables(2, 3) })) });
    const j = await r.json();
    assert.equal(r.status, 201, JSON.stringify(j));
    assert.equal(j.session.via, camille);
    assert.equal(j.session.good, 1, 'Noé a 6 ans : 4 s restent rapides pour lui');
  });
});

describe('la commande revisions:recalcul', () => {
  const lancer = (...args: string[]): string => execFileSync(process.execPath, ['--import', 'tsx', path.join(__dirname, '..', 'src', 'revisions', 'recalcul.ts'), ...args], {
    env: { ...process.env, FOYER_DATA_DIR: ctx.dir, FOYER_DB_PATH: path.join(ctx.dir, 'foyer.db') }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });

  it('reconstruit une grille effacée à l’identique, sans toucher aux réponses', async () => {
    const avant = await grille(thomas);
    const { db } = await import('../src/db');
    db.prepare('DELETE FROM rev_mastery WHERE member_id = ?').run(thomas);
    assert.deepEqual(await grille(thomas), []);
    assert.match(lancer('--membre', thomas), /2 item\(s\) recalculé\(s\)/);
    assert.deepEqual(await grille(thomas), avant);
    db.prepare('DELETE FROM rev_mastery WHERE member_id = ?').run(thomas);
    assert.match(lancer('--membre', thomas, '--exercice', 'tables'), /exercice tables : 2 item/);
    assert.deepEqual(await grille(thomas), avant);
  });

  it('refuse un exercice inconnu, en le nommant', () => {
    assert.throws(() => lancer('--membre', thomas, '--exercice', 'conjugaison'), (e: { stderr: string }) => /exercice inconnu : conjugaison/.test(e.stderr));
  });

  it('ne reclasse le passé que sur demande explicite', async () => {
    const surcharge = path.join(ctx.dir, 'revisions', 'bareme.json');
    fs.mkdirSync(path.dirname(surcharge), { recursive: true });
    fs.writeFileSync(surcharge, JSON.stringify({ exercices: { tables: { adulte: { accorde: 4, rapide: 1 } } } }));
    assert.doesNotMatch(lancer('--membre', thomas), /reclassée/);
    const { db } = await import('../src/db');
    const lentes = () => (db.prepare("SELECT COUNT(*) AS n FROM rev_answers WHERE member_id = ? AND result = 'lent'").get(thomas) as { n: number }).n;
    assert.equal(lentes(), 0, 'sans --reclasser, rien ne change');
    assert.match(lancer('--membre', thomas, '--reclasser'), /5 réponse\(s\) reclassée\(s\)/);
    assert.equal(lentes(), 5, 'les cinq justes, en 1,5 s, dépassent désormais le seuil rapide d’un adulte ; la fausse reste fausse');
    fs.rmSync(surcharge);
  });

  it('dit quand il n’y a personne à recalculer', () => {
    assert.match(lancer('--membre', 'personne'), /aucun membre ni aucune réponse/);
  });
});

describe('le module éteint', () => {
  it('ferme ses accès, et rallumé retrouve tout', async () => {
    const avant = await grille(lena);
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { modRevisions: false } }, ctx.jetons.admin)).status, 200);
    assert.equal((await poster(session([q(6, 7, 42, 1000, jour(7))]), ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', vueTables(lena), undefined, ctx.jetons.admin)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', '/revisions/exercises', undefined, ctx.jetons.admin)).status, 403);
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { modRevisions: true } }, ctx.jetons.admin)).status, 200);
    assert.deepEqual(await grille(lena), avant);
  });
});
