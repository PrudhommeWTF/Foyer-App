// Les outils d'assistant du module Épopée, par le vrai point /mcp et le client
// du SDK : présents quand le module est actif et retirés quand il est éteint,
// écritures réservées aux adultes et à un jeton `write`, un enfant ne lit que
// sa besace, les montants sont ceux du serveur, et ce que l'assistant ne fait
// pas (enrôler) est dit plutôt que contourné.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

describe('Épopée : outils d’assistant (MCP)', () => {
  let ctx: Contexte;
  let adulte = '', lecture = '', enfant = '', lena = '';
  const NOE = 'noe';
  const ECRITURE = ['epopee_bravo', 'epopee_exploit_crediter', 'epopee_demande_repondre', 'epopee_conseil_noter'];

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
  const solde = async (id = lena): Promise<number> => (await appel(ctx.base, 'GET', `/epopee/membres/${id}`, undefined, ctx.jetons.admin)).json.balance;

  before(async () => {
    ctx = await demarrer();
    const A = ctx.jetons.admin;
    await appel(ctx.base, 'PATCH', '/settings', { changes: { mcpEnabled: true } }, A);
    adulte = await jeton(A, 'Claude adulte', 'write', 'MotDePasseSolide1');
    lecture = await jeton(A, 'Claude lecture', 'read', 'MotDePasseSolide1');
    enfant = await jeton(ctx.jetons.enfant, 'Claude de Lena', 'write', 'MotDePasseSolide7');
    const st = (await appel(ctx.base, 'GET', '/state', undefined, A)).json;
    lena = (st.state.members as { id: string; name: string }[]).find((m) => m.name === 'Lena')!.id;
    const members = [...st.state.members, { id: NOE, name: 'Noé', role: '', color: '#7A9B76', ini: 'N', enfant: true }];
    await appel(ctx.base, 'PUT', '/state', { version: st.version, state: { ...st.state, members } }, A);
    // Lena est enrôlée (l'alliance, dans l'application) ; Noé ne l'est pas.
    assert.equal((await appel(ctx.base, 'POST', `/epopee/membres/${lena}/enrolement`, undefined, A)).status, 201);
  });
  after(async () => { await arreter(ctx); });

  it('outils présents ; lecture seule sans écriture ; enfant sans bilan ni écriture ; module éteint : aucun', async () => {
    const a = await names(adulte);
    for (const n of ['epopee_besace', 'epopee_routines', 'epopee_catalogue', 'epopee_bilan', ...ECRITURE]) assert.ok(a.includes(n), n);
    const r = await names(lecture);
    assert.ok(r.includes('epopee_bilan')); for (const n of ECRITURE) assert.ok(!r.includes(n), n);
    const e = await names(enfant);
    assert.ok(e.includes('epopee_besace') && e.includes('epopee_routines') && e.includes('epopee_catalogue'));
    for (const n of ['epopee_bilan', ...ECRITURE]) assert.ok(!e.includes(n), n);
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEpopee: false } }, ctx.jetons.admin);
    assert.ok(!(await names(adulte)).some((n) => n.startsWith('epopee')));
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEpopee: true } }, ctx.jetons.admin);
  });

  it('la besace se lit : solde, amorce, routines du jour ; un enfant non enrôlé est dit tel quel', async () => {
    const tout = await call(adulte, 'epopee_besace');
    assert.match(tout, /Lena : 5 écus dans sa besace \(dont 5 d’amorce/); assert.match(tout, /Routines :/); assert.match(tout, /pas commencée aujourd’hui/);
    assert.match(tout, /Noé : pas enrôlé dans l’Épopée\./);
    assert.match(await call(adulte, 'epopee_besace', { enfant: 'lé' }), /^Lena : /, 'par le début du prénom, sans accents');
    assert.match(await call(adulte, 'epopee_besace', { enfant: 'Camille' }), /Aucun enfant ne s’appelle/);
  });

  it('un enfant ne lit que sa besace et ses routines', async () => {
    assert.match(await call(enfant, 'epopee_besace'), /^Lena : /);
    assert.ok(!(await call(enfant, 'epopee_besace')).includes('Noé'));
    assert.match(await call(enfant, 'epopee_besace', { enfant: 'Noé' }), /Refusé/);
    assert.match(await call(enfant, 'epopee_routines', { enfant: 'Noé' }), /Refusé/);
    const r = await call(enfant, 'epopee_routines');
    assert.match(r, /Lena, ses routines :/); assert.match(r, /\[à faire\] .+ \(\d+ min, 1 écu\)/);
  });

  it('le catalogue dit les exploits convenus et les récompenses, avec leurs prix', async () => {
    const c = await call(enfant, 'epopee_catalogue');
    assert.match(c, /Exploits convenus/); assert.match(c, /- Mettre la table : \+2 écus/); assert.match(c, /Récompenses de l’Armurerie/); assert.match(c, / : 10 écus/);
  });

  it('un bravo se donne avec ses mots ; hors barème il est refusé', async () => {
    const avant = await solde();
    const r = await call(adulte, 'epopee_bravo', { enfant: 'Lena', ecus: 2, mot: 'A consolé son frère' });
    assert.match(r, /Bravo donné à Lena : \+2 écus, « A consolé son frère »/); assert.equal(await solde(), avant + 2);
    assert.match(await call(adulte, 'epopee_bravo', { enfant: 'Lena', ecus: 10 }), /Refusé : un bravo vaut de 1 à 3/);
    assert.match(await call(adulte, 'epopee_bravo', { enfant: 'Lena', mot: 'x'.repeat(121) }), /Refusé/);
    assert.equal(await solde(), avant + 2);
    assert.match(await call(adulte, 'epopee_besace', { enfant: 'Lena' }), /\+2, bravo « A consolé son frère » \(Thomas\)/);
  });

  it('un exploit convenu se crédite à son montant, par un fragment de son nom', async () => {
    const avant = await solde();
    assert.match(await call(adulte, 'epopee_exploit_crediter', { enfant: 'Lena', exploit: 'table' }), /« Mettre la table » crédité à Lena : \+2 écus/);
    assert.equal(await solde(), avant + 2);
    assert.match(await call(adulte, 'epopee_exploit_crediter', { enfant: 'Lena', exploit: 'promener le chien' }), /Aucun exploit convenu ne correspond/);
    assert.equal(await solde(), avant + 2);
  });

  it('l’assistant n’enrôle pas : écrire pour un enfant non enrôlé renvoie à l’application', async () => {
    assert.match(await call(adulte, 'epopee_bravo', { enfant: 'Noé', ecus: 1 }), /n’est pas enrôlé dans l’Épopée.+pas par l’assistant/);
    assert.match(await call(adulte, 'epopee_exploit_crediter', { enfant: 'Noé', exploit: 'table' }), /n’est pas enrôlé/);
    assert.equal((await appel(ctx.base, 'GET', `/epopee/membres/${NOE}`, undefined, ctx.jetons.admin)).json.enrolled, false);
  });

  it('un exploit signalé par l’enfant se valide ou reçoit « pas tout à fait »', async () => {
    const ex = (await appel(ctx.base, 'GET', '/epopee/exploits', undefined, ctx.jetons.admin)).json.exploits as { id: string; title: string; ecus: number }[];
    const signaler = (i: number) => appel(ctx.base, 'POST', `/epopee/membres/${lena}/demandes`, { id: crypto.randomUUID(), exploitId: ex[i].id }, ctx.jetons.enfant);
    assert.match(await call(adulte, 'epopee_demande_repondre', { enfant: 'Lena', valider: true }), /n’a signalé aucun exploit/);
    await signaler(0); await signaler(1);
    assert.match(await call(adulte, 'epopee_besace', { enfant: 'Lena' }), /Exploit signalé, en attente d’une réponse : « Mettre la table »/);
    assert.match(await call(adulte, 'epopee_demande_repondre', { enfant: 'Lena', valider: true }), /Plusieurs exploits attendent/);
    assert.match(await call(adulte, 'epopee_demande_repondre', { enfant: 'Lena', exploit: 'table' }), /Précisez `valider`/);
    const avant = await solde();
    assert.match(await call(adulte, 'epopee_demande_repondre', { enfant: 'Lena', exploit: 'table', valider: true }), /validé pour Lena : \+2 écus/);
    assert.equal(await solde(), avant + ex[0].ecus);
    assert.match(await call(adulte, 'epopee_demande_repondre', { enfant: 'Lena', valider: false }), /pas tout à fait\. Rien n’est retiré/);
    assert.equal(await solde(), avant + ex[0].ecus);
  });

  it('le bilan de la semaine reprend les phrases de l’écran, et les notes du conseil s’ajoutent', async () => {
    const b = await call(adulte, 'epopee_bilan');
    assert.match(b, /^Semaine du lundi/); assert.match(b, /Lena :\n- \d+ écus gagnés : 0 par les routines, \d+ par les exploits, \d+ par les bravos\./);
    assert.match(b, /Mot de la semaine : « A consolé son frère »/); assert.match(b, /Rien de noté par le conseil/); assert.ok(!b.includes('Noé'), 'un enfant non enrôlé n’a pas de bilan');
    assert.match(await call(lecture, 'epopee_bilan', { semaine: 'semaine-derniere' }), /Une semaine calme/);
    assert.match(await call(adulte, 'epopee_conseil_noter', { note: 'On avance le coucher.' }), /On avance le coucher\./);
    assert.match(await call(adulte, 'epopee_conseil_noter', { note: 'Noé commence samedi.' }), /On avance le coucher\.\nNoé commence samedi\./);
    assert.equal((await appel(ctx.base, 'GET', '/epopee/conseil', undefined, ctx.jetons.admin)).json.notes, 'On avance le coucher.\nNoé commence samedi.');
    assert.match(await call(adulte, 'epopee_conseil_noter', { note: 'Tout repris.', remplacer: true }), /:\nTout repris\.$/);
    assert.match(await call(adulte, 'epopee_conseil_noter', { note: 'x'.repeat(2001) }), /Refusé/);
    assert.match(await call(adulte, 'epopee_bilan'), /Ce que le conseil de famille a décidé : Tout repris\./);
  });

  it('un outil masqué est inconnu à l’appel direct', async () => {
    const avant = await solde();
    assert.match(await call(enfant, 'epopee_bravo', { enfant: 'Lena', ecus: 3 }).catch((e) => String(e)), /inconnu|Unknown|introuvable|not found/i);
    assert.match(await call(lecture, 'epopee_bravo', { enfant: 'Lena', ecus: 3 }).catch((e) => String(e)), /inconnu|Unknown|introuvable|not found/i);
    assert.equal(await solde(), avant);
  });
});
