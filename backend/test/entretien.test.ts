// Le module Entretien de bout en bout, par l'API : sa liste existe dès
// l'onboarding et un client ne peut pas l'emporter, ses gestes sont des tâches
// notées par /tasks/ops, son catalogue se surcharge sans redémarrer, et le
// module éteint ferme son catalogue sans rien supprimer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

describe('Entretien', () => {
  let ctx: Contexte;
  before(async () => { ctx = await demarrer(); });
  after(async () => { await arreter(ctx); });

  const A = () => ctx.jetons.admin;
  const M = () => ctx.jetons.membre;
  const E = () => ctx.jetons.enfant;
  const etat = async () => (await appel(ctx.base, 'GET', '/state', undefined, A())).json;
  const ops = (list: unknown[], jeton = M()) => appel(ctx.base, 'POST', '/tasks/ops', { ops: list }, jeton);
  const geste = async (id: string) => ((await etat()).state.tasks as { id: string }[]).find((t) => t.id === id) as Record<string, any> | undefined;

  it('un foyer neuf a sa liste Entretien, partagée, et un socle de pièces vide', async () => {
    const { state } = await etat();
    const l = state.taskLists.find((x: { kind: string }) => x.kind === 'entretien');
    assert.equal(l?.id, 'entretien');
    assert.equal(l?.scope, 'shared');
    assert.deepEqual(state.rooms, []);
  });

  it('le catalogue livré propose une trentaine de gestes et des pièces, à tout membre', async () => {
    const r = await appel(ctx.base, 'GET', '/entretien/catalogue', undefined, E());
    assert.equal(r.status, 200);
    assert.ok(r.json.gestes.length >= 30, `${r.json.gestes.length} gestes`);
    assert.ok(r.json.pieces.includes('Cuisine'));
    const brita = r.json.gestes.find((g: { id: string }) => g.id === 'carafe-filtrante');
    assert.deepEqual(brita.rec, { freq: 'weekly', every: 4, base: 'done' });
    assert.equal(brita.article.unite, 'cartouche');
  });

  it('une surcharge dans le dossier des données s’applique sans redémarrer, et une surcharge illisible ne casse rien', async () => {
    const file = path.join(ctx.dir, 'entretien-catalogue.json');
    fs.writeFileSync(file, JSON.stringify({
      pieces: ['Cuisine', 'Atelier'],
      gestes: [
        { id: 'carafe-filtrante', retire: true },
        { id: 'aquarium', titre: 'Aquarium : changer un quart de l’eau', famille: 'Maison', rec: { freq: 'weekly', every: 2, base: 'done' } },
        { id: 'MAL FORME', titre: 'x', rec: {} },
      ],
    }));
    let r = await appel(ctx.base, 'GET', '/entretien/catalogue', undefined, M());
    assert.deepEqual(r.json.pieces, ['Cuisine', 'Atelier']);
    assert.ok(!r.json.gestes.some((g: { id: string }) => g.id === 'carafe-filtrante'), 'retiré');
    assert.ok(r.json.gestes.some((g: { id: string }) => g.id === 'aquarium'), 'ajouté');
    assert.ok(r.json.gestes.some((g: { id: string }) => g.id === 'ramonage'), 'le reste du catalogue livré demeure');

    fs.writeFileSync(file, '{ pas du json');
    // La date de modification change à la milliseconde : on la force pour ne pas dépendre de l'horloge du disque.
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    r = await appel(ctx.base, 'GET', '/entretien/catalogue', undefined, M());
    assert.equal(r.status, 200);
    assert.ok(r.json.gestes.some((g: { id: string }) => g.id === 'carafe-filtrante'), 'surcharge illisible : le catalogue livré seul');
    fs.unlinkSync(file);
  });

  it('noter un geste par l’API : une réalisation par jour, le stock baisse une fois', async () => {
    const add = await ops([{ op: 'add', opId: 'e-add', id: 'g1', listId: 'entretien', text: 'Carafe Brita : changer la cartouche', who: [], due: null,
      rec: { freq: 'weekly', every: 4, base: 'done' }, remind: 'morning',
      maintenance: { stock: { qty: 4, unit: 'cartouche', threshold: 1, article: 'Cartouche Brita MAXTRA PRO' } } }]);
    assert.deepEqual(add.json.applied, ['e-add'], JSON.stringify(add.json));
    // Un enfant peut noter le geste : un ado qui change la cartouche, c'est le but.
    await ops([{ op: 'done', opId: 'e-d1', id: 'g1', occ: '', by: 'm-thomas' }], E());
    const apres = await geste('g1');
    await ops([{ op: 'done', opId: 'e-d2', id: 'g1', occ: apres?.['due'], by: 'm-nolwenn' }]);
    const g = await geste('g1');
    assert.equal(g?.['history'].length, 1);
    assert.equal(g?.['maintenance'].stock.qty, 3);
    assert.equal(g?.['remind'], 'morning');
  });

  it('un enregistrement du document qui omet la liste Entretien ne l’emporte pas, ni ses gestes ; des pièces absentes restent', async () => {
    const { state, version } = await etat();
    const sans = { ...state, taskLists: state.taskLists.filter((l: { id: string }) => l.id !== 'entretien'), rooms: [{ id: 'p1', name: 'Cuisine', position: 0 }] };
    assert.equal((await appel(ctx.base, 'PUT', '/state', { state: sans, version }, A())).status, 200);
    let s = await etat();
    assert.ok(s.state.taskLists.some((l: { id: string }) => l.id === 'entretien'), 'liste remise');
    assert.ok(await geste('g1'), 'le geste a survécu');

    // Un téléphone resté sur l'ancienne version ne connaît pas `rooms`.
    const { rooms: _r, ...ancien } = s.state; void _r;
    assert.equal((await appel(ctx.base, 'PUT', '/state', { state: { ...ancien, taskLists: ancien.taskLists.map((l: { id: string; kind: string }) => (l.id === 'l1' ? { ...l, kind: 'entretien' } : l)) }, version: s.version }, A())).status, 200);
    s = await etat();
    assert.deepEqual(s.state.rooms, [{ id: 'p1', name: 'Cuisine', position: 0 }]);
    assert.equal(s.state.taskLists.filter((l: { kind: string }) => l.kind === 'entretien').length, 1, 'une seule liste Entretien');
  });

  it('module éteint : catalogue fermé (403), gestes conservés ; remise à zéro : gestes effacés, liste et pièces gardées', async () => {
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEntretien: false } }, A());
    assert.equal((await appel(ctx.base, 'GET', '/entretien/catalogue', undefined, M())).status, 403);
    assert.ok(await geste('g1'), 'éteindre ne supprime rien');
    const c = await appel(ctx.base, 'GET', '/modules', undefined, A());
    assert.deepEqual(c.json.counts.entretien, { gestes: 1, realisations: 1 });

    assert.equal((await appel(ctx.base, 'POST', '/modules/entretien/reset', { confirm: 'SUPPRIMER' }, M())).status, 403);
    assert.equal((await appel(ctx.base, 'POST', '/modules/entretien/reset', { confirm: 'SUPPRIMER' }, A())).status, 200);
    const s = await etat();
    assert.equal(await geste('g1'), undefined);
    assert.ok(s.state.taskLists.some((l: { id: string }) => l.id === 'entretien'));
    assert.equal(s.state.rooms.length, 1);
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEntretien: true } }, A());
    assert.equal((await appel(ctx.base, 'GET', '/entretien/catalogue', undefined, M())).status, 200);
  });
});
