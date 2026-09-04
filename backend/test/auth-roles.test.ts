// Qui a le droit de quoi, éprouvé sur les vraies routes.
//
// Trois frontières, et aucune n'était tenue avant cette tranche :
//
//   - un compte **enfant** lisait tout le module Finances et tous les documents
//     de famille, pièces d'identité scannées comprises, et pouvait en supprimer ;
//   - la liste des **adresses de connexion** du foyer était servie à n'importe
//     quel compte, c'est-à-dire l'inventaire exact des identifiants à attaquer ;
//   - le **jeton du flux ICS** l'était aussi, et il donne un accès permanent et
//     sans authentification à l'agenda des enfants.
//
// Masquer un écran n'a jamais empêché personne d'appeler l'API : ce fichier
// vérifie que le serveur refuse.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

describe('un compte enfant n’entre pas dans Finances', () => {
  const routes: [string, string][] = [
    ['GET', '/finances/bootstrap'], ['GET', '/finances/transactions'],
    ['GET', '/finances/accounts'], ['GET', '/finances/contracts'],
    ['GET', '/finances/export.json'], ['GET', '/finances/export.csv'],
    ['GET', '/finances/home?month=2026-09'], ['GET', '/finances/dashboard?month=2026-09'],
    ['POST', '/finances/transactions'], ['POST', '/finances/accounts'],
  ];
  for (const [method, chemin] of routes) {
    it(`${method} ${chemin} → 403`, async () => {
      const r = await appel(ctx.base, method, chemin, method === 'GET' ? undefined : {}, ctx.jetons.enfant);
      assert.equal(r.status, 403, `${method} ${chemin} a répondu ${r.status} à un compte enfant`);
    });
  }

  it('ni en lecture d’une pièce jointe', async () => {
    const r = await appel(ctx.base, 'GET', `/finances/attachments/${ctx.pieces.pieceFinances}`, undefined, ctx.jetons.enfant);
    assert.equal(r.status, 403);
  });

  it('ni en suppression d’une opération', async () => {
    const r = await appel(ctx.base, 'DELETE', `/finances/transactions/${ctx.pieces.transactionId}`, undefined, ctx.jetons.enfant);
    assert.equal(r.status, 403);
    const encore = await appel(ctx.base, 'GET', '/finances/transactions', undefined, ctx.jetons.admin);
    assert.equal(encore.json.total, 1, 'l’opération est toujours là');
  });
});

describe('un compte enfant n’entre pas dans les Documents, mais garde le carnet de recettes', () => {
  it('un document de famille ne se télécharge pas', async () => {
    const r = await appel(ctx.base, 'GET', `/files/${ctx.pieces.document}`, undefined, ctx.jetons.enfant);
    assert.equal(r.status, 403);
  });

  it('un document de famille ne se supprime pas', async () => {
    const r = await appel(ctx.base, 'DELETE', `/files/${ctx.pieces.document}`, undefined, ctx.jetons.enfant);
    assert.equal(r.status, 403);
    const adulte = await appel(ctx.base, 'GET', `/files/${ctx.pieces.document}`, undefined, ctx.jetons.admin);
    assert.equal(adulte.status, 200, 'le document est intact');
  });

  it('on ne dépose pas un document depuis un compte enfant', async () => {
    const res = await fetch(ctx.base + '/files?owner=document&id=d2&filename=x.pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer ' + ctx.jetons.enfant },
      body: new Uint8Array(Buffer.from('%PDF-1.7\n' + ' '.repeat(64))),
    });
    assert.equal(res.status, 403);
  });

  it('en revanche la photo d’une recette s’affiche : le carnet est de famille', async () => {
    const r = await appel(ctx.base, 'GET', `/files/${ctx.pieces.photoRecette}`, undefined, ctx.jetons.enfant);
    assert.equal(r.status, 200, 'refuser une photo de recette casserait l’écran sans rien protéger');
  });

  it('le genre se lit sur la fiche, pas sur ce que l’appelant déclare', async () => {
    // Même en présentant le document sous une adresse de recette, c'est la fiche
    // qui décide : l'identifiant est le seul paramètre, il ne se déguise pas.
    const r = await appel(ctx.base, 'GET', `/files/${ctx.pieces.document}?owner=recipe`, undefined, ctx.jetons.enfant);
    assert.equal(r.status, 403);
  });
});

describe('un adulte non administrateur reste dehors de l’administration', () => {
  const routes: [string, string][] = [
    ['GET', '/system/status'], ['POST', '/system/backup'], ['POST', '/system/update'],
    ['GET', '/system/backup/foyer-2026-01-01-1200.db'], ['DELETE', '/system/backup/foyer-2026-01-01-1200.db'],
    ['GET', '/settings/export'], ['POST', '/settings/import'],
    ['POST', '/members/m1/account'], ['PUT', '/members/m1/account'], ['DELETE', '/members/m1/account'],
    ['POST', '/calendar/ics/regenerate'], ['POST', '/finances/restore'],
  ];
  for (const [method, chemin] of routes) {
    it(`${method} ${chemin} → 403`, async () => {
      const r = await appel(ctx.base, method, chemin, method === 'GET' ? undefined : {}, ctx.jetons.membre);
      assert.equal(r.status, 403, `${method} ${chemin} a répondu ${r.status} à un adulte non administrateur`);
    });
  }
});

describe('ce qui ne doit sortir que pour un administrateur', () => {
  it('la liste des adresses de connexion du foyer', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/members/accounts', undefined, ctx.jetons.membre)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', '/members/accounts', undefined, ctx.jetons.enfant)).status, 403);
    const admin = await appel(ctx.base, 'GET', '/members/accounts', undefined, ctx.jetons.admin);
    assert.equal(admin.status, 200);
    assert.ok(admin.json.accounts.length >= 3);
  });

  it('le jeton du flux de calendrier, qui vaut accès permanent sans mot de passe', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/calendar/ics', undefined, ctx.jetons.membre)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', '/calendar/ics', undefined, ctx.jetons.enfant)).status, 403);
    const admin = await appel(ctx.base, 'GET', '/calendar/ics', undefined, ctx.jetons.admin);
    assert.equal(admin.status, 200);
    assert.match(String(admin.json.token), /^[0-9a-f]{36}$/);
  });

  it('l’export complet des finances, qui sort tout en un appel', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/finances/export.json', undefined, ctx.jetons.membre)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', '/finances/export.csv', undefined, ctx.jetons.membre)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', '/finances/export.json', undefined, ctx.jetons.admin)).status, 200);
  });
});
