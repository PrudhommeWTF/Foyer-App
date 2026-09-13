// Le « kit d'authentification » partagé, sorti de server.ts : le secret des
// jetons, la signature et la lecture des sessions (cookie HttpOnly), le défi du
// second facteur, et les gardes qui protègent chaque route (connecté, membre du
// foyer, administrateur, adulte). Tout ce qui touche au cœur sensible vit ici,
// à un seul endroit qu'on peut relire seul, et que server.ts comme les routeurs
// de domaine importent plutôt que de recopier.
//
// Le secret ne sort jamais du module : on n'exporte que des fonctions qui
// signent ou vérifient, jamais la clé elle-même.
import { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { HouseholdState } from '../models';
import { UserRow, getApiTokenByHash, getHousehold, getUserById, touchApiToken } from '../db';
import { effectiveSetting } from '../settings/repo';
import { hacher, verifier } from './passwords';
import { estJeton, hashJeton } from './tokens';
import { log } from '../log';

/**
 * The JWT secret protects every session token — a weak or well-known value lets
 * anyone forge an admin session. Known defaults and short secrets are rejected.
 * In production we refuse to boot; in development we fall back to an ephemeral
 * random secret (sessions reset on restart) and warn loudly.
 */
const WEAK_SECRETS = new Set(['foyer-dev-secret-change-me', 'change-me-to-a-long-random-string']);
function resolveJwtSecret(): string {
  const provided = process.env.FOYER_JWT_SECRET || '';
  const weak = !provided || provided.length < 16 || WEAK_SECRETS.has(provided);
  if (!weak) return provided;
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    // eslint-disable-next-line no-console
    console.error(
      '[foyer] ERREUR : FOYER_JWT_SECRET manquant ou trop faible.\n' +
      '        Définissez une chaîne aléatoire d’au moins 16 caractères, par ex. :\n' +
      '          FOYER_JWT_SECRET="' + crypto.randomBytes(32).toString('hex') + '"\n' +
      '        Refus de démarrer pour ne pas exposer des sessions falsifiables.',
    );
    process.exit(1);
  }
  const ephemeral = crypto.randomBytes(32).toString('hex');
  // eslint-disable-next-line no-console
  console.warn('[foyer] ⚠ FOYER_JWT_SECRET absent/faible : secret aléatoire éphémère utilisé (les sessions seront invalidées au redémarrage). Définissez FOYER_JWT_SECRET en production.');
  return ephemeral;
}
const JWT_SECRET = resolveJwtSecret();

export interface AuthedRequest extends Request {
  user?: { id: number; email: string; tv: number; rm?: boolean; iat?: number; exp?: number };
  /**
   * Membre du foyer résolu pour cette requête, mémoïsé. `undefined` tant qu'on ne
   * l'a pas cherché, puis le membre ou `null`. Une seule et même requête interroge
   * plusieurs fois « qui est-ce » (garde `requireMember`, callbacks du routeur des
   * réglages, corps de la route) : sans ce cache, chaque appel reparse tout le
   * document d'état.
   */
  member?: HouseholdState['members'][number] | null;
  /**
   * Jeton d'accès (assistant, script) qui porte cette requête, quand elle n'est
   * pas une session de navigateur. Présent uniquement pour un `Authorization:
   * Bearer foyer_…` valide. Les gardes s'en servent pour brider la portée (un
   * jeton `read` ne peut pas écrire) et fermer les modules qu'un jeton ne gère
   * jamais (comptes, sécurité, finances, système).
   */
  apiToken?: { id: number; name: string; scope: 'read' | 'write' };
}

/**
 * Une route asynchrone dont l'échec devient un 500, pas une promesse non
 * traitée. Express 4 ne connaît pas les gestionnaires asynchrones : sans ce
 * garde, un rejet inattendu remonte à Node, qui arrête le processus. Un mot de
 * passe qui ne se hache pas ne doit pas couper l'application du foyer.
 */
export const route = (fn: (req: AuthedRequest, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req as AuthedRequest, res).catch((e) => {
      log.erreur('Erreur inattendue sur une route asynchrone', e);
      if (res.headersSent) { next(e); return; }
      res.status(500).json({ error: 'Erreur interne du serveur.' });
    });
  };

/**
 * Le secret qui signe le **défi** du second facteur, dérivé de celui des
 * sessions mais distinct de lui.
 *
 * Ce n'est pas une précaution de style. Entre le mot de passe et le code, il
 * faut bien remettre quelque chose au navigateur, et ce quelque chose ne doit
 * en aucun cas ouvrir l'application : sinon le second facteur ne serait qu'une
 * fenêtre décorative que l'on saute en gardant le jeton du premier temps. Signer
 * le défi avec un autre secret rend cette confusion **impossible par
 * construction**, plutôt que de dépendre d'un contrôle qu'une relecture
 * distraite pourrait retirer un jour.
 */
const DEFI_SECRET = crypto.createHmac('sha256', JWT_SECRET).update('foyer-totp-challenge').digest('hex');

/** Le défi vit cinq minutes : le temps de sortir son téléphone, pas davantage. */
const DEFI_MINUTES = 5;

export const signerDefi = (u: { id: number; token_version: number }, remember: boolean): string =>
  jwt.sign({ id: u.id, tv: u.token_version, rm: remember }, DEFI_SECRET, { expiresIn: `${DEFI_MINUTES}m` });

/** Relit un défi de second facteur, ou lève si périmé/falsifié (le secret ne sort pas du module). */
export const verifierDefi = (challenge: string): { id: number; tv: number; rm?: boolean } =>
  jwt.verify(challenge, DEFI_SECRET) as { id: number; tv: number; rm?: boolean };

/**
 * Un condensat bcrypt de rien du tout, comparé quand le compte n'existe pas.
 *
 * Sans lui, un compte inconnu ressortait avant tout calcul et un compte connu
 * payait la vérification : 2,0 ms contre 81,0 ms, mesurés, écarts nets. Le
 * message était bien le même dans les deux cas, mais le chronomètre disait
 * lequel des deux existait, et un attaquant n'avait plus qu'à concentrer son
 * bourrage sur les adresses qui répondent lentement.
 *
 * Le condensat est engendré au démarrage, avec le même coût que les vrais : le
 * chemin « compte inconnu » coûte désormais exactement ce que coûte le chemin
 * « mauvais mot de passe ».
 */
let leurrePromis: Promise<string> | null = null;
export const hashLeurre = (): Promise<string> => (leurrePromis ??= hacher('mot de passe qui ne sert a personne'));

export function sign(user: { id: number; email: string; token_version: number }, remember = true): string {
  // La durée est un réglage du foyer, lue à chaque connexion : la changer ne
  // touche pas aux sessions déjà ouvertes, qui gardent la durée qu'on leur a
  // donnée. C'est à la connexion suivante que la nouvelle valeur s'applique.
  //
  // `rm` (se souvenir de moi) voyage dans le jeton pour que le renouvellement à
  // mi-vie repose le cookie avec la même durée sans avoir à la redemander.
  const jours = Number(effectiveSetting('sessionDays')) || 30;
  return jwt.sign({ id: user.id, email: user.email, tv: user.token_version, rm: remember }, JWT_SECRET, { expiresIn: `${jours}d` });
}

/**
 * Le jeton de session voyage désormais dans un cookie `HttpOnly` plutôt que
 * rendu au JavaScript : une faille XSS ne peut donc plus le recopier, puisque le
 * script de la page ne le voit pas. Le corps de la réponse continue de porter le
 * jeton (les scripts d'API et l'en-tête `Authorization: Bearer` restent
 * acceptés), mais l'application, elle, ne s'appuie que sur le cookie et ne range
 * plus rien.
 */
export const SESSION_COOKIE = 'foyer_session';

/** Lit le jeton de session dans l'en-tête Cookie, sans dépendance de parsing. */
export function cookieToken(req: Request): string {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

/**
 * Pose (ou repose) le cookie de session.
 *
 * `SameSite=Lax` ferme la CSRF que le cookie rouvrirait : le navigateur ne
 * l'envoie pas sur une requête déclenchée par un autre site, sauf une simple
 * navigation de premier niveau, ce qui préserve le confort d'ouvrir l'app depuis
 * un lien sans exposer les gestes qui modifient (POST/PUT/etc.). `Secure` suit
 * le protocole réel de la requête (vrai derrière le reverse-proxy HTTPS, faux en
 * dev sur http, où le cookie doit tout de même partir). Sans `maxAge`, c'est un
 * cookie de session que le navigateur efface à sa fermeture : c'est le « ne pas
 * se souvenir de moi ».
 */
export function setSessionCookie(req: Request, res: Response, token: string, remember: boolean): void {
  const jours = Number(effectiveSetting('sessionDays')) || 30;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    path: '/',
    ...(remember ? { maxAge: jours * 86400_000 } : {}),
  });
}

/**
 * Ouvre une session : signe le jeton, pose le cookie, et rend `{ token, user }`.
 * C'est la queue commune à la connexion, au second facteur et à la création du
 * foyer (qui répond en 201). Ce qui précède (temporisation, journal) reste propre
 * à chaque appelant.
 */
export function ouvrirSession(
  req: Request, res: Response,
  user: { id: number; email: string; token_version: number; name: string; member_id: string | null },
  remember: boolean, statut = 200,
): void {
  const token = sign(user, remember);
  setSessionCookie(req, res, token, remember);
  res.status(statut).json({ token, user: { email: user.email, name: user.name, memberId: user.member_id } });
}

/**
 * Ce jeton a-t-il passé la moitié de sa vie ?
 *
 * On ne renouvelle pas à chaque appel : un jeton neuf toutes les cinq secondes
 * ferait tourner l'écriture du stockage du navigateur pour rien. La moitié est
 * le compromis habituel, et il garantit qu'une session active ne se termine
 * jamais par une déconnexion surprise.
 */
export function aRenouveler(u: { iat?: number; exp?: number } | undefined, now = Date.now()): boolean {
  if (!u?.iat || !u?.exp || u.exp <= u.iat) return false;
  return now / 1000 > u.iat + (u.exp - u.iat) / 2;
}

/** Longueur minimale exigée d'un mot de passe, et le message qui va avec. */
export const pwdMin = (): number => Number(effectiveSetting('passwordMinLength')) || 6;
export const pwdTropCourt = (): string => `Le mot de passe doit faire au moins ${pwdMin()} caractères`;

/**
 * Le mot de passe fourni dans le corps est-il bien celui de `user` ?
 *
 * Un seul endroit lit le mot de passe du corps (champ `champ`, « password » par
 * défaut, « currentPassword » pour un changement d'identifiants) et le compare
 * au condensat. Les gestes sensibles, changer ses identifiants, régler ou
 * retirer le second facteur, mettre à jour le serveur, se confirment tous par
 * là : chacun garde son propre refus (statut, message, journal), mais la lecture
 * du secret et sa comparaison ne s'écrivent qu'ici.
 */
export const motDePasseBon = (req: Request, user: UserRow, champ = 'password'): Promise<boolean> =>
  verifier(String(req.body?.[champ] ?? ''), user.password_hash);

/**
 * Dernière utilisation d'un jeton, notée au plus une fois par minute.
 *
 * Sans ce garde-mémoire, chaque requête d'un assistant qui sonde toutes les
 * cinq secondes écrirait en base : la colonne `last_used_at` n'a pas besoin
 * d'être à la seconde près, seulement de dire « aujourd'hui » ou « il y a un
 * mois ». La carte se vide au redémarrage, au prix d'une écriture de plus.
 */
const dernierToucher = new Map<number, number>();
const TOUCHER_MS = 60_000;

export function auth(req: AuthedRequest, res: Response, next: NextFunction): void {
  // Le cookie d'abord, l'en-tête `Authorization: Bearer` ensuite : l'application
  // s'appuie sur le cookie, mais un script d'API qui porte son jeton en en-tête
  // reste servi.
  const header = req.headers.authorization || '';
  const token = cookieToken(req) || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!token) {
    res.status(401).json({ error: 'Non authentifié' });
    return;
  }

  // Jeton d'accès par membre : porté en en-tête `Bearer foyer_…`, jamais dans un
  // cookie (un onglet de navigateur ne doit pas pouvoir être piloté par ce
  // biais). On cherche par le condensat, on refuse un jeton inconnu ou révoqué,
  // et on pose `req.user` comme pour une session, plus `req.apiToken` pour les
  // gardes de portée.
  if (estJeton(token) && !cookieToken(req)) {
    const row = getApiTokenByHash(hashJeton(token));
    if (!row || row.revoked_at) {
      res.status(401).json({ error: 'Jeton d’accès invalide ou révoqué' });
      return;
    }
    const u = getUserById(row.user_id);
    if (!u) {
      res.status(401).json({ error: 'Jeton d’accès invalide ou révoqué' });
      return;
    }
    const now = Date.now();
    const vu = dernierToucher.get(row.id) ?? 0;
    if (now - vu > TOUCHER_MS) {
      dernierToucher.set(row.id, now);
      try { touchApiToken(row.id, String(req.headers['user-agent'] || '')); } catch { /* pas grave */ }
      if (!vu) log.info(`Jeton : première utilisation de « ${row.name} » (${u.email}) depuis ${req.ip || 'adresse inconnue'}.`);
    }
    req.user = { id: u.id, email: u.email, tv: u.token_version };
    req.apiToken = { id: row.id, name: row.name, scope: row.scope };
    next();
    return;
  }

  let payload: { id: number; email: string; tv?: number; rm?: boolean; iat?: number; exp?: number };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { id: number; email: string; tv?: number; rm?: boolean; iat?: number; exp?: number };
  } catch {
    res.status(401).json({ error: 'Session expirée' });
    return;
  }
  // Reject tokens whose user no longer exists or whose version has been bumped
  // (password change / account removal revokes all outstanding sessions).
  const user = getUserById(payload.id);
  if (!user || (payload.tv ?? 0) !== user.token_version) {
    res.status(401).json({ error: 'Session révoquée' });
    return;
  }
  req.user = { id: user.id, email: user.email, tv: user.token_version, rm: payload.rm ?? true, iat: payload.iat, exp: payload.exp };
  next();
}

/** The household member linked to the authenticated user (or null). Mémoïsé sur la requête. */
export function currentMember(req: AuthedRequest): HouseholdState['members'][number] | null {
  if (req.member !== undefined) return req.member;
  return (req.member = resolveMember(req));
}

function resolveMember(req: AuthedRequest): HouseholdState['members'][number] | null {
  if (!req.user) return null;
  const u = getUserById(req.user.id);
  if (!u || !u.member_id) return null;
  const state = getHousehold().state as HouseholdState;
  return state.members.find((m) => m.id === u.member_id) || null;
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  const m = currentMember(req);
  if (!m || !m.admin) { res.status(403).json({ error: 'Action réservée à un administrateur du foyer' }); return; }
  next();
}

/**
 * Un compte connecté ne suffit pas : il faut être **quelqu'un du foyer**.
 *
 * Un compte peut exister sans être rattaché à un membre : c'est le cas de tout
 * compte né de `POST /auth/register`, qui ne demande qu'une adresse et un mot de
 * passe. Sans ce garde, un tel compte lisait et écrivait le document du foyer
 * entier, les finances et les pièces jointes, exactement comme un parent : il
 * suffisait que les inscriptions soient ouvertes pour que n'importe qui, depuis
 * Internet, obtienne l'agenda des enfants et l'adresse de la maison.
 *
 * Couper les inscriptions ferme la porte ; ce garde-ci retire la pièce derrière.
 * Les deux sont nécessaires : le réglage peut être rallumé, une base peut déjà
 * porter un compte orphelin, et un membre supprimé laisse son compte derrière lui.
 *
 * Deux routes restent ouvertes à un compte sans membre, à dessein : `/me`, pour
 * que l'application sache quoi afficher plutôt que d'enchaîner les 403 sans rien
 * expliquer, et `/me/credentials`, pour que la personne puisse changer son mot de
 * passe sans dépendre de personne.
 */
export function requireMember(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!currentMember(req)) {
    res.status(403).json({
      error: 'Ce compte n’est rattaché à aucun membre du foyer : il n’a accès à rien. '
        + 'Demandez à un administrateur du foyer de vous rattacher à un membre depuis l’écran « Famille ».',
    });
    return;
  }
  next();
}

/**
 * Les modules qui ne concernent pas un enfant : Finances et Documents.
 *
 * Un compte enfant lisait jusqu'ici tout le module Finances (comptes, soldes,
 * opérations, contrats avec leurs références client, export complet en un
 * appel) et tous les documents de famille, pièces d'identité scannées
 * comprises. Il pouvait aussi en **supprimer**. Masquer les écrans ne changeait
 * rien : l'API répondait à qui la sollicitait.
 *
 * Le cloisonnement est ici, côté serveur, comme celui des réglages. Les écrans
 * correspondants disparaissent aussi de la navigation, pour ne pas proposer une
 * porte qui répond 403.
 */
export function requireAdulte(req: AuthedRequest, res: Response, next: NextFunction): void {
  const m = currentMember(req);
  if (!m) { requireMember(req, res, next); return; }
  if (m.enfant) {
    res.status(403).json({ error: 'Ce module n’est pas accessible depuis un compte enfant.' });
    return;
  }
  next();
}

// ---- Gardes propres aux jetons d'accès ----
// Un jeton agit au nom d'un membre, avec ses droits, et jamais plus : il ne
// gère ni les comptes, ni la sécurité, ni le système, ni les finances. Ces
// gardes ferment ces portes côté serveur, quel que soit le rôle du membre. Une
// session de navigateur (pas de `req.apiToken`) n'est jamais gênée par eux.

/** Une méthode qui ne change rien : lisible par un jeton `read`. */
const lecture = (m: string): boolean => m === 'GET' || m === 'HEAD' || m === 'OPTIONS';

/**
 * Débit d'un jeton : 120 requêtes par minute, comptées par identifiant de jeton,
 * distinct du garde-fou des connexions. Une seule instance, réutilisée sur tous
 * les routeurs, pour que le compteur soit commun à toute l'API. Les sessions de
 * navigateur sont ignorées (pas de `req.apiToken`).
 */
export const apiTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => String((req as AuthedRequest).apiToken?.id ?? ''),
  skip: (req: Request) => !(req as AuthedRequest).apiToken,
  message: { error: 'Trop de requêtes pour ce jeton d’accès, réessayez dans un instant.' },
});

/**
 * Refuse en 403 toute écriture faite avec un jeton `read`. Sans effet sur une
 * lecture, sur un jeton `write`, ou sur une session de navigateur.
 */
export function requireScope(scope: 'write'): (req: AuthedRequest, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const t = req.apiToken;
    if (t && !lecture(req.method) && t.scope !== scope) {
      res.status(403).json({ error: 'Ce jeton d’accès est en lecture seule.' });
      return;
    }
    next();
  };
}

/** Ferme une route à tout jeton d'accès (comptes, sécurité, système, notifications). */
export function denyToken(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.apiToken) {
    res.status(403).json({ error: 'Cette action n’est pas accessible par un jeton d’accès.' });
    return;
  }
  next();
}

/** Ferme les écritures d'une route à tout jeton, en laissant passer la lecture (réglages : lisibles, non modifiables). */
export function denyTokenWrite(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.apiToken && !lecture(req.method)) {
    res.status(403).json({ error: 'Cette action n’est pas accessible par un jeton d’accès.' });
    return;
  }
  next();
}

/**
 * Le système est fermé aux jetons, à une exception près : la version courante,
 * en lecture, qu'un assistant peut légitimement vouloir afficher.
 */
export function denyTokenSystem(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.apiToken && !(lecture(req.method) && req.path === '/version')) {
    res.status(403).json({ error: 'Cette action n’est pas accessible par un jeton d’accès.' });
    return;
  }
  next();
}
