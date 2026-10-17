// Ce que coûtent les gestes d'entretien : réservé aux adultes, noté au prix du
// moment à chaque réalisation (un prix changé ne réécrit pas le passé, une
// réalisation annulée retire son montant), et un contrat Finances qui couvre
// un geste compté une seule fois.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

describe('Entretien : coûts des gestes', () => {
  let ctx: Contexte;
  before(async () => { ctx = await demarrer(); });
  after(async () => { await arreter(ctx); });

  const A = () => ctx.jetons.admin;
  const M = () => ctx.jetons.membre;
  const E = () => ctx.jetons.enfant;
  let n = 0;
  const ops = async (list: Record<string, unknown>[], jeton = M()) => {
    const r = await appel(ctx.base, 'POST', '/tasks/ops', { ops: list.map((o) => ({ opId: 'c-' + (++n), ...o })) }, jeton);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };
  const bilan = async () => (await appel(ctx.base, 'GET', '/entretien/couts', undefined, M())).json;
  const ligne = async (id: string) => (await bilan()).gestes.find((g: { taskId: string }) => g.taskId === id);
  const prix = (id: string, body: Record<string, unknown>, jeton = M()) => appel(ctx.base, 'PUT', `/entretien/couts/gestes/${id}`, body, jeton);
  const geste = async (id: string) => ((await appel(ctx.base, 'GET', '/state', undefined, A())).json.state.tasks as { id: string; due: string }[]).find((t) => t.id === id)!;

  it('un enfant n’accède pas aux montants, même s’il note le geste', async () => {
    await ops([{ op: 'add', id: 'brita', listId: 'entretien', text: 'Carafe : cartouche', who: [], due: null, rec: { freq: 'weekly', every: 4, base: 'done' } }]);
    assert.equal((await appel(ctx.base, 'GET', '/entretien/couts', undefined, E())).status, 403);
    assert.equal((await prix('brita', { amount: 1500 }, E())).status, 403);
    assert.equal((await prix('brita', { amount: -3 })).status, 400);
    assert.equal((await prix('inconnu', { amount: 1500 })).status, 404);
  });

  it('chaque réalisation est notée au prix du moment ; rouvrir retire son montant', async () => {
    const r = await prix('brita', { amount: 1500 });
    assert.equal(r.status, 200);
    const l = r.json.gestes.find((g: { taskId: string }) => g.taskId === 'brita');
    assert.equal(l.perYear, 13, 'toutes les 4 semaines : 13 fois par an');
    assert.equal(l.forecast, 19500);
    assert.equal(l.real12, 0);

    // Un enfant a changé la cartouche il y a trois jours : le montant s'inscrit quand même.
    const jour = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    await ops([{ op: 'done', id: 'brita', occ: '', at: `${jour(3)}T10:30:00Z` }], E());
    assert.equal((await ligne('brita')).real12, 1500);

    // Le prix change : la réalisation passée garde le sien, la suivante prend le nouveau.
    await prix('brita', { amount: 2000 });
    const soldee = (await geste('brita')).due;
    await ops([{ op: 'done', id: 'brita', occ: soldee, at: `${jour(0)}T10:30:00Z` }]);
    const apres = await ligne('brita');
    assert.equal(apres.real12, 3500);
    assert.equal(apres.forecast, 26000, 'la prévision suit le nouveau prix');

    await ops([{ op: 'reopen', id: 'brita', occ: soldee }]);
    assert.equal((await ligne('brita')).real12, 1500, 'rouvert : la réalisation et son montant s’en vont');
  });

  it('couvert par un contrat Finances : pas de montant propre, le contrat compté une fois', async () => {
    const c = await appel(ctx.base, 'POST', '/finances/contracts', { name: 'Entretien chaudière', provider: 'Chauffagiste', kind: 'autre', periodicity: 'annuelle' }, A());
    assert.equal(c.status, 201, JSON.stringify(c.json));
    const cid = c.json.contract.id;
    await ops([
      { op: 'add', id: 'chaud', listId: 'entretien', text: 'Chaudière', who: [], due: '2026-10-01', rec: { freq: 'yearly', every: 1, base: 'due', grace: 30 } },
      { op: 'add', id: 'chaud2', listId: 'entretien', text: 'Chaudière : ramonage du conduit', who: [], due: '2026-10-01', rec: { freq: 'yearly', every: 1, base: 'due' } },
    ]);
    await prix('chaud', { amount: 9000, contractId: cid });
    await prix('chaud2', { contractId: cid });
    const b = await bilan();
    const l = b.gestes.find((g: { taskId: string }) => g.taskId === 'chaud');
    assert.deepEqual([l.amount, l.contractId, l.forecast], [null, cid, null], 'le contrat l’emporte sur un montant');
    assert.ok(b.contracts.some((x: { id: number; name: string }) => x.id === cid && x.name === 'Entretien chaudière'));

    // Une opération rattachée au contrat : comptée une seule fois, même pour deux gestes.
    const compte = (await appel(ctx.base, 'GET', '/finances/accounts', undefined, A())).json.accounts[0].id;
    const today = new Date().toISOString().slice(0, 10);
    const tx = await appel(ctx.base, 'POST', '/finances/transactions', { accountId: compte, date: today, amount: '-120,00', label: 'Chauffagiste', contractId: cid }, A());
    assert.equal(tx.status, 201, JSON.stringify(tx.json));
    const b2 = await bilan();
    assert.equal(b2.totals.real12 - b.totals.real12, 12000);
    assert.equal(b2.totals.forecast - b.totals.forecast, 12000);

    // Finances éteint : plus de contrats proposés, plus de rattachement possible.
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modFinances: false } }, A());
    assert.deepEqual((await bilan()).contracts, []);
    assert.equal((await prix('chaud', { contractId: cid })).status, 400);
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modFinances: true } }, A());
  });

  it('un geste supprimé emporte ses montants', async () => {
    await ops([{ op: 'remove', id: 'brita' }]);
    assert.equal(await ligne('brita'), undefined);
    assert.equal((await prix('brita', { amount: 100 })).status, 404);
  });
});
