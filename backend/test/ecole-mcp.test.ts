// Les outils d'assistant du module École, par le vrai point /mcp et le client
// du SDK : retirés quand le module est éteint, portée respectée (pas de
// « devoir fait » pour un jeton de lecture), un enfant ne voit que lui et
// l'autre est refusé en clair, « fait » coche la tâche avec l'auteur.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';
import { FauxEd, fauxEcoleDirecte, jourParis } from './ecole-faux-serveur';

describe('École : outils d’assistant (MCP)', () => {
  let ctx: Contexte;
  let ed: FauxEd;
  let adulte = '', lecture = '', enfant = '', lena = '';

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
    ed = await fauxEcoleDirecte();
    process.env.FOYER_SECRET_KEY = 'cle-de-chiffrement-de-test-de-plus-de-32-caracteres';
    process.env.FOYER_ED_API_BASE = ed.base;
    ctx = await demarrer();
    await appel(ctx.base, 'PATCH', '/settings', { changes: { mcpEnabled: true } }, ctx.jetons.admin);
    adulte = await jeton(ctx.jetons.admin, 'Claude adulte', 'write', 'MotDePasseSolide1');
    lecture = await jeton(ctx.jetons.admin, 'Claude lecture', 'read', 'MotDePasseSolide1');
    enfant = await jeton(ctx.jetons.enfant, 'Claude de Lena', 'write', 'MotDePasseSolide7');
  });
  after(async () => { await arreter(ctx); await ed.fermer(); });

  it('module éteint : aucun outil ecole_* ; allumé : présents, sans écriture pour un jeton de lecture', async () => {
    assert.ok(!(await names(adulte)).some((n) => n.startsWith('ecole')));
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEcole: true } }, ctx.jetons.admin);
    const a = await names(adulte);
    for (const n of ['ecole_devoirs', 'ecole_devoir_fait', 'ecole_emploi_du_temps', 'ecole_notes', 'ecole_vie_scolaire', 'ecole_etat']) assert.ok(a.includes(n), n);
    const r = await names(lecture);
    assert.ok(r.includes('ecole_devoirs') && !r.includes('ecole_devoir_fait'));
  });

  it('mise en place et synchronisation : Léna → Lena (enfant), Nolan-Pierre → Camille', async () => {
    const A = ctx.jetons.admin;
    const c = await appel(ctx.base, 'POST', '/ecole/comptes', { label: 'Collège', identifiant: 'parent.famille', motdepasse: 'mot de passe & 100%' }, A);
    const ok = await appel(ctx.base, 'POST', `/ecole/comptes/${c.json.account.id}/qcm`, { choix: 2 }, A);
    const membres = (await appel(ctx.base, 'GET', '/state', undefined, A)).json.state.members as { id: string; name: string }[];
    lena = membres.find((m) => m.name === 'Lena')!.id;
    const [sl, sn] = ok.json.account.students.map((s: { id: number }) => s.id);
    await appel(ctx.base, 'PUT', `/ecole/eleves/${sl}`, { action: 'confirmer' }, A);
    await appel(ctx.base, 'PUT', `/ecole/eleves/${sn}`, { action: 'associer', memberId: membres.find((m) => m.name === 'Camille')!.id }, A);
    const svc = await import('../src/ecole/service');
    assert.equal((await svc.connect(c.json.account.id)).kind, 'ok');
  });

  it('« qu’est-ce que Lena a comme devoirs pour demain ? »', async () => {
    const t = await call(adulte, 'ecole_devoirs', { enfant: 'léna' });
    assert.match(t, /^Lena : devoirs pour demain/);
    assert.match(t, /\[\d+\] Mathematiques : Exercices 12 et 13 p\. 45 Corrigé sur le site \(https:\/\/exemple\.fr\/corrige\) · à faire/);
    assert.match(t, /Anglais lv1 \(interrogation\)/);
    const semaine = await call(adulte, 'ecole_devoirs', { enfant: 'Lena', quand: 'semaine' });
    assert.match(semaine, /Histoire-geographie : .* · fait/);
  });

  it('un jeton d’enfant ne voit que lui ; l’autre est refusé en clair', async () => {
    const t = await call(enfant, 'ecole_devoirs');
    assert.match(t, /^Lena : /);
    assert.doesNotMatch(t, /Camille|Nolan/);
    assert.match(await call(enfant, 'ecole_devoirs', { enfant: 'Camille' }), /^Refusé/);
    assert.match(await call(enfant, 'ecole_notes', { enfant: 'Nolan' }), /^Refusé/);
    assert.match(await call(enfant, 'ecole_vie_scolaire', { enfant: 'Nolan-Pierre' }), /^Refusé/);
    assert.match(await call(enfant, 'ecole_notes'), /Lena : notes[\s\S]*14,5\/20/);
    assert.match(await call(adulte, 'ecole_devoirs', { enfant: 'Zoé' }), /Aucun élève ne correspond/);
  });

  it('« fait » par l’assistant de l’enfant : la tâche se coche, avec son auteur', async () => {
    const t = await call(enfant, 'ecole_devoirs');
    const id = /\[(\d+)\] Mathematiques/.exec(t)![1];
    const r = await call(enfant, 'ecole_devoir_fait', { id });
    assert.match(r, /marqué fait/);
    const tache = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin)).json.state.tasks.find((x: { text: string }) => x.text.startsWith('Mathematiques'));
    assert.equal(tache.done, true);
    assert.equal(tache.doneBy, lena);
    assert.match(await call(enfant, 'ecole_devoirs'), /Mathematiques : .* · fait \(pas encore transmis à ÉcoleDirecte\)/);
  });

  it('emploi du temps : cours annulé signalé, heure de sortie ; notes avec moyennes renvoyées ; vie scolaire ; état', async () => {
    const edt = await call(adulte, 'ecole_emploi_du_temps', { enfant: 'Lena', date: jourParis(1) });
    assert.match(edt, /15:30-16:30 Physique-chimie \(LABO\) : ANNULÉ/);
    assert.match(edt, /Sortie à 15:30\./);
    const notes = await call(adulte, 'ecole_notes', { enfant: 'Lena', matiere: 'maths' });
    assert.match(notes, /Mathematiques : 14,5\/20/);
    assert.match(notes, /Moyenne générale : 13,25 \(classe 11,80\)/);
    assert.doesNotMatch(notes, /Anglais/);
    assert.match(await call(adulte, 'ecole_vie_scolaire', { enfant: 'Lena' }), /Retard \(non justifié\)/);
    assert.match(await call(adulte, 'ecole_etat'), /Compte « Collège » : connecté\.[\s\S]*- Lena : données à jour du/);
  });
});
