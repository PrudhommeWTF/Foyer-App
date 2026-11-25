// L'Atelier code en famille : ce qu'un enfant voit des projets de son frère ou de
// sa sœur (rien, sauf ce qui est partagé, et jamais pour le modifier), la copie
// qui emporte ses dessins, le réglage qui coupe le partage, ce qu'un adulte lit
// de chacun, et l'outil d'assistant qui n'en dit pas plus que la liste.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Contexte, appel, arreter, brut, demarrer } from './securite-helpers';

let ctx: Contexte;
let lena = '', noe = ''; // Lena partage, Noé regarde
let tNoe = '';
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const dessin = (d: string) => Buffer.from(`<svg ${NS}><path d="${d}"/></svg>`);
const projet = (extra: Record<string, unknown> = {}) => JSON.stringify({ pages: ['page 1'], currentPage: 'page 1', 'page 1': { sprites: ['Boulon 1', 'Chien 1'], layers: [] }, ...extra });
const statut = async (method: string, chemin: string, jeton: string, body?: unknown) => (await appel(ctx.base, method, chemin, body, jeton)).status;
const regler = async (changes: Record<string, unknown>) => assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes }, ctx.jetons.admin)).status, 200);

let partage = '', prive = '', media = '';

before(async () => {
  ctx = await demarrer();
  const A = ctx.jetons.admin;
  const st = (await appel(ctx.base, 'GET', '/state', undefined, A)).json;
  lena = (st.state.members as { id: string; name: string }[]).find((m) => m.name === 'Lena')!.id;
  noe = 'noe';
  const members = [...st.state.members, { id: noe, name: 'Noé', role: '', color: '#7A9B76', ini: 'N', enfant: true, birthday: '2019-05-01' }];
  assert.equal((await appel(ctx.base, 'PUT', '/state', { version: st.version, state: { ...st.state, members } }, A)).status, 200);
  assert.equal((await appel(ctx.base, 'POST', `/members/${noe}/account`, { email: 'noe@example.fr', password: 'MotDePasseSolide8' }, A)).status, 201);
  tNoe = (await appel(ctx.base, 'POST', '/auth/login', { email: 'noe@example.fr', password: 'MotDePasseSolide8' })).json.token;

  // Lena : un projet avec un dessin à elle, qu'elle partagera, et un projet qu'elle garde pour elle.
  media = (await brut(ctx.base, '/atelier/medias', dessin('M1 1 L5 5'), ctx.jetons.enfant)).json.name;
  const a = (await appel(ctx.base, 'POST', '/atelier/projets', { name: 'Le robot de Lena' }, ctx.jetons.enfant)).json.projet;
  partage = a.id;
  assert.equal((await appel(ctx.base, 'PUT', `/atelier/projets/${a.id}`, { rev: a.rev, name: a.name, json: projet({ dessin: media }) }, ctx.jetons.enfant)).status, 200);
  prive = (await appel(ctx.base, 'POST', '/atelier/projets', { name: 'Secret de Lena' }, ctx.jetons.enfant)).json.projet.id;
});
after(async () => { await arreter(ctx); });

describe('sans partage, un enfant ne voit rien de l’autre', () => {
  it('ni projet, ni liste, ni dessin', async () => {
    assert.equal(await statut('GET', `/atelier/projets/${partage}`, tNoe), 403);
    assert.equal(await statut('GET', `/atelier/projets?membre=${lena}`, tNoe), 403);
    assert.equal(await statut('GET', `/atelier/medias/${media}?membre=${lena}`, tNoe), 403);
    assert.equal(await statut('POST', `/atelier/projets/${partage}/copie`, tNoe, { name: 'Copie' }), 403);
    assert.deepEqual((await appel(ctx.base, 'GET', '/atelier/projets/famille', undefined, tNoe)).json.projets, []);
  });
});

describe('un projet partagé', () => {
  before(async () => { assert.equal(await statut('PATCH', `/atelier/projets/${partage}`, ctx.jetons.enfant, { shared: true }), 200); });

  it('seul son propriétaire le partage', async () => {
    assert.equal(await statut('PATCH', `/atelier/projets/${partage}`, tNoe, { shared: false }), 403);
    assert.equal(await statut('PATCH', `/atelier/projets/${partage}`, ctx.jetons.membre, { shared: false }), 403);
    assert.equal(await statut('PATCH', `/atelier/projets/${partage}`, ctx.jetons.enfant, { shared: 'oui' }), 400);
  });

  it('l’autre le voit dans « Projets de la famille », le lit avec ses dessins, et rien d’autre', async () => {
    const liste = (await appel(ctx.base, 'GET', '/atelier/projets/famille', undefined, tNoe)).json.projets as { id: string; memberName: string; shared: boolean; json?: string }[];
    assert.deepEqual(liste.map((p) => p.id), [partage]);
    assert.equal(liste[0]!.memberName, 'Lena'); assert.equal(liste[0]!.json, undefined);
    assert.equal(await statut('GET', `/atelier/projets/${partage}`, tNoe), 200);
    assert.equal(await statut('GET', `/atelier/medias/${media}?membre=${lena}`, tNoe), 200);
    assert.equal(await statut('GET', `/atelier/projets/${prive}`, tNoe), 403, 'le projet non partagé reste fermé');
    assert.equal(await statut('GET', `/atelier/projets?membre=${lena}`, tNoe), 403, 'la liste complète de l’autre reste fermée');
    // Un dessin de Lena qu'aucun projet partagé ne cite reste à elle.
    const autre = (await brut(ctx.base, '/atelier/medias', dessin('M9 9'), ctx.jetons.enfant)).json.name;
    assert.equal(await statut('GET', `/atelier/medias/${autre}?membre=${lena}`, tNoe), 403);
    // Lena ne voit pas son propre projet dans ceux « de la famille ».
    assert.deepEqual((await appel(ctx.base, 'GET', '/atelier/projets/famille', undefined, ctx.jetons.enfant)).json.projets, []);
  });

  it('il ne le modifie jamais : ni enregistrement, ni nom, ni suppression', async () => {
    assert.equal(await statut('PUT', `/atelier/projets/${partage}`, tNoe, { rev: 2, name: 'x', json: projet() }), 403);
    assert.equal(await statut('PATCH', `/atelier/projets/${partage}`, tNoe, { name: 'x' }), 403);
    assert.equal(await statut('DELETE', `/atelier/projets/${partage}`, tNoe), 403);
  });

  it('il en fait une copie à lui, avec les dessins, sans toucher à l’original', async () => {
    const r = await appel(ctx.base, 'POST', `/atelier/projets/${partage}/copie`, { name: 'Le robot de Lena (copie)' }, tNoe);
    assert.equal(r.status, 201);
    const copie = r.json.projet as { id: string; memberId: string; copiedFrom: string; shared: boolean };
    assert.equal(copie.memberId, noe); assert.equal(copie.copiedFrom, partage); assert.equal(copie.shared, false, 'une copie n’est pas partagée d’office');
    // Le dessin est maintenant aussi chez Noé, sous le même nom, et compte dans sa place.
    assert.equal(await statut('GET', `/atelier/medias/${media}`, tNoe), 200);
    assert.ok((await appel(ctx.base, 'GET', '/atelier/contexte', undefined, tNoe)).json.utilise.octets > 0);
    // Noé modifie sa copie ; l'original de Lena ne bouge pas.
    const lu = (await appel(ctx.base, 'GET', `/atelier/projets/${copie.id}`, undefined, tNoe)).json.projet;
    assert.equal(await statut('PUT', `/atelier/projets/${copie.id}`, tNoe, { rev: lu.rev, name: 'À moi', json: projet({ change: true }) }), 200);
    const original = (await appel(ctx.base, 'GET', `/atelier/projets/${partage}`, undefined, ctx.jetons.enfant)).json.projet;
    assert.equal(original.name, 'Le robot de Lena'); assert.doesNotMatch(original.json, /change/);
    // Lena retire son dessin de son projet et le supprime : celui de la copie reste lisible par Noé.
    assert.equal(await statut('DELETE', `/atelier/projets/${prive}`, ctx.jetons.enfant), 200);
    assert.equal(await statut('GET', `/atelier/medias/${media}`, tNoe), 200);
  });

  it('retiré du partage, ou supprimé, il redevient invisible', async () => {
    assert.equal(await statut('PATCH', `/atelier/projets/${partage}`, ctx.jetons.enfant, { shared: false }), 200);
    assert.equal(await statut('GET', `/atelier/projets/${partage}`, tNoe), 403);
    assert.equal(await statut('GET', `/atelier/medias/${media}?membre=${lena}`, tNoe), 403);
    assert.equal(await statut('PATCH', `/atelier/projets/${partage}`, ctx.jetons.enfant, { shared: true }), 200);
  });

  it('réglage éteint : plus rien de partagé ne se lit, on ne partage plus, rien n’est perdu', async () => {
    await regler({ atelierPartageFratrie: false });
    assert.deepEqual((await appel(ctx.base, 'GET', '/atelier/projets/famille', undefined, tNoe)).json.projets, []);
    assert.equal(await statut('GET', `/atelier/projets/${partage}`, tNoe), 403);
    assert.equal(await statut('GET', `/atelier/medias/${media}?membre=${lena}`, tNoe), 403);
    assert.equal(await statut('PATCH', `/atelier/projets/${partage}`, ctx.jetons.enfant, { shared: true }), 403);
    assert.equal(await statut('GET', `/atelier/projets/${partage}`, ctx.jetons.enfant), 200, 'Lena garde son projet');
    await regler({ atelierPartageFratrie: true });
    assert.equal(await statut('GET', `/atelier/projets/${partage}`, tNoe), 200, 'le partage revient tel qu’il était');
  });
});

describe('côté parent', () => {
  it('un adulte lit le résumé de chacun, un enfant non', async () => {
    assert.equal(await statut('GET', '/atelier/membres', tNoe), 403);
    const r = (await appel(ctx.base, 'GET', '/atelier/membres', undefined, ctx.jetons.membre)).json;
    const l = (r.membres as { id: string; name: string; projets: number; corbeille: number; recents: number; octets: number }[]).find((m) => m.id === lena)!;
    assert.equal(l.name, 'Lena'); assert.equal(l.projets, 1); assert.equal(l.corbeille, 1); assert.equal(l.recents, 1, 'un projet enregistré cette semaine'); assert.ok(l.octets > 0);
    assert.ok(r.quotaMo > 0);
    assert.ok(!(r.membres as { name: string }[]).some((m) => m.name === 'Camille'), 'pas soi-même');
  });

  it('un adulte lit le projet d’un enfant et ses dessins, le restaure, sans jamais le modifier', async () => {
    assert.equal(await statut('GET', `/atelier/projets/${prive}`, ctx.jetons.membre), 200);
    assert.equal(await statut('GET', `/atelier/medias/${media}?membre=${lena}`, ctx.jetons.membre), 200);
    assert.equal(await statut('GET', `/atelier/projets?membre=${lena}&corbeille=1`, ctx.jetons.membre), 200);
    assert.equal(await statut('POST', `/atelier/projets/${prive}/restaurer`, ctx.jetons.membre), 200);
    assert.equal(await statut('PATCH', `/atelier/projets/${prive}`, ctx.jetons.membre, { shared: true }), 403);
  });
});

describe('outil d’assistant atelier_projets', () => {
  const connect = async (token: string): Promise<Client> => {
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(ctx.base + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
    return c;
  };
  const jeton = async (session: string, name: string, password: string): Promise<string> =>
    (await appel(ctx.base, 'POST', '/me/tokens', { name, scope: 'read', password }, session)).json.token as string;
  const call = async (token: string, args: Record<string, unknown> = {}): Promise<string> => {
    const c = await connect(token);
    try { return ((await c.callTool({ name: 'atelier_projets', arguments: args }) as { content?: { text?: string }[] }).content || []).map((x) => x.text || '').join('\n'); } finally { await c.close(); }
  };
  const names = async (token: string): Promise<string[]> => { const c = await connect(token); try { return (await c.listTools()).tools.map((x) => x.name); } finally { await c.close(); } };
  let adulte = '', enfant = '';
  before(async () => {
    await regler({ mcpEnabled: true });
    adulte = await jeton(ctx.jetons.admin, 'Claude adulte', 'MotDePasseSolide1');
    enfant = await jeton(tNoe, 'Claude de Noé', 'MotDePasseSolide8');
  });

  it('compte les pages et les personnages sans rien dire du contenu', async () => {
    // Import tardif : ce module ouvre la base à son chargement, qui doit être celle du test.
    const { projectSize } = await import('../src/mcp/atelier-tools');
    assert.deepEqual(projectSize('petits', projet()), { pages: 1, personnages: 2 });
    assert.deepEqual(projectSize('grands', JSON.stringify({ targets: [{ isStage: true, costumes: [{}, {}] }, { isStage: false }, { isStage: false }] })), { personnages: 2, decors: 2 });
    assert.equal(projectSize('petits', null), null); assert.equal(projectSize('petits', '{pas du json'), null);
  });

  it('un adulte lit les projets de chaque enfant, sans leur contenu', async () => {
    const tout = await call(adulte);
    assert.match(tout, /Lena : 2 projet\(s\)/); assert.match(tout, /« Le robot de Lena » \(Petits codeurs\)/); assert.match(tout, /1 page\(s\), 2 personnage\(s\)/); assert.match(tout, /partagé avec la famille/);
    assert.match(tout, /Noé : 1 projet\(s\)/);
    assert.doesNotMatch(tout, /sprites|currentPage|svg/);
    assert.match(await call(adulte, { enfant: 'lena' }), /Secret de Lena/);
  });

  it('un enfant ne voit que les siens', async () => {
    const moi = await call(enfant);
    assert.match(moi, /Noé : 1 projet/); assert.doesNotMatch(moi, /Lena :/);
    assert.match(await call(enfant, { enfant: 'Lena' }), /Refusé/);
  });

  it('module éteint : l’outil disparaît', async () => {
    assert.ok((await names(adulte)).includes('atelier_projets'));
    await regler({ modAtelier: false });
    assert.ok(!(await names(adulte)).includes('atelier_projets'));
    await regler({ modAtelier: true });
  });
});

describe('le niveau proposé à chaque enfant', () => {
  const niveaux = async (jeton: string) => (await appel(ctx.base, 'GET', '/atelier/contexte', undefined, jeton)).json.niveaux as string[];
  const ouvrir = (id: string, liste: unknown, jeton = ctx.jetons.membre) => appel(ctx.base, 'PUT', `/atelier/membres/${id}/niveaux`, { niveaux: liste }, jeton);
  after(async () => { await ouvrir(noe, ['petits', 'grands']); });

  it('sans réglage, tout est ouvert ; seul un adulte règle, et pour un enfant', async () => {
    assert.deepEqual(await niveaux(tNoe), ['petits', 'grands']);
    assert.equal((await ouvrir(noe, ['petits'], tNoe)).status, 403, 'un enfant ne règle pas son niveau');
    assert.equal((await ouvrir(lena, ['grands'], tNoe)).status, 403);
    assert.equal((await ouvrir(noe, [])).status, 400, 'au moins un niveau');
    assert.equal((await ouvrir(noe, ['moyens'])).status, 400);
    assert.equal((await ouvrir('inconnu', ['petits'])).status, 404);
    const camille = (await appel(ctx.base, 'GET', '/atelier/contexte', undefined, ctx.jetons.membre)).json.membre.id as string;
    assert.equal((await ouvrir(camille, ['petits'], ctx.jetons.admin)).status, 400, 'un adulte garde les deux');
  });

  it('un niveau fermé ne se crée plus, ni par copie ; ce qui existe reste ouvert', async () => {
    const ancien = (await appel(ctx.base, 'POST', '/atelier/projets', { name: 'Jeu de Noé', level: 'grands' }, tNoe)).json.projet;
    const r = await ouvrir(noe, ['petits']);
    assert.equal(r.status, 200); assert.deepEqual(r.json.niveaux, ['petits']);
    assert.deepEqual(await niveaux(tNoe), ['petits']);
    const refus = await appel(ctx.base, 'POST', '/atelier/projets', { name: 'Autre jeu', level: 'grands' }, tNoe);
    assert.equal(refus.status, 403); assert.equal(refus.json.code, 'niveau_ferme'); assert.match(refus.json.error, /parent/);
    assert.equal(await statut('POST', '/atelier/projets', tNoe, { name: 'Histoire', level: 'petits' }), 201);
    // Son projet des grands reste à lui : il l'ouvre, l'enregistre, le duplique.
    assert.equal(await statut('GET', `/atelier/projets/${ancien.id}`, tNoe), 200);
    assert.equal(await statut('PUT', `/atelier/projets/${ancien.id}`, tNoe, { rev: ancien.rev, name: ancien.name, json: JSON.stringify({ targets: [{ isStage: true }], meta: {} }) }), 200);
    assert.equal(await statut('POST', `/atelier/projets/${ancien.id}/copie`, tNoe, { name: 'Jeu de Noé (copie)' }), 201);
    // Le projet partagé de Lena est des petits : il le copie ; un projet des grands partagé, non.
    const grand = (await appel(ctx.base, 'POST', '/atelier/projets', { name: 'Jeu de Lena', level: 'grands' }, ctx.jetons.enfant)).json.projet.id;
    assert.equal(await statut('PATCH', `/atelier/projets/${grand}`, ctx.jetons.enfant, { shared: true }), 200);
    assert.equal(await statut('GET', `/atelier/projets/${grand}`, tNoe), 200, 'il peut le regarder');
    assert.equal(await statut('POST', `/atelier/projets/${grand}/copie`, tNoe, { name: 'Copie' }), 403);
  });

  it('un adulte lit le niveau de chacun, et garde les deux pour lui', async () => {
    const r = (await appel(ctx.base, 'GET', '/atelier/membres', undefined, ctx.jetons.membre)).json.membres as { id: string; niveaux: string[] }[];
    assert.deepEqual(r.find((m) => m.id === noe)!.niveaux, ['petits']);
    assert.deepEqual(r.find((m) => m.id === lena)!.niveaux, ['petits', 'grands']);
    assert.deepEqual(await niveaux(ctx.jetons.membre), ['petits', 'grands']);
    assert.equal(await statut('POST', '/atelier/projets', ctx.jetons.membre, { name: 'Essai', level: 'grands' }), 201);
  });
});
