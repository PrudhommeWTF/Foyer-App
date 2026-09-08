// Le jeton de session voyage dans un cookie HttpOnly, pas rendu au JavaScript.
//
// Ce que ce fichier prouve, sur les vraies routes : la connexion pose un cookie
// `foyer_session` marqué HttpOnly et SameSite=Lax ; ce cookie seul, sans aucun
// en-tête Authorization, ouvre l'application ; « se souvenir de moi » décide de
// sa durée ; et la déconnexion l'efface. Le corps continue de rendre le jeton
// pour les clients en en-tête Bearer, éprouvés ailleurs.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

/** Le cookie de session posé par une réponse, ou undefined s'il n'y en a pas. */
const cookieDe = (res: Response): string | undefined =>
  res.headers.getSetCookie().find((c) => c.startsWith('foyer_session='));

/** La valeur du jeton dans un cookie « foyer_session=…; … ». */
const valeur = (setCookie: string): string => setCookie.slice('foyer_session='.length).split(';')[0];

const connexion = (body: unknown): Promise<Response> =>
  fetch(ctx.base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('la connexion pose un cookie de session HttpOnly', () => {
  it('le cookie est HttpOnly et SameSite=Lax', async () => {
    const res = await connexion({ email: 'admin@example.fr', password: 'MotDePasseSolide1' });
    assert.equal(res.status, 200);
    const c = cookieDe(res);
    assert.ok(c, 'la réponse doit poser un cookie foyer_session');
    assert.match(c!, /HttpOnly/i, 'le cookie doit être HttpOnly, invisible au JavaScript');
    assert.match(c!, /SameSite=Lax/i, 'le cookie doit être SameSite=Lax pour fermer la CSRF');
  });

  it('« se souvenir de moi » décide de la durée du cookie', async () => {
    // Persistant : une échéance (Max-Age ou Expires) qui survit à la fermeture.
    const oui = cookieDe(await connexion({ email: 'admin@example.fr', password: 'MotDePasseSolide1', remember: true }));
    assert.match(oui!, /Max-Age=|Expires=/i, 'remember=true doit poser un cookie persistant');
    // Cookie de session : aucune échéance, le navigateur l'efface à la fermeture.
    const non = cookieDe(await connexion({ email: 'admin@example.fr', password: 'MotDePasseSolide1', remember: false }));
    assert.doesNotMatch(non!, /Max-Age=|Expires=/i, 'remember=false doit poser un cookie de session');
  });

  it('le cookie seul, sans en-tête Authorization, ouvre l’application', async () => {
    const jeton = valeur(cookieDe(await connexion({ email: 'admin@example.fr', password: 'MotDePasseSolide1' }))!);
    const res = await fetch(ctx.base + '/state', { headers: { cookie: 'foyer_session=' + jeton } });
    assert.equal(res.status, 200, 'le cookie doit authentifier à lui seul');
  });

  it('un cookie absent ou vide laisse la route fermée', async () => {
    assert.equal((await fetch(ctx.base + '/state')).status, 401);
    assert.equal((await fetch(ctx.base + '/state', { headers: { cookie: 'foyer_session=' } })).status, 401);
  });
});

describe('la déconnexion efface le cookie', () => {
  it('POST /auth/logout repose un cookie déjà expiré', async () => {
    const res = await fetch(ctx.base + '/auth/logout', { method: 'POST' });
    assert.equal(res.status, 200);
    const c = cookieDe(res);
    assert.ok(c, 'la déconnexion doit reposer le cookie pour l’effacer');
    // Effacer, c'est reposer le même cookie avec une échéance dans le passé.
    assert.match(c!, /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});

// Le corps de la réponse garde le jeton : c'est le contrat des clients en
// en-tête Bearer, et le reste de la suite s'y appuie encore.
describe('le corps de la connexion porte toujours le jeton', () => {
  it('login rend un jeton utilisable en Bearer', async () => {
    const r = await appel(ctx.base, 'POST', '/auth/login', { email: 'admin@example.fr', password: 'MotDePasseSolide1' });
    assert.ok(r.json.token, 'le jeton doit rester dans le corps');
    assert.equal((await appel(ctx.base, 'GET', '/state', undefined, r.json.token)).status, 200);
  });
});
