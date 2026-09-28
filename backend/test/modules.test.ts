// Désactiver un module ne le cache pas seulement dans l'interface : ses accès se
// ferment côté serveur. Un endpoint de module éteint répond 403 ; un module
// document éteint fige ses données (le /state ignore les changements) ; et un
// « repartir à zéro » efface, mais seulement sur confirmation d'un administrateur.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

describe('Modules activables', () => {
  let ctx: Contexte;
  before(async () => { ctx = await demarrer(); });
  after(async () => { await arreter(ctx); });

  const A = () => ctx.jetons.admin;
  const M = () => ctx.jetons.membre;
  const set = (changes: Record<string, unknown>) => appel(ctx.base, 'PATCH', '/settings', { changes }, A());

  it('un module relationnel désactivé ferme ses endpoints (403), réactivé les rouvre', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/employes/bootstrap', undefined, M())).status, 200);
    await set({ modEmploye: false });
    assert.equal((await appel(ctx.base, 'GET', '/employes/bootstrap', undefined, M())).status, 403, 'Employé éteint : 403');
    assert.equal((await appel(ctx.base, 'GET', '/finances/bootstrap', undefined, M())).status, 200, 'Finances encore actif');
    await set({ modFinances: false });
    assert.equal((await appel(ctx.base, 'GET', '/finances/bootstrap', undefined, M())).status, 403, 'Finances éteint : 403');
    await set({ modEmploye: true, modFinances: true });
    assert.equal((await appel(ctx.base, 'GET', '/employes/bootstrap', undefined, M())).status, 200, 'rouvert');
  });

  it('un module document désactivé fige ses données : le /state ignore les changements', async () => {
    await set({ modRepas: false });
    let st = await appel(ctx.base, 'GET', '/state', undefined, A());
    const avant = (st.json.state.recipes || []).length;
    const putOff = await appel(ctx.base, 'PUT', '/state', {
      state: { ...st.json.state, recipes: [...(st.json.state.recipes || []), { id: 'rX', name: 'Interdite' }] },
      version: st.json.version,
    }, A());
    assert.equal(putOff.status, 200);
    st = await appel(ctx.base, 'GET', '/state', undefined, A());
    assert.equal((st.json.state.recipes || []).length, avant, 'recette ignorée tant que le module est éteint');

    await set({ modRepas: true });
    st = await appel(ctx.base, 'GET', '/state', undefined, A());
    const putOn = await appel(ctx.base, 'PUT', '/state', {
      state: { ...st.json.state, recipes: [...(st.json.state.recipes || []), { id: 'rY', name: 'Permise' }] },
      version: st.json.version,
    }, A());
    assert.equal(putOn.status, 200);
    st = await appel(ctx.base, 'GET', '/state', undefined, A());
    assert.equal((st.json.state.recipes || []).length, avant + 1, 'recette écrite une fois le module réactivé');
  });

  it('les cartes de fidélité se figent aussi quand le module est éteint', async () => {
    await set({ modFidelite: false });
    let st = await appel(ctx.base, 'GET', '/state', undefined, A());
    const avant = (st.json.state.cards || []).length;
    await appel(ctx.base, 'PUT', '/state', { state: { ...st.json.state, cards: [...(st.json.state.cards || []), { id: 'cX', name: 'Carte' }] }, version: st.json.version }, A());
    st = await appel(ctx.base, 'GET', '/state', undefined, A());
    assert.equal((st.json.state.cards || []).length, avant, 'carte ignorée, module éteint');
    await set({ modFidelite: true });
  });

  it('remettre un module à zéro exige un administrateur et une confirmation, puis efface', async () => {
    // Un employé avec une présence, pour avoir quelque chose à effacer.
    const e = (await appel(ctx.base, 'POST', '/employes/employees', { name: 'À effacer', role: 'menage', euros: 12 }, A())).json.employee;
    await appel(ctx.base, 'POST', '/employes/shifts?employee=' + e.id, { day: '2026-09-10', minutes: 120 }, A());
    const counts = await appel(ctx.base, 'GET', '/modules', undefined, A());
    assert.ok(counts.json.counts.employe.employes >= 1, 'le socle compte l’employé');

    // Sans confirmation : refusé. Non-admin : refusé.
    assert.equal((await appel(ctx.base, 'POST', '/modules/employe/reset', {}, A())).status, 400);
    assert.equal((await appel(ctx.base, 'POST', '/modules/employe/reset', { confirm: 'SUPPRIMER' }, M())).status, 403);

    const reset = await appel(ctx.base, 'POST', '/modules/employe/reset', { confirm: 'SUPPRIMER' }, A());
    assert.equal(reset.status, 200, JSON.stringify(reset.json));
    const after2 = await appel(ctx.base, 'GET', '/modules', undefined, A());
    assert.equal(after2.json.counts.employe.employes, 0, 'les employés sont effacés');
    assert.equal(after2.json.counts.employe.presences, 0, 'les présences aussi');
  });
});
