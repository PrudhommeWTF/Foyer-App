// Un compte connecté ne suffit pas : il faut être quelqu'un du foyer.
//
// Ce fichier éprouve le garde de fond de la faille critique. Avant lui, un
// compte né de `POST /auth/register`, rattaché à aucun membre, lisait le
// document du foyer entier, les finances et les pièces jointes, et y écrivait :
// une seule requête HTTP anonyme suffisait à obtenir l'emploi du temps des
// enfants et l'adresse de la maison.
//
// Couper l'inscription libre ferme la porte. Ce garde-ci retire la pièce
// derrière : même inscription rallumée, même base portant déjà un compte
// orphelin, il n'y a rien à lire.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';
import { declOf } from '../src/settings/registry';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

/** Tout ce qu'un compte sans membre ne doit pas atteindre, en lecture comme en écriture. */
const INTERDIT: [string, string][] = [
  ['GET', '/state'], ['PUT', '/state'], ['GET', '/live'],
  ['GET', '/members/accounts'], ['GET', '/home/rules'], ['GET', '/calendar/school-holidays'],
  ['GET', '/calendar/ics'], ['GET', '/settings'], ['PATCH', '/settings'],
  ['GET', '/system/version'], ['GET', '/system/update-check'], ['GET', '/system/update-status'],
  ['GET', '/finances/bootstrap'], ['GET', '/finances/transactions'],
  ['GET', '/finances/export.json'], ['GET', '/finances/export.csv'],
  ['POST', '/finances/transactions'], ['DELETE', '/finances/transactions/1'],
  ['GET', '/finances/attachments/1'], ['DELETE', '/finances/attachments/1'],
  ['GET', '/files/1'], ['DELETE', '/files/1'], ['POST', '/files?owner=document&id=d1'],
  ['POST', '/shopping/ops'], ['POST', '/tasks/ops'], ['POST', '/recipes/import'],
  ['GET', '/push/status'],
];

describe('un compte rattaché à aucun membre n’accède à rien', () => {
  for (const [method, chemin] of INTERDIT) {
    it(`${method} ${chemin} → 403`, async () => {
      const r = await appel(ctx.base, method, chemin, method === 'GET' ? undefined : {}, ctx.jetons.sansMembre);
      assert.equal(r.status, 403, `${method} ${chemin} a répondu ${r.status} pour un compte sans membre`);
    });
  }

  it('le refus explique quoi faire, plutôt que de laisser deviner', async () => {
    const r = await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.sansMembre);
    assert.match(String(r.json.error), /rattaché à aucun membre/);
    assert.match(String(r.json.error), /administrateur/);
  });

  it('le document du foyer ne fuit pas une seule clé', async () => {
    const r = await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.sansMembre);
    assert.equal(r.json.state, undefined);
    assert.equal(r.json.members, undefined);
  });
});

describe('les deux routes qui restent ouvertes, et pourquoi', () => {
  it('/me répond, pour que l’écran sache quoi dire au lieu d’enchaîner les 403', async () => {
    const r = await appel(ctx.base, 'GET', '/me', undefined, ctx.jetons.sansMembre);
    assert.equal(r.status, 200);
    assert.equal(r.json.memberId, null, 'la fiche a disparu : rien plutôt qu’un identifiant fantôme');
    assert.equal(r.json.admin, false);
  });

  it('/me/credentials répond, pour changer son mot de passe sans dépendre de personne', async () => {
    const r = await appel(ctx.base, 'PUT', '/me/credentials', {
      currentPassword: 'MotDePasseSolide3', password: 'MotDePasseSolide4',
    }, ctx.jetons.sansMembre);
    assert.equal(r.status, 200);
  });
});

describe('un vrai membre, lui, passe', () => {
  it('un membre ordinaire lit le foyer', async () => {
    const r = await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre);
    assert.equal(r.status, 200);
    assert.ok(r.json.state.members.length >= 2);
  });

  it('un administrateur atteint l’exploitation', async () => {
    const r = await appel(ctx.base, 'GET', '/system/status', undefined, ctx.jetons.admin);
    assert.equal(r.status, 200);
  });
});

describe('l’inscription libre n’existe pas', () => {
  it('POST /auth/register n’est plus une route', async () => {
    const r = await appel(ctx.base, 'POST', '/auth/register', {
      email: 'robot@attaquant.example', password: 'robot-mot-de-passe', name: 'Robot',
    });
    assert.equal(r.status, 404, 'une route de création de comptes ouverte à Internet n’a aucune raison d’exister');
  });

  it('aucun compte n’a été créé au passage', async () => {
    const r = await appel(ctx.base, 'POST', '/auth/login', {
      email: 'robot@attaquant.example', password: 'robot-mot-de-passe',
    });
    assert.equal(r.status, 401);
  });

  it('/setup/status ne parle pas d’une inscription qui n’existe pas', async () => {
    const r = await appel(ctx.base, 'GET', '/setup/status');
    assert.equal(r.json.allowSignup, undefined);
    assert.equal(r.json.needsSetup, false);
  });

  it('le réglage signupAllowed a disparu du registre', () => {
    assert.equal(declOf('signupAllowed'), undefined,
      'un réglage qui ne pilote plus rien est un interrupteur sans fil');
  });
});
