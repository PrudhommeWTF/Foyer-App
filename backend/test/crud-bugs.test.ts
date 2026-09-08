// Deux corrections de forme sur les routes, éprouvées sur les vraies routes.
//
// A3 : PUT /members/:id/account comparait l'email sans le mettre en minuscules,
// alors qu'il est stocké en minuscules. Renvoyer la même adresse à la casse près
// entrait dans la branche « email changé » et répondait 409.
// A6 : un identifiant invalide sur un import répondait 415 (format de fichier)
// au lieu de 400 (forme), à rebours de tous les autres routeurs.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

describe('PUT /members/:id/account : email comparé en minuscules (A3)', () => {
  it('la même adresse à la casse près n’est pas prise pour un changement', async () => {
    const etat = await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin);
    const camille = (etat.json.state.members as { id: string; name: string }[]).find((m) => m.name === 'Camille');
    assert.ok(camille, 'le membre de test doit exister');
    // Camille se connecte avec « membre@example.fr » ; on renvoie « MEMBRE@example.fr »
    // avec un nouveau mot de passe. Le bug répondait 409 « email déjà utilisé ».
    const r = await appel(ctx.base, 'PUT', `/members/${camille!.id}/account`,
      { email: 'MEMBRE@example.fr', password: 'MotDePasseSolideNeuf9' }, ctx.jetons.admin);
    assert.notEqual(r.status, 409, `409 ne doit plus arriver : ${r.json?.error}`);
    assert.equal(r.status, 200, r.json?.error);
  });
});

describe('GET /finances/imports/:id/preview : identifiant invalide en 400 (A6)', () => {
  it('un identifiant non numérique répond 400, pas 415', async () => {
    const r = await appel(ctx.base, 'GET', '/finances/imports/abc/preview', undefined, ctx.jetons.admin);
    assert.equal(r.status, 400, `attendu 400, reçu ${r.status} : ${r.json?.error}`);
  });
});
