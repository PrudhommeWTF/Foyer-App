// Les outils d'assistant du module Équipements, par le vrai point /mcp et le
// client du SDK : présents quand le module est actif et retirés quand il est
// éteint, écriture réservée aux jetons `write` d'un adulte, filtre enfant (ni
// numéro de série ni montant), et « le lave-vaisselle fuit » noté comme une
// panne qui fait passer la fiche « en panne ».
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

describe('Équipements : outils d’assistant (MCP)', () => {
  let ctx: Contexte;
  let adulte = '', lecture = '', enfant = '';
  let lave = 0;

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
    await appel(ctx.base, 'PUT', '/state', { version: st.version, state: { ...st.state, rooms: [{ id: 'p1', name: 'Cuisine', position: 0 }, { id: 'p2', name: 'Salon', position: 1 }] } }, A);
    lave = (await appel(ctx.base, 'POST', '/equipements/items', { name: 'Lave-vaisselle', room_id: 'p1', brand: 'Bosch', serial: 'FD 9901 0042', purchased_on: '2025-03-12', purchase_price: '549,99' }, A)).json.item.id;
  });
  after(async () => { await arreter(ctx); });

  it('outils présents ; lecture seule sans écriture ; enfant sans écriture ; module éteint : aucun', async () => {
    const a = await names(adulte);
    for (const n of ['equipements_liste', 'equipement_detail', 'equipement_pieces', 'equipement_creer', 'equipement_modifier', 'equipement_evenement']) assert.ok(a.includes(n), n);
    const r = await names(lecture);
    assert.ok(r.includes('equipements_liste') && !r.includes('equipement_creer') && !r.includes('equipement_evenement'));
    const e = await names(enfant);
    assert.ok(e.includes('equipement_detail') && !e.includes('equipement_creer'), 'un enfant lit, n’écrit pas');
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEquipements: false } }, ctx.jetons.admin);
    assert.ok(!(await names(adulte)).some((n) => n.startsWith('equipement')));
    assert.match(await call(adulte, 'equipements_liste'), /inconnu ou non autorisé/);
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEquipements: true } }, ctx.jetons.admin);
  });

  it('liste et détail : garantie calculée ; un enfant ne voit ni série ni montant', async () => {
    const l = await call(adulte, 'equipements_liste', { piece: 'cuisine' });
    assert.match(l, new RegExp(`\\[${lave}\\] Lave-vaisselle · Bosch · Cuisine · Sous garantie jusqu’au 12/03/2027`));
    assert.match(await call(adulte, 'equipements_liste', { piece: 'Grenier' }), /Pièce « Grenier » inconnue. Pièces du foyer : Cuisine, Salon/);
    const d = await call(adulte, 'equipement_detail', { nom: 'bosch' });
    assert.match(d, /Numéro de série : FD 9901 0042/);
    assert.match(d, /pour 549,99 €/);
    const de = await call(enfant, 'equipement_detail', { id: lave });
    assert.ok(!de.includes('9901') && !de.includes('549'), de);
    assert.match(await call(enfant, 'equipements_liste', { recherche: 'fd99010042' }), /Aucun équipement/, 'pas de recherche par série pour un enfant');
  });

  it('« le lave-vaisselle fuit depuis ce matin » : une panne, la fiche passe en panne, l’auteur est l’assistant', async () => {
    const r = await call(adulte, 'equipement_evenement', { nom: 'lave-vaisselle', type: 'panne', texte: 'Fuit depuis ce matin' });
    assert.match(r, /Noté sur \[\d+\] Lave-vaisselle : panne du .* \(Fuit depuis ce matin\)\. La fiche passe « en panne »\./);
    const d = (await appel(ctx.base, 'GET', `/equipements/items/${lave}`, undefined, ctx.jetons.admin)).json.item;
    assert.equal(d.status, 'en_panne');
    assert.equal(d.events[0].text, 'Fuit depuis ce matin');
    assert.equal(d.events[0].cost, null);
    assert.match(await call(adulte, 'equipement_evenement', { id: lave, type: 'reparation', cout: 89.9 }), /La fiche passe « en service »/);
  });

  it('créer et modifier : même validation que l’écran, messages clairs', async () => {
    const c = await call(adulte, 'equipement_creer', { nom: 'Ampli', piece: 'Salon', marque: 'Onkyo', modele: 'TX-SR444', achete_le: '2017-11-07', prix: 399 });
    assert.match(c, /Créé : \[\d+\] Ampli · Onkyo TX-SR444 · Salon · Hors garantie depuis le 08\/11\/2019/);
    assert.match(await call(adulte, 'equipement_creer', { nom: 'X', achete_le: '2025-13-45' }), /Refusé : Date invalide/);
    assert.match(await call(adulte, 'equipement_modifier', { nom: 'ampli', garantie_fin: '2030-01-01' }), /Sous garantie jusqu’au 01\/01\/2030/);
    assert.match(await call(adulte, 'equipement_modifier', { nom: 'a' }), /Rien à modifier|Plusieurs équipements/);
    assert.match(await call(enfant, 'equipement_creer', { nom: 'Console' }), /inconnu ou non autorisé/);
    assert.match(await call(adulte, 'equipement_pieces'), /Cuisine : 1 équipement\nSalon : 1 équipement/);
  });
});
