// Le serveur MCP : ce qu'un assistant peut faire par le point /mcp, et surtout
// ce qu'il ne peut pas. Éteint par défaut (404), jeton obligatoire (une session
// est refusée), portée respectée (un jeton `read` ne voit pas les outils
// d'écriture), attribution portée (by + via), séries protégées, finances hors
// de portée, et un compte enfant ne voit que ce qu'il verrait dans l'app.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
let tokenWrite = '';
let tokenRead = '';
let tokenEnfant = '';
let membreId = '';

/** Un client MCP connecté avec un jeton d'accès en en-tête. */
async function connect(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(ctx.base + '/mcp'), {
    requestInit: { headers: { Authorization: 'Bearer ' + token } },
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
const textOf = (r: unknown): string => {
  const c = (r as { content?: { type: string; text?: string }[] }).content || [];
  return c.map((x) => x.text || '').join('\n');
};
async function creerJeton(session: string, name: string, scope: 'read' | 'write', password: string): Promise<string> {
  const r = await appel(ctx.base, 'POST', '/me/tokens', { name, scope, password }, session);
  if (r.status !== 201) throw new Error('création de jeton échouée : ' + JSON.stringify(r.json));
  return r.json.token as string;
}

before(async () => {
  ctx = await demarrer();
  // Le point est fermé par défaut : on l'ouvre pour les tests (réglage foyer, admin).
  const on = await appel(ctx.base, 'PATCH', '/settings', { changes: { mcpEnabled: true } }, ctx.jetons.admin);
  assert.equal(on.status, 200, 'activation de mcpEnabled : ' + JSON.stringify(on.json));
  membreId = (await appel(ctx.base, 'GET', '/me', undefined, ctx.jetons.membre)).json.memberId;
  tokenWrite = await creerJeton(ctx.jetons.membre, 'Assistant écriture', 'write', 'MotDePasseSolide2');
  tokenRead = await creerJeton(ctx.jetons.membre, 'Assistant lecture', 'read', 'MotDePasseSolide2');
  tokenEnfant = await creerJeton(ctx.jetons.enfant, 'Assistant enfant', 'write', 'MotDePasseSolide7');
});
after(async () => { await arreter(ctx); });

describe('Serveur MCP', () => {
  it('répond 404 quand le réglage est éteint', async () => {
    // Éteindre, vérifier, rallumer (les autres tests en dépendent).
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { mcpEnabled: false } }, ctx.jetons.admin)).status, 200);
    const off = await appel(ctx.base, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tokenWrite);
    assert.equal(off.status, 404);
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { mcpEnabled: true } }, ctx.jetons.admin)).status, 200);
  });

  it('exige une authentification (401) et refuse une session de navigateur (403)', async () => {
    assert.equal((await appel(ctx.base, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 401);
    // Un jeton de session (pas un jeton d'accès) est authentifié mais interdit ici.
    assert.equal((await appel(ctx.base, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx.jetons.membre)).status, 403);
  });

  it('tools/list reflète la portée : un jeton read ne voit pas les outils d’écriture', async () => {
    const read = await connect(tokenRead);
    const write = await connect(tokenWrite);
    const readNames = (await read.listTools()).tools.map((t) => t.name);
    const writeNames = (await write.listTools()).tools.map((t) => t.name);
    await read.close(); await write.close();

    assert.ok(readNames.includes('foyer_aujourdhui'), 'les lectures sont là');
    assert.ok(!readNames.includes('courses_ajouter'), 'pas d’écriture pour un jeton read');
    assert.ok(writeNames.includes('courses_ajouter') && writeNames.includes('evenement_creer'), 'les écritures sont là pour un jeton write');
    // Aucun outil n'expose les finances ni les réglages, quelle que soit la portée.
    for (const n of [...readNames, ...writeNames]) assert.ok(!/finance|budget|reglage|setting/i.test(n), 'aucun outil finances/réglages : ' + n);
  });

  it('courses_ajouter crée l’article avec attribution (by + via)', async () => {
    const c = await connect(tokenWrite);
    const out = textOf(await c.callTool({ name: 'courses_ajouter', arguments: { articles: [{ nom: 'Lait' }, { nom: 'Œufs', qte: '6' }] } }));
    await c.close();
    assert.match(out, /Lait/);

    const live = (await appel(ctx.base, 'GET', '/live', undefined, ctx.jetons.membre)).json;
    const lait = (live.shop || []).find((i: { name: string }) => i.name === 'Lait');
    assert.ok(lait, 'l’article est bien dans la liste');
    assert.equal(lait.by, membreId, 'attribué au membre du jeton');
    assert.equal(lait.via, 'Assistant écriture', 'la provenance porte le nom du jeton');
  });

  it('un jeton read ne peut pas appeler un outil d’écriture', async () => {
    const c = await connect(tokenRead);
    const res = await c.callTool({ name: 'courses_ajouter', arguments: { articles: [{ nom: 'Beurre' }] } });
    await c.close();
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(textOf(res), /inconnu ou non autorisé/i);
  });

  it('tache_terminer refuse une série et renvoie vers l’app', async () => {
    // Une tâche récurrente, créée par le chemin normal (opérations de tâches).
    const lists = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre)).json.state.taskLists as { id: string; kind: string }[];
    const listId = (lists.find((l) => l.kind === 'taches') || lists[0]).id;
    await appel(ctx.base, 'POST', '/tasks/ops', { ops: [{ op: 'add', opId: 'serie1', id: 'tserie', listId, text: 'Sortir les poubelles', due: '2026-01-06', rec: { freq: 'weekly', every: 1, base: 'due' } }] }, ctx.jetons.membre);

    const c = await connect(tokenWrite);
    const out = textOf(await c.callTool({ name: 'tache_terminer', arguments: { id: 'tserie' } }));
    await c.close();
    assert.match(out, /revient régulièrement/);
  });

  it('evenement_creer ajoute l’événement, attribué au membre', async () => {
    const c = await connect(tokenWrite);
    const out = textOf(await c.callTool({ name: 'evenement_creer', arguments: { titre: 'Rendez-vous dentiste', date: '2026-02-10', heure: '09:30' } }));
    await c.close();
    const m = out.match(/\[(e[^\]]+)\]/);
    assert.ok(m, 'l’identifiant de l’événement est renvoyé : ' + out);
    const state = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre)).json.state;
    const ev = (state.events || []).find((e: { id: string }) => e.id === m![1]);
    assert.ok(ev, 'l’événement est dans le document');
    assert.equal(ev.by, membreId, 'attribué au membre du jeton');
  });

  it('un compte enfant ne voit pas la liste privée d’un autre membre', async () => {
    // L'admin se crée une liste de tâches privée, avec une tâche dedans.
    const etat = await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin);
    const adminId = (await appel(ctx.base, 'GET', '/me', undefined, ctx.jetons.admin)).json.memberId;
    const lists = [...etat.json.state.taskLists, { id: 'priv1', name: 'Secret admin', color: '#000', icon: 'x', kind: 'taches', scope: adminId, position: 99 }];
    const put = await appel(ctx.base, 'PUT', '/state', { version: etat.json.version, state: { ...etat.json.state, taskLists: lists } }, ctx.jetons.admin);
    assert.equal(put.status, 200);
    await appel(ctx.base, 'POST', '/tasks/ops', { ops: [{ op: 'add', opId: 'priv-op', id: 'tpriv', listId: 'priv1', text: 'Cadeau surprise', due: '2026-01-06' }] }, ctx.jetons.admin);

    const c = await connect(tokenEnfant);
    const out = textOf(await c.callTool({ name: 'taches_liste', arguments: { quand: 'toutes' } }));
    await c.close();
    assert.ok(!/Cadeau surprise/.test(out), 'la tâche d’une liste privée d’autrui reste invisible');
  });
});
