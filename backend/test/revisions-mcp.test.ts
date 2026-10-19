// Les outils d'assistant du module Révisions, par le vrai point /mcp et le
// client du SDK : présents quand le module est actif et retirés quand il est
// éteint, bilan et programme réservés aux adultes (le programme à un jeton
// `write`), un enfant ne voit que lui, et « les tables de 2 à 5 pour Noé »
// réglé par l'assistant comme depuis l'écran.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

describe('Révisions : outils d’assistant (MCP)', () => {
  let ctx: Contexte;
  let adulte = '', lecture = '', enfant = '';
  const NOE = 'noe';

  const connect = async (token: string): Promise<Client> => {
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(ctx.base + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
    return c;
  };
  const call = async (token: string, name: string, args: Record<string, unknown> = {}): Promise<string> => {
    const c = await connect(token);
    try {
      const r = await c.callTool({ name, arguments: args }) as { content?: { text?: string }[] };
      return (r.content || []).map((x) => x.text || '').join('\n');
    } finally { await c.close(); }
  };
  const names = async (token: string): Promise<string[]> => { const c = await connect(token); try { return (await c.listTools()).tools.map((x) => x.name); } finally { await c.close(); } };
  const jeton = async (session: string, name: string, scope: 'read' | 'write', password: string): Promise<string> =>
    (await appel(ctx.base, 'POST', '/me/tokens', { name, scope, password }, session)).json.token as string;

  before(async () => {
    ctx = await demarrer();
    const A = ctx.jetons.admin;
    await appel(ctx.base, 'PATCH', '/settings', { changes: { mcpEnabled: true } }, A);
    adulte = await jeton(A, 'Claude adulte', 'write', 'MotDePasseSolide1');
    lecture = await jeton(A, 'Claude lecture', 'read', 'MotDePasseSolide1');
    enfant = await jeton(ctx.jetons.enfant, 'Claude de Lena', 'write', 'MotDePasseSolide7');
    const st = (await appel(ctx.base, 'GET', '/state', undefined, A)).json;
    const members = [...st.state.members, { id: NOE, name: 'Noé', role: '', color: '#7A9B76', ini: 'N', enfant: true, birthday: '2019-05-01' }];
    await appel(ctx.base, 'PUT', '/state', { version: st.version, state: { ...st.state, members } }, A);
    // Une session de Lena aujourd'hui : 6 × 7 juste, 7 × 8 fausse.
    const now = new Date().toISOString();
    const r = await appel(ctx.base, 'POST', '/revisions/sessions', {
      id: crypto.randomUUID(), exerciseId: 'tables', mode: 'entrainer', params: { tables: [6, 9] }, startedAt: now, endedAt: now, aborted: false,
      answers: [{ question: { op: 'mult', a: 6, b: 7 }, given: '42', ms: 1500, askedAt: now }, { question: { op: 'mult', a: 7, b: 8 }, given: '54', ms: 1500, askedAt: now }],
    }, ctx.jetons.enfant);
    assert.equal(r.status, 201, JSON.stringify(r.json));
  });
  after(async () => { await arreter(ctx); });

  it('outils présents ; lecture seule sans réglage ; enfant sans bilan ni réglage ; module éteint : aucun', async () => {
    const a = await names(adulte);
    for (const n of ['revisions_exercices', 'revisions_progression', 'revisions_sessions', 'revisions_bilan', 'revisions_programme_definir']) assert.ok(a.includes(n), n);
    const r = await names(lecture);
    assert.ok(r.includes('revisions_bilan') && !r.includes('revisions_programme_definir'));
    const e = await names(enfant);
    assert.ok(e.includes('revisions_progression') && !e.includes('revisions_bilan') && !e.includes('revisions_programme_definir'));
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modRevisions: false } }, ctx.jetons.admin);
    assert.ok(!(await names(adulte)).some((n) => n.startsWith('revisions')));
    assert.match(await call(adulte, 'revisions_progression'), /inconnu ou non autorisé/);
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modRevisions: true } }, ctx.jetons.admin);
  });

  it('les exercices disent leurs paramètres, pour que l’assistant sache quoi régler', async () => {
    const t = await call(adulte, 'revisions_exercices');
    assert.match(t, /Tables \[tables\] \(Mathématiques, dès 6 ans environ\)/);
    assert.match(t, /`tables` : Tables travaillées, deux entiers \[de, à\] entre 0 et 12, à au plus max ; défaut \[2,5\]/);
    assert.match(t, /`operation` : Opération, mult \(Multiplication\), add \(Addition\)/);
  });

  it('régler le programme de Noé : les tables de 2 à 5, puis le retirer ; refus nommés', async () => {
    const ok = await call(adulte, 'revisions_programme_definir', { enfant: 'noe', exercice: 'tables', params: { tables: [2, 5] }, questions: 15, objectif_jour: 2 });
    assert.match(ok, /Programme Tables de Noé enregistré : Les tables de 2 à 5, multiplication, 15 questions par session, objectif 2 session\(s\) par jour, temps selon le barème/);
    const vue = (await appel(ctx.base, 'GET', `/revisions/members/${NOE}/exercises/tables`, undefined, ctx.jetons.admin)).json;
    assert.deepEqual([vue.program.params.tables, vue.program.questions, vue.program.dailyGoal], [[2, 5], 15, 2]);
    const plus = await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', params: { operation: 'add' } });
    assert.match(plus, /Les tables de 2 à 5, addition, 15 questions/, 'les paramètres absents gardent ceux du programme en cours');
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', params: { tables: [2, 11] } }), /Refusé : « Tables travaillées » : de 0 à 10/);
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', questions: 3 }), /Refusé : `questions` entre 5 et 100/);
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Thomas' }), /pour un enfant/);
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', exercice: 'dictee' }), /Exercice inconnu/);
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', retirer: true }), /retiré\. Son historique reste/);
    assert.equal((await appel(ctx.base, 'GET', `/revisions/members/${NOE}/exercises/tables`, undefined, ctx.jetons.admin)).json.program, null);
  });

  it('progression et sessions : un enfant ne voit que lui', async () => {
    assert.match(await call(enfant, 'revisions_progression'), /^Lena, Tables : pas de programme \(réglages par défaut : Les tables de 2 à 5/);
    await call(adulte, 'revisions_programme_definir', { enfant: 'Lena', params: { tables: [6, 9] } });
    const p = await call(enfant, 'revisions_progression');
    assert.match(p, /^Lena, Tables : programme « Les tables de 6 à 9, multiplication », 20 questions/);
    assert.match(p, /Encore fragiles : 7 × 8/, 'dans le périmètre du programme');
    assert.match(await call(enfant, 'revisions_progression', { enfant: 'Noé' }), /Refusé : ce compte ne donne accès qu’à ce qui vous concerne/);
    const s = await call(enfant, 'revisions_sessions');
    assert.match(s, /Lena, 1 session\(s\) depuis le/);
    assert.match(s, /Tables \(s’entraîner, Les tables de 6 à 9, multiplication\) : 1 bonnes, 0 lentes, 1 fausses/);
    assert.match(await call(adulte, 'revisions_progression', { enfant: 'lena', exercice: 'tables' }), /^Lena, Tables/);
  });

  it('le bilan de la semaine, pour un adulte', async () => {
    const b = await call(adulte, 'revisions_bilan', { enfant: 'Lena' });
    assert.match(b, /^Lena, (semaine du lundi|du |le )/, 'la semaine en cours, du lundi à aujourd’hui');
    assert.match(b, /1 session\(s\), 2 questions, 50 % de réponses justes/);
    assert.match(b, /Mathématiques, Tables : Les tables de 6 à 9, multiplication/);
    assert.match(b, /Pour la maîtresse/);
    assert.match(await call(adulte, 'revisions_bilan', { enfant: 'Thomas' }), /pour un enfant/);
  });
});
