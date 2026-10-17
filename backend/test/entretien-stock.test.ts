// Entretien, troisième tranche : le stock bas qui part aux courses (une fois
// par passage sous le seuil, sans doublon, dans un rayon), et les outils
// d'assistant entretien_*, de bout en bout par MCP.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';
import { parseFrequence, parseSaison } from '../src/entretien/frequence';

describe('Entretien : fréquence dite en français', () => {
  it('lit les tournures courantes, refuse le reste', () => {
    assert.deepEqual(parseFrequence('toutes les 4 semaines'), { freq: 'weekly', every: 4 });
    assert.deepEqual(parseFrequence('Tous les 6 mois'), { freq: 'monthly', every: 6 });
    assert.deepEqual(parseFrequence('1 fois par an'), { freq: 'yearly', every: 1 });
    assert.deepEqual(parseFrequence('une fois par mois'), { freq: 'monthly', every: 1 });
    assert.deepEqual(parseFrequence('chaque année'), { freq: 'yearly', every: 1 });
    assert.deepEqual(parseFrequence('tous les 5 ans'), { freq: 'yearly', every: 5 });
    assert.deepEqual(parseFrequence('hebdomadaire'), { freq: 'weekly', every: 1 });
    assert.deepEqual(parseFrequence('tous les 10 jours'), { freq: 'daily', every: 10 });
    assert.equal(parseFrequence('de temps en temps'), null);
    assert.equal(parseFrequence('tous les 0 mois'), null);
  });

  it('lit une saison dite en français', () => {
    assert.deepEqual(parseSaison('de mai à septembre'), { from: '05-01', to: '09-30' });
    assert.deepEqual(parseSaison('d’octobre à mars'), { from: '10-01', to: '03-31' });
    assert.deepEqual(parseSaison('du 15 avril au 30 septembre'), { from: '04-15', to: '09-30' });
    assert.deepEqual(parseSaison('du 1er décembre au 15 janvier'), { from: '12-01', to: '01-15' });
    assert.deepEqual(parseSaison('en octobre'), { from: '10-01', to: '10-31' });
    assert.deepEqual(parseSaison('Mai-Septembre'), { from: '05-01', to: '09-30' });
    assert.deepEqual(parseSaison('de décembre à février'), { from: '12-01', to: '02-29' });
    assert.equal(parseSaison('l’été'), null);
    assert.equal(parseSaison('du 31 avril au 30 mai'), null);
  });
});

describe('Entretien : stock et courses, assistant', () => {
  let ctx: Contexte;
  before(async () => {
    ctx = await demarrer();
    await appel(ctx.base, 'PATCH', '/settings', { changes: { mcpEnabled: true } }, ctx.jetons.admin);
  });
  after(async () => { await arreter(ctx); });

  const A = () => ctx.jetons.admin;
  const M = () => ctx.jetons.membre;
  const etat = async () => (await appel(ctx.base, 'GET', '/state', undefined, A())).json.state;
  let n = 0;
  const ops = async (list: Record<string, unknown>[]) => {
    const r = await appel(ctx.base, 'POST', '/tasks/ops', { ops: list.map((o) => ({ opId: 'op-' + (++n), ...o })) }, M());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };
  const geste = async (id: string) => (await etat()).tasks.find((t: { id: string }) => t.id === id);
  const aPrendre = async (nom: string) => (await etat()).shop.filter((i: { name: string; state: string }) => i.name === nom && i.state === 'a-prendre');
  const creer = (id: string, article: string, qty: number) => ops([{ op: 'add', id, listId: 'entretien', text: id, who: [], due: null,
    rec: { freq: 'weekly', every: 4, base: 'done' }, maintenance: { stock: { article, unit: 'cartouche', qty, threshold: 1 } } }]);

  it('réglage éteint : rien ne part seul ; le bouton ajoute, une fois, au rayon Entretien', async () => {
    await creer('brita', 'Cartouche Brita MAXTRA PRO', 2);
    await ops([{ op: 'done', id: 'brita', occ: '', at: '2026-10-17T08:00:00Z' }]);
    assert.equal((await geste('brita')).maintenance.stock.qty, 1);
    assert.equal((await geste('brita')).maintenance.stock.alerted, true, 'le passage sous le seuil est noté');
    assert.equal((await aPrendre('Cartouche Brita MAXTRA PRO')).length, 0, 'réglage éteint : rien d’ajouté seul');

    const r1 = await appel(ctx.base, 'POST', '/entretien/gestes/brita/courses', {}, M());
    assert.deepEqual(r1.json, { kind: 'ajoute', article: 'Cartouche Brita MAXTRA PRO', liste: 'Courses de la semaine' });
    const r2 = await appel(ctx.base, 'POST', '/entretien/gestes/brita/courses', {}, M());
    assert.equal(r2.json.kind, 'deja', 'sans doublon');
    const items = await aPrendre('Cartouche Brita MAXTRA PRO');
    assert.equal(items.length, 1);
    assert.equal(items[0].aisleId, 'a-entretien', 'dans un rayon, pas dans « Non classé »');
    assert.equal((await appel(ctx.base, 'POST', '/entretien/gestes/inconnu/courses', {}, M())).status, 400);
  });

  it('réglage allumé : l’article part seul, une seule fois par passage sous le seuil', async () => {
    await appel(ctx.base, 'PATCH', '/settings', { changes: { entretienCoursesAuto: true } }, A());
    await creer('hotte', 'Filtre charbon hotte', 2);
    await ops([{ op: 'done', id: 'hotte', occ: '', at: '2026-10-17T08:00:00Z' }]);
    assert.equal((await aPrendre('Filtre charbon hotte')).length, 1, 'parti seul au passage sous le seuil');

    // On l'achète (coché dans les courses), le geste suivant descend à 0 : toujours sous le seuil, pas de second ajout.
    const it = (await aPrendre('Filtre charbon hotte'))[0];
    await appel(ctx.base, 'POST', '/shopping/ops', { ops: [{ op: 'remove', opId: 'rm-1', id: it.id }] }, M());
    const due = (await geste('hotte')).due;
    await ops([{ op: 'done', id: 'hotte', occ: due, at: '2026-11-20T08:00:00Z' }]);
    assert.equal((await geste('hotte')).maintenance.stock.qty, 0);
    assert.equal((await aPrendre('Filtre charbon hotte')).length, 0, 'déjà signalé pour ce passage');

    // Racheté : le stock remonte au-dessus du seuil, l'alerte est levée ; un nouveau passage réalerte.
    await ops([{ op: 'stock', id: 'hotte', add: 3 }]);
    assert.equal((await geste('hotte')).maintenance.stock.alerted, undefined);
    await ops([{ op: 'stock', id: 'hotte', set: 1 }]);
    assert.equal((await aPrendre('Filtre charbon hotte')).length, 1, 'nouveau passage sous le seuil : nouvel ajout');
    await appel(ctx.base, 'PATCH', '/settings', { changes: { entretienCoursesAuto: false } }, A());
  });

  // ---- assistant ----
  async function client(): Promise<Client> {
    const tok = (await appel(ctx.base, 'POST', '/me/tokens', { name: 'Claude iPhone', scope: 'write', password: 'MotDePasseSolide2' }, M())).json.token;
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(ctx.base + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + tok } } }));
    return c;
  }
  const text = (r: unknown): string => ((r as { content?: { text?: string }[] }).content || []).map((x) => x.text || '').join('\n');

  it('créer, noter « j’ai testé l’alarme ce matin », lister la semaine, stock et pause, par l’assistant', async () => {
    const c = await client();
    const cr = text(await c.callTool({ name: 'entretien_creer', arguments: { titre: 'Détecteurs de fumée : tester l’alarme', frequence: 'tous les 6 mois', piece: 'Entrée', stock: { article: 'Pile 9 V', qte: 4, unite: 'pile', seuil: 1 } } }));
    assert.match(cr, /Geste créé/);
    assert.ok((await etat()).rooms.some((r: { name: string }) => r.name === 'Entrée'), 'la pièce a été créée');

    const fait = text(await c.callTool({ name: 'entretien_fait', arguments: { id: 'tester l’alarme' } }));
    assert.match(fait, /Noté : « Détecteurs de fumée : tester l’alarme », fait le .* par Camille\. Prochaine fois le .*\. Stock : 3 pile\./);
    const g = (await etat()).tasks.find((t: { text: string }) => t.text.startsWith('Détecteurs'));
    assert.equal(g.history[0].via, 'Claude iPhone', 'l’historique dit que c’est passé par l’assistant');
    assert.match(text(await c.callTool({ name: 'entretien_fait', arguments: { id: g.id } })), /déjà noté ce jour-là/);

    const tous = text(await c.callTool({ name: 'entretien_liste', arguments: { quand: 'tous' } }));
    assert.match(tous, /Détecteurs de fumée.*Entrée.*via un assistant/);
    assert.match(text(await c.callTool({ name: 'entretien_liste', arguments: {} })), /d’ici 7 jours/);

    assert.match(text(await c.callTool({ name: 'entretien_stock', arguments: { id: g.id, qte: 6 } })), /: 9 pile/);
    assert.match(text(await c.callTool({ name: 'entretien_pause', arguments: { id: g.id, jusqu_au: '2099-04-15' } })), /en pause jusqu’au 15\/04\/2099/);
    assert.match(text(await c.callTool({ name: 'entretien_creer', arguments: { titre: 'X', frequence: 'parfois' } })), /Fréquence illisible/);

    // Saison et fenêtre, dites en français. Le jour des tests compte : on lit la date rendue plutôt qu'une date figée.
    const pis = text(await c.callTool({ name: 'entretien_creer', arguments: { titre: 'Piscine : pH', frequence: 'chaque semaine', saison: 'de mai à septembre' } }));
    assert.match(pis, /chaque semaine après la réalisation, de mai à septembre/);
    const ram = text(await c.callTool({ name: 'entretien_creer', arguments: { titre: 'Ramonage', frequence: '1 fois par an', saison: 'de septembre à octobre' } }));
    assert.match(ram, /À faire entre le 01\/09\/\d{4} et le 31\/10\/\d{4}\./);
    const r = (await etat()).tasks.find((t: { text: string }) => t.text === 'Ramonage');
    assert.deepEqual([r.rec.base, r.rec.grace, r.due.slice(5)], ['due', 60, '09-01']);
    assert.match(text(await c.callTool({ name: 'entretien_liste', arguments: { quand: 'tous' } })), /Ramonage.*(à faire entre le|en retard)/);
    assert.match(text(await c.callTool({ name: 'entretien_creer', arguments: { titre: 'Y', frequence: 'chaque semaine', saison: 'l’été' } })), /Saison illisible/);

    // Module éteint : les outils disparaissent.
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEntretien: false } }, A());
    const names = (await c.listTools()).tools.map((t) => t.name);
    assert.ok(!names.some((x) => x.startsWith('entretien')), names.join(', '));
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEntretien: true } }, A());
    await c.close();
  });
});
