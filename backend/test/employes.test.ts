// Module « Employé à domicile » : le calcul du net (pur), et le bout en bout
// HTTP (accès adultes, taux daté, changement de taux en cours de mois, gel d'un
// mois déclaré, doublon du jour, sauvegarde/restauration).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { netOfBucket } from '../src/employes/repo';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

describe('Employé à domicile : calcul du net (pur)', () => {
  it('heures décimales × taux, arrondi au centime', () => {
    assert.equal(netOfBucket(540, 1450), 13050, '9 h à 14,50 € = 130,50 €');
    assert.equal(netOfBucket(180, 1450), 4350, '3 h à 14,50 € = 43,50 €');
    assert.equal(netOfBucket(210, 1500), 5250, '3,5 h à 15 € = 52,50 €');
    assert.equal(netOfBucket(45, 1499), 1124, '0,75 h à 14,99 € = 11,2425 → 11,24 €');
  });
});

describe('Employé à domicile : HTTP', () => {
  let ctx: Contexte;
  before(async () => { ctx = await demarrer(); });
  after(async () => { await arreter(ctx); });

  const A = () => ctx.jetons.admin;      // Thomas, administrateur adulte
  const M = () => ctx.jetons.membre;     // Camille, adulte non-admin
  const E = () => ctx.jetons.enfant;     // Lena, enfant

  it('un enfant n’a aucun accès au module (403 partout)', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/employes/bootstrap', undefined, E())).status, 403);
    assert.equal((await appel(ctx.base, 'POST', '/employes/shifts', { day: '2026-09-05' }, E())).status, 403);
  });

  it('créer l’employé et régler le taux exigent un administrateur', async () => {
    // Camille (adulte non-admin) : lecture oui, configuration non.
    assert.equal((await appel(ctx.base, 'GET', '/employes/bootstrap', undefined, M())).status, 200);
    assert.equal((await appel(ctx.base, 'POST', '/employes/employees', { name: 'X', role: 'menage' }, M())).status, 403);

    const cr = await appel(ctx.base, 'POST', '/employes/employees', { name: 'Nolwenn', role: 'menage' }, A());
    assert.equal(cr.status, 201, JSON.stringify(cr.json));
    assert.equal(cr.json.employee.name, 'Nolwenn');

    assert.equal((await appel(ctx.base, 'PUT', '/employes/taux', { euros: 14.5, effective_from: '2026-09-01' }, M())).status, 403);
    const taux = await appel(ctx.base, 'PUT', '/employes/taux', { euros: 14.5, effective_from: '2026-09-01' }, A());
    assert.equal(taux.status, 200, JSON.stringify(taux.json));
    assert.equal(taux.json.rate.netHourlyCents, 1450);
    // Le réglage du foyer reflète le taux courant.
    const reg = await appel(ctx.base, 'GET', '/settings', undefined, A());
    assert.equal(reg.json.values.empNetHourlyRate, 14.5, 'le réglage suit le taux');
  });

  it('trois présences de 3 h donnent 9 h et 130,50 € net', async () => {
    for (const day of ['2026-09-05', '2026-09-12', '2026-09-19']) {
      const r = await appel(ctx.base, 'POST', '/employes/shifts', { day, minutes: 180 }, M());
      assert.equal(r.status, 201, JSON.stringify(r.json));
    }
    const mois = await appel(ctx.base, 'GET', '/employes/month?month=2026-09', undefined, M());
    assert.equal(mois.json.minutes, 540);
    assert.equal(mois.json.netCents, 13050);
    assert.equal(mois.json.buckets.length, 1, 'un seul taux ce mois-ci');
  });

  it('un changement de taux en cours de mois donne deux sous-totaux', async () => {
    // Taux relevé à 15 € à partir du 15. La présence du 5 reste à 14,50 €.
    await appel(ctx.base, 'PUT', '/employes/taux', { euros: 15, effective_from: '2026-09-15' }, A());
    const r = await appel(ctx.base, 'POST', '/employes/shifts', { day: '2026-09-22', minutes: 120 }, M());
    assert.equal(r.status, 201);
    const mois = await appel(ctx.base, 'GET', '/employes/month?month=2026-09', undefined, M());
    // 3×180 = 540 min à 14,50 (avant le 15) + 120 min à 15 (le 22).
    assert.equal(mois.json.minutes, 660);
    const cents = mois.json.buckets.map((b: { netHourlyCents: number }) => b.netHourlyCents).sort();
    assert.deepEqual(cents, [1450, 1500], 'deux taux applicables : ' + JSON.stringify(mois.json.buckets));
    // Les 5 et 12 (avant le 15) à 14,50 = 6 h = 87,00 € ; les 19 et 22 (le 15 ou après) à 15 = 5 h = 75,00 €.
    assert.equal(mois.json.netCents, 8700 + 7500, '87,00 + 75,00 = 162,00 €');
  });

  it('déclarer fige les totaux ; un taux postérieur ne les recalcule pas ; les présences ne bougent plus', async () => {
    const dec = await appel(ctx.base, 'POST', '/employes/month/declare', { month: '2026-09' }, M());
    assert.equal(dec.status, 200, JSON.stringify(dec.json));
    assert.equal(dec.json.status, 'declare');
    const fige = dec.json.netCents;
    assert.equal(fige, 16200);

    // Un taux rétroactif appliqué après coup : le mois déclaré garde son chiffre.
    await appel(ctx.base, 'PUT', '/employes/taux', { euros: 20, effective_from: '2026-09-01' }, A());
    const apres = await appel(ctx.base, 'GET', '/employes/month?month=2026-09', undefined, M());
    assert.equal(apres.json.netCents, fige, 'un mois déclaré n’est jamais recalculé');
    assert.equal(apres.json.frozen, true);

    // Ajouter une présence sur un mois figé est refusé, avec le moyen de rouvrir.
    const add = await appel(ctx.base, 'POST', '/employes/shifts', { day: '2026-09-28', minutes: 180 }, M());
    assert.equal(add.status, 400);
    assert.match(add.json.error, /déclaré|rouvrez/i);

    // Rouvrir, puis on peut de nouveau modifier.
    const re = await appel(ctx.base, 'POST', '/employes/month/reopen', { month: '2026-09' }, M());
    assert.equal(re.json.status, 'ouvert');
    assert.equal((await appel(ctx.base, 'POST', '/employes/shifts', { day: '2026-09-28', minutes: 180 }, M())).status, 201);
  });

  it('une seconde saisie le même jour est signalée comme doublon, pas ajoutée en silence', async () => {
    await appel(ctx.base, 'POST', '/employes/shifts', { day: '2026-10-06', minutes: 180 }, M());
    const dup = await appel(ctx.base, 'POST', '/employes/shifts', { day: '2026-10-06', minutes: 180 }, A());
    assert.equal(dup.status, 200);
    assert.ok(dup.json.duplicate, 'le doublon est renvoyé, pas créé : ' + JSON.stringify(dup.json));
    // « force » assume le second passage.
    assert.equal((await appel(ctx.base, 'POST', '/employes/shifts', { day: '2026-10-06', minutes: 60, force: true }, A())).status, 201);
  });

  it('un mois sans présence se marque pour faire taire le rappel', async () => {
    const r = await appel(ctx.base, 'POST', '/employes/month/no-presence', { month: '2026-11' }, M());
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'sans-presence');
  });

  it('sauvegarde et restauration du module (administrateur)', async () => {
    const exp = await appel(ctx.base, 'GET', '/employes/export.json', undefined, A());
    assert.equal(exp.status, 200);
    assert.equal(exp.json.format, 1);
    assert.ok(exp.json.counts.emp_employees >= 1);
    // Non-admin refusé.
    assert.equal((await appel(ctx.base, 'GET', '/employes/export.json', undefined, M())).status, 403);
    // Restauration sans confirmation refusée.
    assert.equal((await appel(ctx.base, 'POST', '/employes/restore', { backup: exp.json }, A())).status, 400);
    const rest = await appel(ctx.base, 'POST', '/employes/restore', { confirm: 'REMPLACER', backup: exp.json }, A());
    assert.equal(rest.status, 200, JSON.stringify(rest.json));
    assert.equal(rest.json.after.emp_employees, exp.json.counts.emp_employees);
  });
});
