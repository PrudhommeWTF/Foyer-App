// La page de connexion et de consentement OAuth, servie par le backend (pas par
// l'application Angular : elle doit marcher sans session, rester simple, et ne
// dépendre de rien). En français, aux couleurs de Foyer.
//
// Le flux : le fournisseur (oauth/provider.ts) a signé la demande d'autorisation
// et redirigé ici. La personne se connecte (email, mot de passe, code du second
// facteur si activé) et choisit la portée (lecture seule / lecture et écriture).
// À l'« Autoriser », on dépose un code d'autorisation et on renvoie au client.
// Au « Refuser », on renvoie une erreur au client. Mêmes temporisations et
// garde-fous que la connexion normale (auth/routes.ts).
import express, { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { findUserByEmail, getUserById, totpRecovery, setTotpLastStep, setTotpRecovery } from '../db';
import { verifier } from '../auth/passwords';
import { empreinteSecours, verifierCode } from '../auth/totp';
import { SEUILS_ADRESSE, SEUILS_COMPTE, Throttle, messageAttente } from '../auth/throttle';
import { OAuthRequest, hashLeurre, verifyOAuthRequest } from '../auth/session';
import { checkClientRedirect, issueAuthorizationCode } from './provider';
import { oauthEnabled } from './server';
import { log } from '../log';

const parCompte = new Throttle(SEUILS_COMPTE);
const parAdresse = new Throttle(SEUILS_ADRESSE);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop de tentatives, réessayez dans quelques minutes.',
});

const esc = (s: string): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Renvoie au client avec un paramètre (code+state, ou error+state), en préservant la query éventuelle. */
function redirectToClient(res: Response, redirectUri: string, params: Record<string, string>): void {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  res.redirect(302, url.href);
}

/**
 * Envoie la page de consentement avec une CSP adaptée. La CSP globale (helmet)
 * pose `form-action 'self'` ; or ce formulaire, une fois « Autoriser » cliqué,
 * renvoie le navigateur vers l'adresse de retour du client (claude.ai, ChatGPT…),
 * une autre origine. Chromium vérifie `form-action` jusqu'à la cible de la
 * redirection : sans l'origine du client, il refuse silencieusement l'envoi et
 * « rien ne se passe » au clic. On autorise donc, pour cette page seulement,
 * l'origine de retour de ce client précis (rien de plus large). La page est
 * autonome (styles en ligne, aucun script) : le reste est verrouillé.
 */
function sendConsent(res: Response, status: number, reqToken: string, r: OAuthRequest, opts: { error?: string; email?: string; scope?: string } = {}): void {
  let clientOrigin = '';
  try { clientOrigin = new URL(r.redirectUri).origin; } catch { /* déjà validée en amont */ }
  res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${clientOrigin}; base-uri 'none'; frame-ancestors 'none'`);
  res.status(status).type('html').send(page(reqToken, r, opts));
}

/** La page complète : en-tête Foyer, formulaire de connexion, choix de portée, boutons. */
function page(reqToken: string, r: OAuthRequest, opts: { error?: string; email?: string; scope?: string } = {}): string {
  const scope = opts.scope === 'write' ? 'write' : 'read';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autoriser l'accès · Foyer</title>
<style>
  :root { --primary:#E56B4E; --primary-dark:#C6492F; --bg:#FBF4EA; --surface:#fff; --soft:#F5EEE2; --ink:#3A302A; --ink2:#8A7E74; --ink3:#B7ABA0; --line:#E0D4C5; }
  * { box-sizing:border-box; } body { margin:0; font-family:'Nunito',system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--ink); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
  .card { background:var(--surface); border-radius:24px; box-shadow:0 30px 60px -30px rgba(90,60,40,.5); width:100%; max-width:420px; padding:30px 28px; }
  .brand { font-size:26px; font-weight:800; color:var(--primary); text-align:center; margin:0 0 4px; }
  .sub { text-align:center; color:var(--ink2); font-size:14px; margin:0 0 22px; }
  .who { background:var(--soft); border-radius:14px; padding:14px 16px; margin-bottom:20px; font-size:14px; line-height:1.5; }
  .who b { color:var(--ink); }
  label.lbl { display:block; font-size:12px; font-weight:800; color:var(--ink2); text-transform:uppercase; letter-spacing:.05em; margin:14px 0 7px; }
  input[type=email],input[type=password],input[type=text] { width:100%; border:2px solid var(--line); background:var(--surface); border-radius:13px; padding:12px 14px; font-size:15px; font-weight:600; color:var(--ink); outline:none; font-family:inherit; }
  input:focus { border-color:var(--primary); }
  .seg { display:flex; gap:8px; margin-top:4px; }
  .seg label { flex:1; border:2px solid var(--line); border-radius:13px; padding:10px; text-align:center; font-weight:800; font-size:13px; color:var(--ink2); cursor:pointer; }
  .seg input { position:absolute; opacity:0; }
  .seg input:checked + span { color:#fff; }
  .seg label:has(input:checked) { background:var(--primary); border-color:var(--primary); color:#fff; }
  .hint { font-size:11.5px; font-weight:700; color:var(--ink3); margin-top:6px; line-height:1.5; }
  .err { background:#FCE9E4; color:var(--primary-dark); border-radius:12px; padding:11px 14px; font-size:13px; font-weight:700; margin-bottom:16px; }
  .actions { display:flex; gap:10px; margin-top:22px; }
  button { flex:1; border:none; border-radius:13px; padding:13px; font-size:15px; font-weight:800; cursor:pointer; font-family:inherit; }
  .allow { background:var(--primary); color:#fff; } .deny { background:var(--soft); color:var(--ink2); }
</style></head><body>
<form class="card" method="post" action="/oauth/login">
  <div class="brand">Foyer</div>
  <div class="sub">Autoriser un accès à votre foyer</div>
  <div class="who"><b>${esc(r.clientName)}</b> demande à lire et agir dans votre foyer, en votre nom.</div>
  ${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ''}
  <input type="hidden" name="req" value="${esc(reqToken)}">
  <label class="lbl" for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username" required value="${esc(opts.email || '')}">
  <label class="lbl" for="password">Mot de passe</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <label class="lbl" for="code">Code du second facteur <span style="text-transform:none;color:var(--ink3)">(si activé)</span></label>
  <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="000000">
  <label class="lbl">Ce que cet accès pourra faire</label>
  <div class="seg">
    <label><input type="radio" name="scope" value="read" ${scope === 'read' ? 'checked' : ''}><span>Lecture seule</span></label>
    <label><input type="radio" name="scope" value="write" ${scope === 'write' ? 'checked' : ''}><span>Lecture et écriture</span></label>
  </div>
  <div class="hint">Les finances et les réglages restent hors de portée, quelle que soit l'option. Vous pourrez révoquer cet accès à tout moment dans Paramètres → Mon compte.</div>
  <div class="actions">
    <button class="deny" type="submit" name="action" value="deny">Refuser</button>
    <button class="allow" type="submit" name="action" value="allow">Autoriser</button>
  </div>
</form>
</body></html>`;
}

/** Page d'erreur autonome (demande expirée, client inconnu) : rien à renvoyer à un client non vérifié. */
function errorPage(res: Response, message: string): void {
  res.status(400).type('html').send(`<!doctype html><meta charset="utf-8"><title>Foyer</title>`
    + `<div style="font-family:system-ui;max-width:420px;margin:80px auto;padding:24px;text-align:center;color:#3A302A">`
    + `<h1 style="color:#E56B4E">Foyer</h1><p>${esc(message)}</p></div>`);
}

export function oauthLoginRouter(): Router {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '16kb' }));
  // OAuth éteint : la page de connexion ne traite rien (défense, même si sans
  // point d'octroi actif personne n'obtient de demande signée valide).
  r.use('/oauth/login', (_req, res, next) => { if (!oauthEnabled()) { errorPage(res, 'Les assistants ne sont pas activés sur ce foyer.'); return; } next(); });

  r.get('/oauth/login', loginLimiter, (req: Request, res: Response) => {
    let ar: OAuthRequest;
    try { ar = verifyOAuthRequest(String(req.query['req'] ?? '')); }
    catch { errorPage(res, 'Cette demande de connexion a expiré. Relancez la connexion depuis votre application.'); return; }
    if (!checkClientRedirect(ar.clientId, ar.redirectUri)) { errorPage(res, 'Demande d’autorisation invalide.'); return; }
    sendConsent(res, 200, String(req.query['req']), ar, { scope: ar.scopes.includes('write') ? 'write' : 'read' });
  });

  r.post('/oauth/login', loginLimiter, async (req: Request, res: Response) => {
    const reqToken = String(req.body?.req ?? '');
    let ar: OAuthRequest;
    try { ar = verifyOAuthRequest(reqToken); }
    catch { errorPage(res, 'Cette demande de connexion a expiré. Relancez la connexion depuis votre application.'); return; }
    if (!checkClientRedirect(ar.clientId, ar.redirectUri)) { errorPage(res, 'Demande d’autorisation invalide.'); return; }

    // Refus explicite : on renvoie au client, proprement.
    if (req.body?.action === 'deny') {
      redirectToClient(res, ar.redirectUri, { error: 'access_denied', state: ar.state });
      return;
    }

    const email = String(req.body?.email ?? '').trim();
    const cible = email.toLowerCase();
    const adresse = req.ip || 'inconnue';
    const nowMs = Date.now();
    const scope: 'read' | 'write' = req.body?.scope === 'write' ? 'write' : 'read';
    const render = (error: string): void => { sendConsent(res, 401, reqToken, ar, { error, email, scope }); };

    const attente = Math.max(parCompte.attente(cible, nowMs), parAdresse.attente(adresse, nowMs));
    if (attente > 0) { render(messageAttente(attente)); return; }

    const user = findUserByEmail(cible);
    const bon = await verifier(String(req.body?.password ?? ''), user ? user.password_hash : await hashLeurre());
    if (!user || !bon) {
      parCompte.echec(cible, nowMs); parAdresse.echec(adresse, nowMs);
      log.attention(`OAuth : connexion refusée pour ${cible} depuis ${adresse}.`);
      render('Identifiants invalides.');
      return;
    }

    // Second facteur, s'il est posé : code du téléphone, ou code de secours.
    if (user.totp_secret) {
      const saisi = String(req.body?.code ?? '').trim();
      if (!saisi) { render('Entrez le code de votre second facteur.'); return; }
      const pas = verifierCode(user.totp_secret, saisi, nowMs);
      if (pas !== null) {
        if (pas <= user.totp_last_step) { parCompte.echec(cible, nowMs); parAdresse.echec(adresse, nowMs); render('Ce code a déjà servi. Attendez le suivant.'); return; }
        setTotpLastStep(user.id, pas);
      } else {
        const secours = totpRecovery(user);
        const i = secours.findIndex((c) => !c.used && c.h === empreinteSecours(saisi));
        if (i < 0) { parCompte.echec(cible, nowMs); parAdresse.echec(adresse, nowMs); render('Code du second facteur incorrect.'); return; }
        secours[i].used = true; setTotpRecovery(user.id, secours);
      }
    }

    parCompte.succes(cible); parAdresse.succes(adresse);
    const fresh = getUserById(user.id);
    if (!fresh || !fresh.member_id) { render('Ce compte n’est rattaché à aucun membre du foyer : il n’a accès à rien.'); return; }
    const code = issueAuthorizationCode({ clientId: ar.clientId, userId: user.id, redirectUri: ar.redirectUri, codeChallenge: ar.codeChallenge, scope, resource: ar.resource || null });
    log.info(`OAuth : ${cible} a autorisé « ${ar.clientName} » (portée ${scope}) depuis ${adresse}.`);
    redirectToClient(res, ar.redirectUri, { code, state: ar.state });
  });

  return r;
}
