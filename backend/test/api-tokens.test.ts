// Les jetons d'accès par membre : ce qu'un jeton peut faire, et surtout ce
// qu'il ne peut pas. Un jeton agit au nom d'un membre, avec ses droits, jamais
// plus : lecture seule s'il est `read`, jamais les comptes, la sécurité, les
// finances, le système ni les notifications, jamais la création d'un autre jeton.
//
// Le pire cas visé est « un jeton révoqué », jamais « le document du foyer lu
// par un inconnu » : ces tests sont la preuve que le pire cas s'arrête là.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

/** Crée un jeton via la session d'un membre, en redonnant son mot de passe. */
async function creer(session: string, name: string, scope: 'read' | 'write', password: string) {
  return appel(ctx.base, 'POST', '/me/tokens', { name, scope, password }, session);
}

/** L'identifiant de membre d'une session (via /me). */
async function memberIdDe(session: string): Promise<string> {
  const me = await appel(ctx.base, 'GET', '/me', undefined, session);
  return me.json.memberId as string;
}

describe('Jetons d’accès par membre', () => {
  it('la création exige le bon mot de passe', async () => {
    const mauvais = await creer(ctx.jetons.membre, 'Script', 'read', 'MauvaisMotDePasse');
    assert.equal(mauvais.status, 403);

    const nom = await appel(ctx.base, 'POST', '/me/tokens', { scope: 'read', password: 'MotDePasseSolide2' }, ctx.jetons.membre);
    assert.equal(nom.status, 400, 'un nom est requis');

    const bon = await creer(ctx.jetons.membre, 'Claude iPhone', 'write', 'MotDePasseSolide2');
    assert.equal(bon.status, 201);
    assert.ok(typeof bon.json.token === 'string' && bon.json.token.startsWith('foyer_'), 'le secret est rendu une fois');
    assert.equal(bon.json.scope, 'write');
    assert.ok(bon.json.prefix.startsWith('foyer_'));
  });

  it('le secret n’est ni stocké en clair ni réaffiché', async () => {
    const cree = await creer(ctx.jetons.membre, 'Sauvegarde', 'read', 'MotDePasseSolide2');
    const secret = cree.json.token as string;

    const liste = await appel(ctx.base, 'GET', '/me/tokens', undefined, ctx.jetons.membre);
    assert.equal(liste.status, 200);
    for (const t of liste.json.tokens) {
      assert.ok(!('token' in t), 'la liste ne réaffiche jamais le secret');
      assert.ok(!('token_hash' in t), 'la liste n’expose pas le condensat');
    }

    // En base, ce qui est rangé n'est pas le secret mais son SHA-256.
    const db = await import('../src/db');
    const { hashJeton } = await import('../src/auth/tokens');
    const parHash = db.getApiTokenByHash(hashJeton(secret));
    assert.ok(parHash, 'le jeton se retrouve par le condensat de son secret');
    assert.notEqual(parHash!.token_hash, secret, 'le secret lui-même n’est pas la clé stockée');
  });

  it('un jeton read lit mais n’écrit pas ; un jeton write écrit', async () => {
    const lecture = (await creer(ctx.jetons.membre, 'Lecture', 'read', 'MotDePasseSolide2')).json.token;
    const ecriture = (await creer(ctx.jetons.membre, 'Écriture', 'write', 'MotDePasseSolide2')).json.token;

    assert.equal((await appel(ctx.base, 'GET', '/state', undefined, lecture)).status, 200);
    assert.equal((await appel(ctx.base, 'GET', '/live', undefined, lecture)).status, 200);

    // Une écriture avec un jeton lecture est refusée avant même de toucher au corps.
    assert.equal((await appel(ctx.base, 'POST', '/shopping/ops', { ops: [] }, lecture)).status, 403);
    assert.equal((await appel(ctx.base, 'PUT', '/state', { version: 1, state: {} }, lecture)).status, 403);

    // Le même geste avec un jeton écriture passe le garde de portée.
    assert.equal((await appel(ctx.base, 'POST', '/shopping/ops', { ops: [] }, ecriture)).status, 200);
  });

  it('un jeton révoqué rend 401', async () => {
    const cree = await creer(ctx.jetons.membre, 'À révoquer', 'read', 'MotDePasseSolide2');
    const secret = cree.json.token as string;
    const id = cree.json.id as number;

    assert.equal((await appel(ctx.base, 'GET', '/me', undefined, secret)).status, 200, 'valable avant révocation');

    const rev = await appel(ctx.base, 'DELETE', `/me/tokens/${id}`, undefined, ctx.jetons.membre);
    assert.equal(rev.status, 200);

    assert.equal((await appel(ctx.base, 'GET', '/me', undefined, secret)).status, 401, 'inerte après révocation');
    // La ligne reste, marquée révoquée, pour l'historique.
    const liste = await appel(ctx.base, 'GET', '/me/tokens', undefined, ctx.jetons.membre);
    const ligne = liste.json.tokens.find((t: { id: number }) => t.id === id);
    assert.ok(ligne && ligne.revoked_at, 'la révocation est horodatée, la ligne conservée');
  });

  it('un jeton ne peut pas créer de jeton', async () => {
    const secret = (await creer(ctx.jetons.membre, 'Parent', 'write', 'MotDePasseSolide2')).json.token;
    const tentative = await appel(ctx.base, 'POST', '/me/tokens', { name: 'Enfant', scope: 'write', password: 'MotDePasseSolide2' }, secret);
    assert.equal(tentative.status, 403);
  });

  it('les modules réservés répondent 403 à un jeton', async () => {
    // Membre adulte, jeton écriture : le rôle laisserait passer, la portée jeton non.
    const secret = (await creer(ctx.jetons.membre, 'Bloqué', 'write', 'MotDePasseSolide2')).json.token;
    const admin = (await creer(ctx.jetons.admin, 'AdminBloqué', 'write', 'MotDePasseSolide1')).json.token;

    const cas: [string, string, string][] = [
      ['GET', '/finances/accounts', secret],
      ['GET', '/members/accounts', admin],
      ['POST', '/members/m1/account', admin],
      ['PUT', '/me/credentials', secret],
      ['POST', '/me/totp/start', secret],
      ['GET', '/push/state', secret],
      ['GET', '/calendar/holidays', secret],
    ];
    for (const [method, chemin, jeton] of cas) {
      const r = await appel(ctx.base, method, chemin, method === 'GET' ? undefined : {}, jeton);
      assert.equal(r.status, 403, `${method} ${chemin} doit être fermé au jeton (reçu ${r.status})`);
    }

    // Les réglages restent lisibles mais non modifiables par un jeton.
    assert.equal((await appel(ctx.base, 'GET', '/settings', undefined, secret)).status, 200);
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { key: 'logLevel', value: 'debug' }, admin)).status, 403);

    // Le système est fermé, sa version reste lisible.
    assert.equal((await appel(ctx.base, 'GET', '/system/version', undefined, secret)).status, 200);
  });

  it('la dernière utilisation est notée', async () => {
    const cree = await creer(ctx.jetons.membre, 'Suivi', 'read', 'MotDePasseSolide2');
    const secret = cree.json.token as string;
    const id = cree.json.id as number;

    let ligne = (await appel(ctx.base, 'GET', '/me/tokens', undefined, ctx.jetons.membre)).json.tokens.find((t: { id: number }) => t.id === id);
    assert.equal(ligne.last_used_at, null, 'pas encore utilisé');

    await appel(ctx.base, 'GET', '/state', undefined, secret);

    ligne = (await appel(ctx.base, 'GET', '/me/tokens', undefined, ctx.jetons.membre)).json.tokens.find((t: { id: number }) => t.id === id);
    assert.ok(ligne.last_used_at, 'la première utilisation est notée');
  });

  it('un administrateur voit et révoque les jetons d’un autre membre ; un non-admin ne le peut pas', async () => {
    const secret = await creer(ctx.jetons.membre, 'Perso', 'read', 'MotDePasseSolide2');
    const id = secret.json.id as number;
    const membreId = await memberIdDe(ctx.jetons.membre);

    // L'admin voit la liste du membre.
    const vueAdmin = await appel(ctx.base, 'GET', `/members/${membreId}/tokens`, undefined, ctx.jetons.admin);
    assert.equal(vueAdmin.status, 200);
    assert.ok(vueAdmin.json.tokens.some((t: { id: number }) => t.id === id));

    // Un membre non-admin ne peut pas consulter la liste d'un autre.
    const adminId = await memberIdDe(ctx.jetons.admin);
    assert.equal((await appel(ctx.base, 'GET', `/members/${adminId}/tokens`, undefined, ctx.jetons.membre)).status, 403);

    // L'admin révoque le jeton du membre.
    const rev = await appel(ctx.base, 'DELETE', `/members/${membreId}/tokens/${id}`, undefined, ctx.jetons.admin);
    assert.equal(rev.status, 200);
    const apres = (await appel(ctx.base, 'GET', '/me/tokens', undefined, ctx.jetons.membre)).json.tokens.find((t: { id: number }) => t.id === id);
    assert.ok(apres.revoked_at, 'révoqué par l’administrateur');
  });
});
