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
    assert.match(t, /Dictée de mots \[dictee\] \(Français, dès 6 ans environ\)/);
    assert.match(t, /`liste` : Liste de mots, l’identifiant d’une liste : invariables-ce1 \(« Mots invariables \(CE1\) », 30 mots\)/);
  });

  it('régler le programme de Noé : les tables de 2 à 5, puis le retirer ; refus nommés', async () => {
    const ok = await call(adulte, 'revisions_programme_definir', { enfant: 'noe', exercice: 'tables', params: { tables: [2, 5] }, questions: 15, objectif_jour: 2 });
    assert.match(ok, /Programme Tables de Noé enregistré : Les tables de 2 à 5, multiplication, 15 questions par session, objectif 2 session\(s\) par jour, temps selon le barème/);
    const vue = (await appel(ctx.base, 'GET', `/revisions/members/${NOE}/exercises/tables`, undefined, ctx.jetons.admin)).json;
    assert.deepEqual([vue.program.params.tables, vue.program.questions, vue.program.dailyGoal], [[2, 5], 15, 2]);
    const plus = await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', exercice: 'tables', params: { operation: 'add' } });
    assert.match(plus, /Les tables de 2 à 5, addition, 15 questions/, 'les paramètres absents gardent ceux du programme en cours');
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', exercice: 'tables', params: { tables: [2, 11] } }), /Refusé : « Tables travaillées » : de 0 à 10/);
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', exercice: 'tables', questions: 3 }), /Refusé : `questions` entre 5 et 100/);
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Thomas', exercice: 'tables' }), /pour un enfant/);
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé' }), /Précisez `exercice` : tables, soustractions, heure, dictee, conjugaison/);
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', exercice: 'chimie' }), /Exercice inconnu/);
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', exercice: 'tables', retirer: true }), /retiré\. Son historique reste/);
    assert.equal((await appel(ctx.base, 'GET', `/revisions/members/${NOE}/exercises/tables`, undefined, ctx.jetons.admin)).json.program, null);
  });

  it('régler une dictée sur une liste livrée ; une liste inconnue est refusée', async () => {
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', exercice: 'dictee', params: { liste: 'invariables-ce2' }, questions: 10 }),
      /Programme Dictée de mots de Noé enregistré : La liste « Mots invariables \(CE2\) » \(30 mots\), 10 questions/);
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', exercice: 'dictee', params: { liste: 'inconnue' } }), /Refusé : « Liste de mots » : cette liste n’existe pas/);
    assert.match(await call(adulte, 'revisions_progression', { enfant: 'Noé', exercice: 'dictee' }), /Sur 30 items : 0 acquis, 0 en cours, 0 pas assez de réponses, 30 pas encore vus/);
  });

  it('la dictée de la semaine par l’assistant : créer, la donner à Noé, modifier, archiver ; mêmes règles qu’à l’écran', async () => {
    assert.ok(!(await names(enfant)).includes('revisions_liste_creer') && (await names(enfant)).includes('revisions_listes'), 'un enfant lit les listes, sans les gérer');
    assert.ok(!(await names(lecture)).includes('revisions_liste_creer'), 'un jeton de lecture ne crée rien');
    // Son propre jeton : la série d'appels ne doit pas entamer la limite des autres tests.
    const adulte = await jeton(ctx.jetons.admin, 'Claude dictée', 'write', 'MotDePasseSolide1');
    const cree = await call(adulte, 'revisions_liste_creer', { exercice: 'dictee', nom: 'Semaine 12', mots: 'oiseau, école\nmaison ; oiseau' });
    const id = /\[(foyer-\d+)\]/.exec(cree)![1];
    assert.match(cree, /« Semaine 12 » \[foyer-\d+\] créée pour Dictée de mots : 3 mots/);
    const l = (await appel(ctx.base, 'GET', '/revisions/exercises/dictee/content', undefined, ctx.jetons.admin)).json.lists.find((x: { id: string }) => x.id === id);
    assert.deepEqual(l.items, ['oiseau', 'école', 'maison'], 'la même liste qu’à l’écran, doublon retiré');
    assert.match(await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', exercice: 'dictee', params: { liste: id } }), /Programme Dictée de mots de Noé enregistré/);
    assert.match(await call(adulte, 'revisions_listes', { exercice: 'dictee' }), new RegExp(`« Semaine 12 » \\[${id}\\] \\(du foyer, 3 mots\\) : oiseau, école, maison ; programme de Noé`));
    assert.match(await call(adulte, 'revisions_liste_modifier', { exercice: 'dictee', id, mots: ['oiseau', 'aujourd’hui'] }), /modifiée : 2 mots/);
    assert.match(await call(adulte, 'revisions_liste_modifier', { exercice: 'dictee', id, archiver: true }), /archivée : 2 mots\. Elle reste lisible par le programme de Noé/);
    assert.match(await call(adulte, 'revisions_listes', { exercice: 'dictee' }), /archivée/);
    assert.match(await call(adulte, 'revisions_listes'), /Précisez `exercice` : dictee, conjugaison/, 'deux exercices ont des listes');
    assert.match(await call(adulte, 'revisions_liste_creer', { exercice: 'dictee', nom: '', mots: ['a'] }), /Refusé : Le nom de la liste/);
    assert.match(await call(adulte, 'revisions_liste_creer', { exercice: 'dictee', nom: 'Trop', mots: [] }), /Refusé : Les éléments : de 1 à 200/);
    assert.match(await call(adulte, 'revisions_liste_modifier', { exercice: 'dictee', id: 'invariables-ce1', nom: 'Moi' }), /liste livrée/);
    assert.match(await call(adulte, 'revisions_liste_modifier', { exercice: 'dictee', id }), /Rien à changer/);
    assert.match(await call(adulte, 'revisions_liste_creer', { exercice: 'tables', nom: 'x', mots: ['y'] }), /n’a pas de listes/);
    await call(adulte, 'revisions_programme_definir', { enfant: 'Noé', exercice: 'dictee', retirer: true });
  });

  it('progression et sessions : un enfant ne voit que lui', async () => {
    assert.match(await call(enfant, 'revisions_progression'), /^Lena, Tables : pas de programme \(réglages par défaut : Les tables de 2 à 5/);
    await call(adulte, 'revisions_programme_definir', { enfant: 'Lena', exercice: 'tables', params: { tables: [6, 9] } });
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
