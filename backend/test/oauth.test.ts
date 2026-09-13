// OAuth 2.1 pour les connecteurs claude.ai et ChatGPT : découverte,
// enregistrement dynamique borné, flux complet PKCE, usage unique du code,
// rotation des jetons de rafraîchissement, révocation, et le fait qu'un compte
// enfant obtient un jeton à ses droits d'enfant. Tout est éteint tant que le
// réglage mcpEnabled est faux et que l'adresse publique n'est pas posée.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
let root = ''; // l'adresse publique (racine), sans /api

const form = (o: Record<string, string>) => new URLSearchParams(o);
async function post(url: string, body: URLSearchParams, redirect: RequestRedirect = 'follow') {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, redirect });
  return r;
}
function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
async function registerClient(redirectUris: string[]) {
  const r = await fetch(root + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test', redirect_uris: redirectUris, token_endpoint_auth_method: 'none' }) });
  return { status: r.status, json: await r.json().catch(() => null) as { client_id?: string } };
}

/** Le flux interactif jusqu'au code : /authorize -> page de connexion -> POST allow. Rend l'URL de retour. */
async function authorizeAndLogin(clientId: string, redirectUri: string, challenge: string, state: string, email: string, password: string, scope: 'read' | 'write') {
  const authUrl = root + '/authorize?' + form({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'read write' }).toString();
  const authRes = await fetch(authUrl, { redirect: 'manual' });
  const loginLoc = authRes.headers.get('location') || '';
  const reqToken = new URL(root + loginLoc).searchParams.get('req') || '';
  const loginRes = await post(root + '/oauth/login', form({ req: reqToken, email, password, code: '', scope, action: 'allow' }), 'manual');
  return { authStatus: authRes.status, loginLoc, loginStatus: loginRes.status, back: loginRes.headers.get('location') || '' };
}

before(async () => {
  ctx = await demarrer();
  root = ctx.base.replace(/\/api$/, '');
  const on = await appel(ctx.base, 'PATCH', '/settings', { changes: { mcpEnabled: true, publicUrl: root } }, ctx.jetons.admin);
  assert.equal(on.status, 200, 'activation mcp + publicUrl : ' + JSON.stringify(on.json));
});
after(async () => { await arreter(ctx); });

describe('OAuth 2.1', () => {
  it('publie les métadonnées de découverte', async () => {
    const meta = await (await fetch(root + '/.well-known/oauth-authorization-server')).json();
    assert.equal(meta.issuer.replace(/\/$/, ''), root);
    assert.ok(meta.authorization_endpoint.endsWith('/authorize'));
    assert.ok(meta.token_endpoint.endsWith('/token'));
    assert.ok(meta.registration_endpoint.endsWith('/register'));
    assert.ok((meta.code_challenge_methods_supported || []).includes('S256'), 'PKCE S256 annoncé');
    // La ressource protégée est aussi annoncée.
    const rm = await fetch(root + '/.well-known/oauth-protected-resource');
    assert.equal(rm.status, 200);
  });

  it('refuse l’enregistrement d’une redirection non https (hors localhost)', async () => {
    assert.equal((await registerClient(['http://evil.example/cb'])).status, 400);
    assert.equal((await registerClient([])).status, 400);
    const ok = await registerClient(['https://claude.ai/cb', 'http://localhost:1234/cb']);
    assert.equal(ok.status, 201);
    assert.ok(ok.json.client_id, 'un client_id est délivré');
  });

  it('mène le flux PKCE complet et le jeton ouvre /mcp', async () => {
    const { json: c } = await registerClient(['https://claude.ai/cb']);
    const clientId = c.client_id!;
    const { verifier, challenge } = pkce();
    const back = await authorizeAndLogin(clientId, 'https://claude.ai/cb', challenge, 'st1', 'admin@example.fr', 'MotDePasseSolide1', 'write');
    assert.equal(back.authStatus, 302);
    assert.ok(back.loginLoc.startsWith('/oauth/login'), 'redirige vers la page de connexion');
    assert.equal(back.loginStatus, 302);
    const cb = new URL(back.back);
    assert.equal(cb.origin + cb.pathname, 'https://claude.ai/cb');
    assert.equal(cb.searchParams.get('state'), 'st1', 'state préservé');
    const code = cb.searchParams.get('code')!;
    assert.ok(code, 'un code est renvoyé');

    const tok = await (await post(root + '/token', form({ grant_type: 'authorization_code', code, redirect_uri: 'https://claude.ai/cb', client_id: clientId, code_verifier: verifier }))).json();
    assert.ok(/^foyer_/.test(tok.access_token), 'le jeton d’accès est un jeton Foyer');
    assert.ok(tok.refresh_token, 'un jeton de rafraîchissement est délivré');
    assert.equal(tok.scope, 'write');
    assert.equal(tok.expires_in, 30 * 24 * 60 * 60);

    // Le jeton ouvre bien /mcp.
    const mcp = await fetch(ctx.base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + tok.access_token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    const body = await mcp.text();
    assert.equal(mcp.status, 200);
    assert.match(body, /courses_ajouter/);

    // Le code ne resert pas.
    const reuse = await post(root + '/token', form({ grant_type: 'authorization_code', code, redirect_uri: 'https://claude.ai/cb', client_id: clientId, code_verifier: verifier }));
    assert.equal(reuse.status, 400, 'code à usage unique');
  });

  it('exige state, et vérifie PKCE (mauvais code_verifier refusé)', async () => {
    const { json: c } = await registerClient(['https://claude.ai/cb']);
    const clientId = c.client_id!;
    // state manquant : renvoi au client avec une erreur, pas de page de connexion.
    const noState = await fetch(root + '/authorize?' + form({ response_type: 'code', client_id: clientId, redirect_uri: 'https://claude.ai/cb', code_challenge: pkce().challenge, code_challenge_method: 'S256' }).toString(), { redirect: 'manual' });
    assert.equal(noState.status, 302);
    assert.match(noState.headers.get('location') || '', /error=invalid_request/);

    // Bon flux, mais mauvais verifier à l'échange : refusé par la validation PKCE.
    const { challenge } = pkce();
    const back = await authorizeAndLogin(clientId, 'https://claude.ai/cb', challenge, 'st2', 'admin@example.fr', 'MotDePasseSolide1', 'read');
    const code = new URL(back.back).searchParams.get('code')!;
    const bad = await post(root + '/token', form({ grant_type: 'authorization_code', code, redirect_uri: 'https://claude.ai/cb', client_id: clientId, code_verifier: 'mauvais-verifier-qui-ne-correspond-pas' }));
    assert.equal(bad.status, 400, 'PKCE vérifié');
  });

  it('fait tourner le jeton de rafraîchissement et refuse l’ancien', async () => {
    const { json: c } = await registerClient(['https://claude.ai/cb']);
    const clientId = c.client_id!;
    const { verifier, challenge } = pkce();
    const back = await authorizeAndLogin(clientId, 'https://claude.ai/cb', challenge, 'st3', 'admin@example.fr', 'MotDePasseSolide1', 'write');
    const code = new URL(back.back).searchParams.get('code')!;
    const tok = await (await post(root + '/token', form({ grant_type: 'authorization_code', code, redirect_uri: 'https://claude.ai/cb', client_id: clientId, code_verifier: verifier }))).json();

    const r1 = await (await post(root + '/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId }))).json();
    assert.ok(/^foyer_/.test(r1.access_token));
    assert.notEqual(r1.refresh_token, tok.refresh_token, 'rotation : nouveau jeton de rafraîchissement');
    // L'ancien ne resert pas.
    assert.equal((await post(root + '/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId }))).status, 400);

    // Révocation du jeton d'accès courant.
    assert.equal((await post(root + '/revoke', form({ token: r1.access_token, client_id: clientId }))).status, 200);
    const after = await fetch(ctx.base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + r1.access_token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(after.status, 401, 'jeton révoqué');
  });

  it('la page de consentement autorise le renvoi vers le client (CSP form-action)', async () => {
    // Sans l'origine du client dans form-action, Chromium refuse silencieusement
    // l'envoi du formulaire au clic sur « Autoriser » (la redirection de retour
    // vise une autre origine) : « rien ne se passe ». On vérifie donc que la
    // page pose une CSP qui autorise cette origine précise, en plus de 'self'.
    const { json: c } = await registerClient(['https://claude.ai/cb']);
    const authUrl = root + '/authorize?' + form({ response_type: 'code', client_id: c.client_id!, redirect_uri: 'https://claude.ai/cb', code_challenge: pkce().challenge, code_challenge_method: 'S256', state: 'stcsp', scope: 'read write' }).toString();
    const loginLoc = (await fetch(authUrl, { redirect: 'manual' })).headers.get('location') || '';
    const pageRes = await fetch(root + loginLoc);
    const csp = pageRes.headers.get('content-security-policy') || '';
    const fa = (csp.match(/form-action ([^;]*)/) || [])[1] || '';
    assert.ok(/'self'/.test(fa), "form-action inclut 'self' (envoi vers /oauth/login)");
    assert.ok(/https:\/\/claude\.ai/.test(fa), 'form-action inclut l’origine de retour du client');
  });

  it('/mcp sans jeton provoque la découverte (401 + WWW-Authenticate)', async () => {
    const r = await fetch(ctx.base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate') || '', /resource_metadata=/);
  });

  it('un compte enfant obtient un jeton à ses droits d’enfant', async () => {
    const { json: c } = await registerClient(['https://claude.ai/cb']);
    const clientId = c.client_id!;
    const { verifier, challenge } = pkce();
    const back = await authorizeAndLogin(clientId, 'https://claude.ai/cb', challenge, 'st4', 'enfant@example.fr', 'MotDePasseSolide7', 'write');
    const code = new URL(back.back).searchParams.get('code')!;
    const tok = await (await post(root + '/token', form({ grant_type: 'authorization_code', code, redirect_uri: 'https://claude.ai/cb', client_id: clientId, code_verifier: verifier }))).json();
    assert.ok(/^foyer_/.test(tok.access_token), 'l’enfant obtient un jeton');
    // Le jeton fonctionne, mais reste fermé aux modules interdits (finances) comme pour l'app.
    const fin = await fetch(ctx.base + '/finances/accounts', { headers: { authorization: 'Bearer ' + tok.access_token } });
    assert.equal(fin.status, 403, 'finances hors de portée, a fortiori pour un enfant');
  });
});
