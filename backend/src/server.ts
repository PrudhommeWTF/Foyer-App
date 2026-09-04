import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { cacheControlFor } from './static-cache';
import fs from 'fs';
import path from 'path';
import {
  countUsers,
  createUserWithMember,
  deleteUser,
  findUserByEmail,
  getHousehold,
  getIcsToken,
  getSchoolHolidaysCache,
  getStateByIcsToken,
  getUserById,
  getUserByMemberId,
  listMemberAccounts,
  saveHousehold,
  setIcsToken,
  setSchoolHolidaysCache,
  setPasswordHash,
  updateUserCredentials,
} from './db';
import { buildInitialState, HouseholdState } from './seed';
import { financesRouter } from './finances/routes';
import { filesRouter } from './storage/routes';
import { shoppingRouter } from './shopping/routes';
import { recipesRouter } from './recipes/routes';
import { getShopping, preserveShopping } from './shopping/repo';
import { tasksRouter } from './tasks/routes';
import { getTasks, onAssigned, preserveTasks } from './tasks/repo';
import { pushRouter } from './notify/routes';
import { initPush, notify, resolveVapidSubject } from './notify/push';
import { startScheduler } from './notify/scheduler';
import { db, listMemberAccounts as accountsOf } from './db';
import { buildIcs } from './ics';
import { conflictOf, isUpToDate } from './state/concurrency';
import { StateInvalide, validateState } from './state/validate';
import { settingsRouter } from './settings/routes';
import { deploymentView, effectiveSetting, envOverrides, foreignPrefsChanged, settingsChanged } from './settings/repo';
import { setting } from './settings/registry';
import { loadRules, rulesPath } from './home/rules';
import { freshStatus } from './update-status';
import { DEADLINE_HORIZON_DAYS, deadlines as contractDeadlines } from './finances/contracts';
import { LogLevel, log, setLogLevelSource } from './log';
import { BackupRefused, makeSnapshot, removeSnapshot, snapshotPath } from './system/backup';
import { buildStatus } from './system/status';
import { SEUILS_ADRESSE, SEUILS_COMPTE, Throttle, messageAttente } from './auth/throttle';
import { aRehacher, hacher, verifier } from './auth/passwords';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const DATA_DIR = process.env.FOYER_DATA_DIR || path.join(__dirname, '..', 'data');
const GITHUB_REPO = process.env.FOYER_GITHUB_REPO || 'PrudhommeWTF/Foyer-App';

const selfUpdateEnabled = (): boolean => /^(1|true|yes|on)$/i.test(process.env.FOYER_SELF_UPDATE || '');

function currentVersion(): string {
  // Source de vérité : la variable FOYER_VERSION (injectée par Docker au build et
  // par l'installeur LXC dans /etc/foyer/foyer.env). Le fichier <data>/version est
  // un repli hérité (installs antérieures), retiré à la prochaine mise à jour.
  if (process.env.FOYER_VERSION) return process.env.FOYER_VERSION.replace(/^v/, '');
  try { const vf = path.join(DATA_DIR, 'version'); if (fs.existsSync(vf)) return fs.readFileSync(vf, 'utf-8').trim().replace(/^v/, ''); } catch { /* ignore */ }
  try { const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')); return String(pkg.version); } catch { /* ignore */ }
  return '0.0.0';
}

function semverCmp(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'Foyer-App' };
  if (process.env.FOYER_GITHUB_TOKEN) headers['Authorization'] = 'Bearer ' + process.env.FOYER_GITHUB_TOKEN;
  return headers;
}

async function fetchLatestRelease(): Promise<{ tag: string; name: string; body: string; url: string; publishedAt: string }> {
  // Prefer a published GitHub Release; fall back to the highest semver tag.
  const rel = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers: ghHeaders(), signal: AbortSignal.timeout(8000) });
  if (rel.ok) {
    const j = (await rel.json()) as { tag_name: string; name?: string; body?: string; html_url: string; published_at: string };
    return { tag: j.tag_name, name: j.name || j.tag_name, body: j.body || '', url: j.html_url, publishedAt: j.published_at };
  }
  if (rel.status !== 404) throw new Error('GitHub HTTP ' + rel.status);

  const tagsRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=100`, { headers: ghHeaders(), signal: AbortSignal.timeout(8000) });
  if (!tagsRes.ok) throw new Error(tagsRes.status === 404 ? 'aucune release ni tag' : 'GitHub HTTP ' + tagsRes.status);
  const tags = (await tagsRes.json()) as { name: string }[];
  const semverTags = tags.map((t) => t.name).filter((n) => /^v?\d+\.\d+/.test(n)).sort((a, b) => semverCmp(a, b));
  const latest = semverTags[semverTags.length - 1];
  if (!latest) throw new Error('aucune release ni tag de version');
  return { tag: latest, name: latest, body: '', url: `https://github.com/${GITHUB_REPO}/releases/tag/${latest}`, publishedAt: '' };
}

const PORT = parseInt(process.env.PORT || '8099', 10);

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
  console.warn('[foyer] ⚠ FOYER_JWT_SECRET absent/faible — secret aléatoire éphémère utilisé (les sessions seront invalidées au redémarrage). Définissez FOYER_JWT_SECRET en production.');
  return ephemeral;
}
const JWT_SECRET = resolveJwtSecret();

// Le niveau de journalisation est un réglage du foyer, relu à chaque ligne :
// « journalctl -f -u foyer » change de verbosité pendant qu'on le regarde, sans
// redémarrer le service. Le repli sur « info » couvre le démarrage, avant que la
// base ne soit ouverte.
setLogLevelSource(() => {
  try { return effectiveSetting('logLevel') as LogLevel; } catch { return 'info'; }
});
// The frontend uses a relative base href, so a single build works served at the
// root or behind a reverse proxy on a sub-path.
const STATIC_DIR = process.env.FOYER_STATIC_DIR || path.join(__dirname, '..', 'public');


const app = express();

/**
 * À qui l'on fait confiance pour dire d'où vient une requête.
 *
 * `X-Forwarded-For` est un en-tête que **l'appelant** écrit. Le croire n'a de
 * sens que si un proxy l'a réécrit avant nous. Derrière NGINX Proxy Manager
 * configuré comme le décrit docs/mise-en-ligne-checklist.md, c'est le cas, et
 * `1` est la bonne valeur : le dernier maillon est le proxy.
 *
 * Joignable directement, en revanche, l'attaquant EST le maillon, et son en-tête
 * est cru : mesuré, dix tentatives avec « X-Forwarded-For » différent à chaque
 * coup repartaient toutes à zéro, et la temporisation ne servait plus à rien.
 * Deux réponses, complémentaires :
 *
 *   - `FOYER_BIND=127.0.0.1` : le service n'est joignable que par un proxy local,
 *     personne d'autre ne peut être le maillon ;
 *   - `FOYER_TRUST_PROXY=false` : aucun en-tête n'est cru, l'adresse vue est celle
 *     de la connexion. C'est la bonne valeur quand l'application est exposée
 *     directement sur le réseau, sans proxy devant.
 */
const trustProxy = ((): number | boolean => {
  const brut = (process.env.FOYER_TRUST_PROXY || '').trim();
  if (!brut) return 1;
  if (/^(0|false|no|off)$/i.test(brut)) return false;
  const n = parseInt(brut, 10);
  return Number.isInteger(n) && n >= 0 ? n : 1;
})();
app.set('trust proxy', trustProxy);

/** L'interface d'écoute. Voir FOYER_TRUST_PROXY ci-dessus pour le rapport entre les deux. */
const BIND = process.env.FOYER_BIND || '0.0.0.0';

// Security headers. The frontend is a self-hosted SPA that inlines styles and loads
// Google fonts; images come as data:/blob: URLs. upgrade-insecure-requests is disabled
// so plain-HTTP LAN installs (e.g. http://10.x:8099) keep working.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      // Angular pose des styles en ligne ; les polices, elles, sont servies par
      // le foyer depuis que fonts.googleapis.com a été retiré (voir index.html).
      'style-src': ["'self'", "'unsafe-inline'"],
      'font-src': ["'self'", 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
      'upgrade-insecure-requests': null,
    },
  },
  crossOriginEmbedderPolicy: false,
  // Un an, avec les sous-domaines. `preload` n'est pas posé : l'inscription sur
  // la liste des navigateurs est difficile à défaire, et ce domaine peut servir
  // à autre chose un jour. L'en-tête ne part que sur HTTPS, les installations
  // locales en clair ne sont pas gênées.
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
}));

/**
 * Ce que la page n'a aucune raison de demander au navigateur.
 *
 * Foyer n'utilise ni la position, ni la caméra, ni le micro, ni le paiement, ni
 * l'USB. Le dire fermement retire ces capacités à tout ce qui s'exécuterait dans
 * la page, y compris à un script qui aurait trouvé le moyen d'y entrer. Helmet
 * ne pose pas cet en-tête, d'où cette ligne.
 */
const PERMISSIONS = [
  'accelerometer=()', 'autoplay=()', 'camera=()', 'display-capture=()', 'encrypted-media=()',
  'fullscreen=(self)', 'geolocation=()', 'gyroscope=()', 'magnetometer=()', 'microphone=()',
  'midi=()', 'payment=()', 'picture-in-picture=()', 'publickey-credentials-get=()',
  'screen-wake-lock=()', 'usb=()', 'xr-spatial-tracking=()',
].join(', ');
app.use((_req, res, next) => { res.setHeader('Permissions-Policy', PERMISSIONS); next(); });

// CORS: same-origin by default (the API serves its own SPA). Extra origins can be
// allow-listed via FOYER_CORS_ORIGINS (comma-separated) for split deployments.
const corsOrigins = (process.env.FOYER_CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : false, // false → no cross-origin; same-origin requests are unaffected
  credentials: true,
}));

// Depuis la migration 5 du document d'état, ni les photos de recettes ni les
// pièces du module Documents ne voyagent dans l'état : les octets vivent sur le
// disque et sont servis par /api/files. Le plafond peut donc redescendre à ce
// que pèse réellement un foyer, texte compris, au lieu des 15 Mo qu'il fallait
// pour un état bourré de data-URL.
app.use(express.json({ limit: '4mb' }));

// Sans ce garde, un état trop gros ressort en page HTML d'Express, sans dire
// pourquoi ni quoi faire. Ce cas ne devrait plus se produire : s'il se produit,
// c'est presque toujours qu'une pièce n'a pas su être décodée à la migration et
// pèse encore dans l'état, et le journal de démarrage la nomme.
app.use((err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type !== 'entity.too.large') { next(err); return; }
  res.status(413).json({
    error: 'Enregistrement refusé : le document du foyer dépasse la taille maximale (4 Mo). '
      + 'Les fichiers et les photos sont rangés sur le disque, pas dans l’état : un état de cette taille '
      + 'signale qu’il en reste, en général une pièce que la migration n’a pas su décoder. '
      + 'Le journal de démarrage (journalctl -u foyer) nomme les fiches concernées.',
  });
});

/**
 * Le garde-fou grossier des routes d'identifiants : il borne le débit brut, pas
 * les tentatives. La vraie temporisation est dans auth/throttle.ts, par compte
 * visé et par adresse, et c'est elle qui distingue un attaquant d'une famille.
 *
 * Les requêtes **réussies ne comptent plus** : sans cela, trente connexions
 * légitimes dans le quart d'heure fermaient la porte à la trente-et-unième, et
 * un foyer de cinq personnes sur quatre appareils y arrive.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez dans quelques minutes.' },
});

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
/**
 * Calculé une fois, à la première connexion qui en a besoin, et gardé. Le poser
 * au démarrage laisserait une fenêtre de quelques centaines de millisecondes où
 * il serait vide, donc où le chemin « compte inconnu » redeviendrait instantané
 * et trahirait de nouveau l'existence des comptes.
 */
const hashLeurre = (): Promise<string> => (leurrePromis ??= hacher('mot de passe qui ne sert a personne'));

/**
 * Une route asynchrone dont l'échec devient un 500, pas une promesse non
 * traitée. Express 4 ne connaît pas les gestionnaires asynchrones : sans ce
 * garde, un rejet inattendu remonte à Node, qui arrête le processus. Un mot de
 * passe qui ne se hache pas ne doit pas couper l'application du foyer.
 */
const route = (fn: (req: AuthedRequest, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req as AuthedRequest, res).catch((e) => {
      log.erreur('Erreur inattendue sur une route asynchrone', e);
      if (res.headersSent) { next(e); return; }
      res.status(500).json({ error: 'Erreur interne du serveur.' });
    });
  };

/**
 * Les deux compteurs de tentatives : par compte visé, et par adresse. Voir
 * auth/throttle.ts pour les seuils et la raison de leur écart.
 */
const parCompte = new Throttle(SEUILS_COMPTE);
const parAdresse = new Throttle(SEUILS_ADRESSE);

/** Le flux ICS, servi sans session : borné pour ne pas devenir un robinet. */
const icsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes sur le flux de calendrier.' },
});

interface AuthedRequest extends Request {
  user?: { id: number; email: string; tv: number; iat?: number; exp?: number };
}

function sign(user: { id: number; email: string; token_version: number }): string {
  // La durée est un réglage du foyer, lue à chaque connexion : la changer ne
  // touche pas aux sessions déjà ouvertes, qui gardent la durée qu'on leur a
  // donnée. C'est à la connexion suivante que la nouvelle valeur s'applique.
  const jours = Number(effectiveSetting('sessionDays')) || 30;
  return jwt.sign({ id: user.id, email: user.email, tv: user.token_version }, JWT_SECRET, { expiresIn: `${jours}d` });
}

/**
 * Ce jeton a-t-il passé la moitié de sa vie ?
 *
 * On ne renouvelle pas à chaque appel : un jeton neuf toutes les cinq secondes
 * ferait tourner l'écriture du stockage du navigateur pour rien. La moitié est
 * le compromis habituel, et il garantit qu'une session active ne se termine
 * jamais par une déconnexion surprise.
 */
function aRenouveler(u: { iat?: number; exp?: number } | undefined, now = Date.now()): boolean {
  if (!u?.iat || !u?.exp || u.exp <= u.iat) return false;
  return now / 1000 > u.iat + (u.exp - u.iat) / 2;
}

/** Longueur minimale exigée d'un mot de passe, et le message qui va avec. */
const pwdMin = (): number => Number(effectiveSetting('passwordMinLength')) || 6;
const pwdTropCourt = (): string => `Le mot de passe doit faire au moins ${pwdMin()} caractères`;

function auth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Non authentifié' });
    return;
  }
  let payload: { id: number; email: string; tv?: number; iat?: number; exp?: number };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { id: number; email: string; tv?: number; iat?: number; exp?: number };
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
  req.user = { id: user.id, email: user.email, tv: user.token_version, iat: payload.iat, exp: payload.exp };
  next();
}

/** The household member linked to the authenticated user (or null). */
function currentMember(req: AuthedRequest): HouseholdState['members'][number] | null {
  if (!req.user) return null;
  const u = getUserById(req.user.id);
  if (!u || !u.member_id) return null;
  const state = getHousehold().state as HouseholdState;
  return state.members.find((m) => m.id === u.member_id) || null;
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
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
function requireMember(req: AuthedRequest, res: Response, next: NextFunction): void {
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
function requireAdulte(req: AuthedRequest, res: Response, next: NextFunction): void {
  const m = currentMember(req);
  if (!m) { requireMember(req, res, next); return; }
  if (m.enfant) {
    res.status(403).json({ error: 'Ce module n’est pas accessible depuis un compte enfant.' });
    return;
  }
  next();
}

const api = express.Router();

api.get('/health', (_req, res) => res.json({ ok: true }));

// ---- First-run setup (onboarding) ----
api.get('/setup/status', (_req, res) => {
  res.json({ needsSetup: countUsers() === 0 });
});

api.post('/setup', authLimiter, route(async (req, res) => {
  if (countUsers() > 0) {
    res.status(409).json({ error: 'La configuration a déjà été effectuée' });
    return;
  }
  const { household, admin, members } = req.body || {};
  if (!household?.name?.trim()) { res.status(400).json({ error: 'Le nom du foyer est requis' }); return; }
  if (!admin?.name?.trim()) { res.status(400).json({ error: 'Votre prénom est requis' }); return; }
  if (!admin?.email?.trim() || !EMAIL_RE.test(String(admin.email).trim())) { res.status(400).json({ error: 'Email administrateur invalide' }); return; }
  if (String(admin.password || '').length < pwdMin()) { res.status(400).json({ error: pwdTropCourt() }); return; }

  // Normalise members (drop nameless entries) and validate optional per-member credentials.
  const rawMembers = Array.isArray(members) ? members : [];
  const normMembers = rawMembers
    .filter((m: { name?: string }) => (m?.name || '').trim())
    .map((m: { name: string; role?: string; color?: string; email?: string; password?: string; birthday?: string | null }, i: number) => ({
      id: 'm' + (i + 1),
      name: String(m.name).trim(),
      role: (m.role || '').trim(),
      color: m.color || '#4E93B8',
      birthday: m.birthday || null,
      email: (m.email || '').trim(),
      password: m.password || '',
    }));

  for (const m of normMembers) {
    const hasEmail = !!m.email;
    const hasPwd = !!m.password;
    if (hasEmail !== hasPwd) { res.status(400).json({ error: `Membre « ${m.name} » : renseignez email ET mot de passe, ou aucun des deux` }); return; }
    if (hasEmail && !EMAIL_RE.test(m.email)) { res.status(400).json({ error: `Email invalide pour « ${m.name} »` }); return; }
    if (hasPwd && m.password.length < pwdMin()) { res.status(400).json({ error: `Mot de passe de « ${m.name} » : ${pwdMin()} caractères minimum` }); return; }
  }

  // Every login email must be unique (across admin + members) and not already taken.
  const logins = [String(admin.email).trim(), ...normMembers.filter((m) => m.email).map((m) => m.email)].map((e) => e.toLowerCase());
  if (new Set(logins).size !== logins.length) { res.status(400).json({ error: 'Deux comptes utilisent le même email' }); return; }
  for (const e of logins) { if (findUserByEmail(e)) { res.status(409).json({ error: `Un compte existe déjà avec l'email ${e}` }); return; } }

  const state = buildInitialState({
    household: { name: household.name, theme: household.theme, academie: household.academie },
    admin: { name: admin.name, role: admin.role, color: admin.color, email: admin.email, birthday: admin.birthday || null },
    members: normMembers.map((m) => ({ id: m.id, name: m.name, role: m.role, color: m.color, birthday: m.birthday, email: m.email || undefined })),
  });

  const adminUser = createUserWithMember(String(admin.email), await hacher(String(admin.password)), String(admin.name).trim(), state.members[0].id);
  for (const m of normMembers) {
    if (m.email && m.password) createUserWithMember(m.email, await hacher(m.password), m.name, m.id);
  }
  saveHousehold(state);
  res.status(201).json({ token: sign(adminUser), user: { email: adminUser.email, name: adminUser.name, memberId: adminUser.member_id } });
}));

api.post('/auth/login', authLimiter, route(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email et mot de passe requis' });
    return;
  }
  const cible = String(email).trim().toLowerCase();
  const adresse = req.ip || 'inconnue';
  const now = Date.now();

  // Le compte visé d'abord : c'est lui qu'un bourrage distribué garde constant
  // pendant qu'il change d'adresse.
  const attente = Math.max(parCompte.attente(cible, now), parAdresse.attente(adresse, now));
  if (attente > 0) {
    log.attention(`Connexion refusée (temporisation, ${Math.ceil(attente / 1000)} s) pour ${cible} depuis ${adresse}.`);
    res.status(429).set('Retry-After', String(Math.ceil(attente / 1000))).json({ error: messageAttente(attente) });
    return;
  }

  const user = findUserByEmail(cible);
  // Le compte inconnu paie la même vérification que le compte connu : sans cela
  // le chronomètre dit lequel des deux existe. Voir HASH_LEURRE.
  const bon = await verifier(String(password), user ? user.password_hash : await hashLeurre());
  if (!user || !bon) {
    parCompte.echec(cible, now);
    parAdresse.echec(adresse, now);
    log.attention(`Connexion refusée pour ${cible} depuis ${adresse}.`);
    res.status(401).json({ error: 'Identifiants invalides' });
    return;
  }
  parCompte.succes(cible);
  parAdresse.succes(adresse);
  // Seul instant où le mot de passe en clair est disponible : on en profite pour
  // refaire un condensat trop faible. Personne n'a rien à faire, et le parc se
  // met à niveau au fil des connexions. La version du jeton ne bouge pas.
  if (aRehacher(user.password_hash)) {
    try { setPasswordHash(user.id, await hacher(String(password))); log.info(`Compte : condensat de ${user.email} remis au coût courant.`); }
    catch (e) { log.attention('Compte : remise à niveau du condensat impossible', e); }
  }
  log.info(`Connexion réussie : ${user.email} depuis ${adresse}.`);
  res.json({ token: sign(user), user: { email: user.email, name: user.name, memberId: user.member_id } });
}));

// Il n'y a pas d'inscription libre : un accès s'ouvre depuis la fiche d'un
// membre (`POST /members/:memberId/account`, réservé à un administrateur), ce qui
// rattache le compte à quelqu'un du foyer. Un formulaire d'inscription public
// n'aurait produit que des comptes sans membre, c'est-à-dire sans accès à quoi
// que ce soit, tout en offrant à Internet une route de création de comptes.

api.get('/state', auth, requireMember, (_req, res) => {
  res.json(getHousehold());
});

api.put('/state', auth, requireMember, (req: AuthedRequest, res: Response) => {
  // La charpente est vérifiée avant tout le reste, et le refus nomme le champ :
  // sans cela, un tableau remplacé par un nombre s'enregistrait sans un mot et
  // rendait l'écran illisible pour toute la famille. Voir state/validate.ts.
  try {
    validateState(req.body?.state);
  } catch (e) {
    if (e instanceof StateInvalide) {
      log.attention(`État refusé (${req.user?.email || 'compte inconnu'}) : ${e.message}`);
      res.status(400).json({ error: 'Enregistrement refusé : ' + e.message });
      return;
    }
    throw e;
  }
  const state = req.body.state as HouseholdState;

  // Écriture concurrente : le client annonce la version sur laquelle il a
  // travaillé, et n'écrit pas par-dessus plus récent que lui. Voir
  // state/concurrency.ts pour ce que ce refus évite de perdre.
  const currentState = getHousehold();
  if (!isUpToDate(req.body?.version, currentState.version)) {
    res.status(409).json(conflictOf(currentState));
    return;
  }

  // Les réglages ne s'écrivent plus par ici : ils passent par PATCH
  // /api/settings, clé par clé et sous contrôle de portée. Ce qu'un client
  // envoie dans `settings` et `prefs` est donc ignoré, quel que soit son rôle,
  // ce qui ferme la porte que masquer un onglet laissait grande ouverte.
  const me = currentMember(req);
  const avant = currentState.state as HouseholdState;
  if (!me?.admin && settingsChanged(avant.settings, state.settings)) {
    res.status(403).json({ error: 'Seul un administrateur du foyer peut modifier les réglages.' });
    return;
  }
  // Les préférences d'un autre membre ne se modifient pas, même par un
  // administrateur : c'est le pendant de la règle sur la fiche de membre. Un
  // enfant, lui, n'en écrit aucune, pas même les siennes.
  if (me?.enfant && foreignPrefsChanged(avant.prefs, state.prefs, null)) {
    res.status(403).json({ error: 'Les réglages du foyer ne sont pas accessibles depuis ce compte.' });
    return;
  }
  if (foreignPrefsChanged(avant.prefs, state.prefs, me?.id ?? null)) {
    res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres préférences.' });
    return;
  }
  state.settings = avant.settings;
  state.prefs = avant.prefs;

  // Non-admins may edit shared household data, but must not tamper with the member
  // roster: no adding/removing members, no changing anyone's admin flag, and no
  // editing a member other than themselves (which would include self-promotion).
  if (!me?.admin) {
    const current = avant.members || [];
    const next = Array.isArray(state.members) ? state.members : [];
    const byId = (arr: HouseholdState['members']): Map<string, HouseholdState['members'][number]> =>
      new Map(arr.map((m) => [m.id, m]));
    const curMap = byId(current);
    const nextMap = byId(next);

    const sameRoster = current.length === next.length && current.every((m) => nextMap.has(m.id));
    if (!sameRoster) {
      res.status(403).json({ error: 'Seul un administrateur peut ajouter ou retirer un membre' });
      return;
    }
    for (const m of next) {
      const before = curMap.get(m.id)!;
      if (!!before.admin !== !!m.admin) {
        res.status(403).json({ error: 'Seul un administrateur peut modifier les droits d’administration' });
        return;
      }
      // A non-admin may only alter their own member entry.
      if (m.id !== me?.id && JSON.stringify(before) !== JSON.stringify(m)) {
        res.status(403).json({ error: 'Vous ne pouvez modifier que votre propre profil de membre' });
        return;
      }
    }
  }

  // The shopping list never travels in a whole-document save: whatever this
  // client believes about it is discarded in favour of what the server holds.
  // That is what makes an overwrite structurally impossible, however stale the
  // client is. Aisles and lists, on the other hand, ARE edited here, so their
  // consequences for the items are applied server-side.
  const kept = preserveShopping(state as unknown as Record<string, unknown>);
  if (kept.movedToFallback || kept.dropped) {
    log.info(
      `Courses : ${kept.movedToFallback} article(s) déplacé(s) vers « À trier » ` +
      `et ${kept.dropped} retiré(s) avec leur liste, à la suite d'une édition des rayons ou des listes.`,
    );
  }

  // Same rule for the tasks: written op by op, never by whole-document PUT.
  const tasks = preserveTasks(state as unknown as Record<string, unknown>);
  if (tasks.dropped || tasks.unassigned || tasks.unlinked || tasks.orphaned) {
    log.info(
      `Tâches : ${tasks.dropped} tâche(s) retirée(s) avec leur liste, ${tasks.unassigned} affectation(s) ` +
      `à un membre disparu retirée(s), ${tasks.unlinked} lien(s) vers une liste de courses ou un document disparus retiré(s), ` +
      `${tasks.orphaned} sous-tâche(s) remontée(s) au premier niveau.`,
    );
  }

  const result = saveHousehold(state);
  res.json(result);
});

/**
 * Instantané des sous-arbres qui s'écrivent par opérations : courses et tâches.
 * `since` évite de les renvoyer quand rien n'a bougé : les écrans sondent toutes
 * les cinq secondes tant qu'ils sont visibles, autant que la réponse tienne en
 * trois lignes le reste du temps.
 */
api.get('/live', auth, requireMember, (req: Request, res: Response) => {
  const shop = getShopping();
  const since = parseInt(String(req.query['since'] ?? ''), 10);
  if (Number.isInteger(since) && since === shop.version) {
    res.json({ version: shop.version, unchanged: true });
    return;
  }
  res.json({ version: shop.version, shop: shop.items, tasks: getTasks().items });
});

// ---- Current user ----
api.get('/me', auth, (req: AuthedRequest, res: Response) => {
  const u = req.user ? getUserById(req.user.id) : undefined;
  if (!u) { res.status(401).json({ error: 'Non authentifié' }); return; }
  // L'identifiant du membre vient de la fiche telle qu'elle existe, pas de la
  // colonne : un membre retiré du foyer laisse son compte derrière lui, et
  // renvoyer l'identifiant d'une fiche disparue ferait pointer l'application sur
  // un fantôme. Rien plutôt qu'un mensonge, et l'écran sait alors quoi dire.
  const m = currentMember(req);
  res.json({
    email: u.email, name: u.name, memberId: m?.id ?? null, admin: !!m?.admin, enfant: !!m?.enfant,
    // Un jeton émis vivait sa durée entière sans jamais tourner : volé le
    // premier jour, il servait encore le dernier. Passé la moitié de sa vie, on
    // en rend un neuf, que le client range à la place. Rien à faire pour
    // l'utilisateur, et la fenêtre d'un jeton dérobé se referme d'elle-même.
    ...(aRenouveler(req.user) ? { token: sign(u) } : {}),
  });
});

/**
 * Ses propres identifiants, changés par soi-même.
 *
 * Les routes `/members/:id/account` sont réservées à un administrateur : elles
 * servent à ouvrir un accès à quelqu'un d'autre. Ici, chacun change son adresse
 * et son mot de passe sans passer par personne, mais **en redonnant son mot de
 * passe actuel** : sans cela, un téléphone déverrouillé laissé sur la table
 * suffirait à s'approprier le compte.
 *
 * Changer le mot de passe incrémente `token_version`, donc **déconnecte les
 * autres sessions** : c'est le but. La session en cours, elle, reçoit un jeton
 * neuf, sinon on se déconnecterait soi-même en se protégeant.
 */
api.put('/me/credentials', authLimiter, auth, route(async (req, res) => {
  const user = req.user ? getUserById(req.user.id) : undefined;
  if (!user) { res.status(401).json({ error: 'Non authentifié' }); return; }
  if (!await verifier(String(req.body?.currentPassword ?? ''), user.password_hash)) {
    res.status(403).json({ error: 'Mot de passe actuel incorrect' });
    return;
  }
  let email: string | undefined;
  let password: string | undefined;
  const rawEmail = req.body?.email;
  if (rawEmail !== undefined && String(rawEmail).trim().toLowerCase() !== user.email) {
    email = String(rawEmail).trim();
    if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'Email invalide' }); return; }
    if (findUserByEmail(email)) { res.status(409).json({ error: 'Cet email est déjà utilisé' }); return; }
  }
  const rawPassword = req.body?.password;
  if (rawPassword !== undefined && String(rawPassword) !== '') {
    password = String(rawPassword);
    if (password.length < pwdMin()) { res.status(400).json({ error: pwdTropCourt() }); return; }
    if (password === String(req.body?.currentPassword ?? '')) {
      res.status(400).json({ error: 'Le nouveau mot de passe est identique à l’ancien' });
      return;
    }
  }
  if (email === undefined && password === undefined) { res.status(400).json({ error: 'Rien à mettre à jour' }); return; }
  updateUserCredentials(user.id, email, password === undefined ? undefined : await hacher(password));
  const frais = getUserById(user.id);
  if (!frais) { res.status(500).json({ error: 'Compte introuvable après modification' }); return; }
  log.info(`Compte : ${user.email} (depuis ${req.ip || 'adresse inconnue'}) a changé ${email && password ? 'son adresse et son mot de passe' : email ? 'son adresse de connexion' : 'son mot de passe'}.`);
  res.json({ email: frais.email, token: sign(frais), othersLoggedOut: password !== undefined });
}));

// ---- Member login accounts (admin-managed) ----
// Réservée à un administrateur : cette liste est l'inventaire exact des
// identifiants à attaquer, et les adresses personnelles de la famille avec.
// L'écran qui s'en sert est déjà celui de la gestion des accès.
api.get('/members/accounts', auth, requireAdmin, (_req, res) => {
  res.json({ accounts: listMemberAccounts() });
});

api.post('/members/:memberId/account', auth, requireAdmin, route(async (req, res) => {
  const memberId = req.params.memberId;
  const state = getHousehold().state as HouseholdState;
  const member = state.members.find((m) => m.id === memberId);
  if (!member) { res.status(404).json({ error: 'Membre introuvable (enregistrez-le d’abord)' }); return; }
  if (getUserByMemberId(memberId)) { res.status(409).json({ error: 'Ce membre a déjà un accès' }); return; }
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'Email invalide' }); return; }
  if (password.length < pwdMin()) { res.status(400).json({ error: `Mot de passe : ${pwdMin()} caractères minimum` }); return; }
  if (findUserByEmail(email)) { res.status(409).json({ error: 'Cet email est déjà utilisé' }); return; }
  createUserWithMember(email, await hacher(password), member.name, memberId);
  res.status(201).json({ memberId, email: email.toLowerCase() });
}));

api.put('/members/:memberId/account', auth, requireAdmin, route(async (req, res) => {
  const memberId = req.params.memberId;
  const user = getUserByMemberId(memberId);
  if (!user) { res.status(404).json({ error: 'Ce membre n’a pas d’accès' }); return; }
  const rawEmail = req.body?.email;
  const rawPassword = req.body?.password;
  let email: string | undefined;
  let password: string | undefined;
  if (rawEmail !== undefined && String(rawEmail).trim() !== user.email) {
    email = String(rawEmail).trim();
    if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'Email invalide' }); return; }
    if (findUserByEmail(email)) { res.status(409).json({ error: 'Cet email est déjà utilisé' }); return; }
  }
  if (rawPassword !== undefined && String(rawPassword) !== '') {
    password = String(rawPassword);
    if (password.length < pwdMin()) { res.status(400).json({ error: `Mot de passe : ${pwdMin()} caractères minimum` }); return; }
  }
  if (email === undefined && password === undefined) { res.status(400).json({ error: 'Rien à mettre à jour' }); return; }
  updateUserCredentials(user.id, email, password === undefined ? undefined : await hacher(password));
  res.json({ memberId, email: (email ?? user.email).toLowerCase() });
}));

api.delete('/members/:memberId/account', auth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const memberId = req.params.memberId;
  const user = getUserByMemberId(memberId);
  if (!user) { res.status(404).json({ error: 'Ce membre n’a pas d’accès' }); return; }
  if (req.user && user.id === req.user.id) { res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre accès' }); return; }
  deleteUser(user.id);
  res.json({ ok: true });
});

// ---- Finances (relational tables, granular operations) ----
// Kept out of /api/state on purpose: thousands of transactions must not be
// reloaded and rewritten every time another module saves.
api.use('/finances', auth, requireAdulte, financesRouter(requireAdmin));

// Réglages du foyer : déclarés dans settings/registry.ts, écrits clé par clé
// plutôt que par enregistrement du document entier, pour que deux
// administrateurs qui règlent deux choses ne s'écrasent pas.
api.use('/settings', auth, requireMember, settingsRouter({
  memberId: (req) => currentMember(req as AuthedRequest)?.id ?? null,
  isAdmin: (req) => !!currentMember(req as AuthedRequest)?.admin,
  isChild: (req) => !!currentMember(req as AuthedRequest)?.enfant,
  overrides: () => envOverrides(),
  deployment: () => deploymentView(),
  appVersion: currentVersion,
}));

// Recipe photos and other household files: bytes on disk, never in the state
// document (a data-URL there was re-sent in full on every single save).
api.use('/files', auth, requireMember, filesRouter(
  () => Number(effectiveSetting('maxUploadMb')) * 1024 * 1024,
  (req) => !!currentMember(req as AuthedRequest)?.enfant,
));

// The shopping list writes item by item rather than by whole-document PUT.
// See shopping/ops.ts for why: two phones ticking at once is the common case.
api.use('/shopping', auth, requireMember, shoppingRouter());

// Tâches : même dispositif, même raison. Voir tasks/ops.ts.
api.use('/tasks', auth, requireMember, tasksRouter());

// Rappels par Web Push : abonnement des appareils, état, test. Voir notify/push.ts.
//
// L'adresse ouverte au tap vient du réglage « Adresse publique de Foyer », que
// `FOYER_PUBLIC_URL` verrouille. Vide, c'est le navigateur qui décide, avec
// l'adresse par laquelle il s'était abonné : elle échoue depuis l'extérieur
// quand c'était une adresse locale, d'où l'intérêt de pouvoir la poser sans
// éditer un fichier sur le serveur.
const appUrl = (): string => String(effectiveSetting('publicUrl') || '');
api.use('/push', auth, requireMember, pushRouter((req) => currentMember(req as AuthedRequest)?.id ?? null, appUrl));

// La seule sortie réseau du module Cuisine : l'import d'une recette depuis une
// URL, déclenché par l'utilisateur, journalisé, coupable par FOYER_RECIPE_IMPORT.
api.use('/recipes', auth, requireMember, recipesRouter(() => effectiveSetting('recipeImport') === true));

// ---- School holidays (official FR data, cached) ----
interface SchoolHoliday { name: string; start: string; end: string; zone: string; }
const HOLIDAYS_TTL = 7 * 24 * 3600 * 1000;

async function fetchSchoolHolidays(academie: string): Promise<SchoolHoliday[]> {
  const where = encodeURIComponent(`location="${academie}"`);
  const url = `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?where=${where}&limit=100&order_by=start_date`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = (await res.json()) as { results?: Record<string, string>[] };
  const seen = new Set<string>();
  const out: SchoolHoliday[] = [];
  for (const r of json.results || []) {
    const pop = (r['population'] || '').toLowerCase();
    if (pop && pop !== '-' && !pop.includes('lève') && !pop.includes('eleve')) continue; // pupils / unspecified only
    const name = r['description'] || 'Vacances';
    const start = (r['start_date'] || '').slice(0, 10);
    const end = (r['end_date'] || '').slice(0, 10);
    if (!start || !end) continue;
    const key = name + start + end;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, start, end, zone: r['zones'] || '' });
  }
  return out;
}

/**
 * Les règles de contexte de l'accueil, telles qu'elles s'appliquent réellement.
 *
 * Relues à chaque appel : le fichier fait quelques kilo-octets, et pouvoir le
 * modifier puis recharger la page sans redémarrer le service est précisément ce
 * qu'on attend d'un réglage tenu dans un fichier.
 */
api.get('/home/rules', auth, requireMember, (_req, res) => {
  const outcome = loadRules(DATA_DIR);
  if (outcome.errors.length) {
    log.attention(`accueil : ${rulesPath(DATA_DIR)} ignoré, règles par défaut appliquées : ${outcome.errors.join(' | ')}`);
  }
  res.json(outcome);
});

api.get('/calendar/school-holidays', auth, requireMember, async (req: Request, res: Response) => {
  const academie = String(req.query['academie'] || '').trim();
  if (!academie) { res.json({ holidays: [], academie: '' }); return; }
  const cache = getSchoolHolidaysCache(academie);
  if (cache && Date.now() - cache.fetchedAt < HOLIDAYS_TTL) { res.json({ holidays: cache.data, academie, cached: true }); return; }
  try {
    const holidays = await fetchSchoolHolidays(academie);
    setSchoolHolidaysCache(academie, holidays, Date.now());
    res.json({ holidays, academie });
  } catch {
    if (cache) { res.json({ holidays: cache.data, academie, stale: true }); return; }
    res.json({ holidays: [], academie, error: 'Service de vacances scolaires indisponible' });
  }
});

// Le jeton donne un accès permanent et SANS authentification à tout le
// calendrier du foyer, horaires des enfants compris, et il survit à la
// suppression du compte qui l'a lu. Le lire, comme le créer, est un geste
// d'administration : c'est le canal d'exfiltration le plus discret de
// l'application.
api.get('/calendar/ics', auth, requireAdmin, (_req, res) => {
  let token = getIcsToken();
  if (!token) { token = crypto.randomBytes(18).toString('hex'); setIcsToken(token); }
  res.json({ token });
});

api.post('/calendar/ics/regenerate', auth, requireAdmin, (_req, res) => {
  const token = crypto.randomBytes(18).toString('hex');
  setIcsToken(token);
  res.json({ token });
});

// Public — consumed by external calendar apps (Google/Apple), so no auth; the token is the secret.
// Un agenda relit ce flux quelques fois par heure ; personne n'a de raison d'en
// demander cent. La limite ne rend pas le jeton devinable (144 bits, il ne
// l'était pas), elle empêche d'en faire un robinet.
api.get('/calendar/feed.ics', icsLimiter, (req: Request, res: Response) => {
  const token = String(req.query['token'] || '');
  const state = getStateByIcsToken(token) as HouseholdState | null;
  if (!state) { res.status(404).type('text/plain').send('Calendrier introuvable'); return; }
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="foyer.ics"');
  res.send(buildIcs(state, contractDeadlines(new Date().toISOString().slice(0, 10), DEADLINE_HORIZON_DAYS)));
});

// ---- System / self-update ----
api.get('/system/version', auth, requireMember, (_req, res) => {
  res.json({ current: currentVersion(), selfUpdate: selfUpdateEnabled(), repo: GITHUB_REPO });
});

api.get('/system/update-check', auth, requireMember, async (_req, res) => {
  const current = currentVersion();
  try {
    const rel = await fetchLatestRelease();
    const latest = rel.tag.replace(/^v/, '');
    res.json({
      current, latest, latestTag: rel.tag, name: rel.name,
      notes: rel.body.slice(0, 2000), url: rel.url, publishedAt: rel.publishedAt,
      updateAvailable: semverCmp(latest, current) > 0,
      selfUpdate: selfUpdateEnabled(),
    });
  } catch (e) {
    res.json({ current, error: 'Vérification impossible : ' + (e as Error).message, selfUpdate: selfUpdateEnabled() });
  }
});

// Trigger a self-update. The backend only drops a trigger file; a root-owned
// systemd path unit (installed when FOYER_SELF_UPDATE=1) performs the actual
// download/build/restart, so the service keeps its hardening (no sudo).
api.post('/system/update', auth, requireAdmin, route(async (req, res) => {
  if (!selfUpdateEnabled()) {
    res.status(400).json({ error: 'Mise à jour automatique non activée sur ce serveur. Lancez « deploy/lxc/update.sh » manuellement.' });
    return;
  }
  // Le mot de passe, redemandé ici et nulle part ailleurs.
  //
  // Ce bouton fait exécuter du code en root sur la machine : le service dépose
  // un fichier, une unité systemd root télécharge la dernière version et la
  // compile. Le dispositif est bien conçu (le service ne détient aucun droit
  // supplémentaire), mais il fait de « compte administrateur volé » un
  // « root sur l'hyperviseur invité ». Un jeton dérobé sur un téléphone
  // déverrouillé ne doit pas suffire : il faut aussi savoir le mot de passe.
  const moi = req.user ? getUserById(req.user.id) : undefined;
  if (!moi || !await verifier(String(req.body?.password ?? ''), moi.password_hash)) {
    log.attention(`Mise à jour refusée : mot de passe incorrect (${req.user?.email || 'compte inconnu'}, depuis ${req.ip}).`);
    res.status(403).json({ error: 'Mot de passe incorrect. Cette mise à jour installe et exécute du code sur le serveur : elle se confirme par votre mot de passe.' });
    return;
  }
  log.info(`Mise à jour lancée par ${moi.email} depuis ${req.ip}.`);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'update-status.json'), JSON.stringify({ state: 'running', message: 'Mise à jour lancée…', ts: Date.now() }));
    fs.writeFileSync(path.join(DATA_DIR, '.update-trigger'), String(Date.now()));
    res.json({ started: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}));

/**
 * L'état du service : version, place restante, poids des données, sauvegardes.
 * Réservé aux administrateurs : c'est de l'exploitation, et le chemin des
 * données n'a pas à circuler plus loin que nécessaire.
 */
api.get('/system/status', auth, requireAdmin, (_req, res) => {
  const state = getHousehold().state as HouseholdState;
  res.json(buildStatus({
    version: currentVersion(),
    dataDir: DATA_DIR,
    pushSubject: resolveVapidSubject({ env: process.env.FOYER_VAPID_SUBJECT, publicUrl: String(effectiveSetting('publicUrl') || '') }).subject,
    dbPath: process.env.FOYER_DB_PATH || path.join(DATA_DIR, 'foyer.db'),
    counts: {
      members: (state.members || []).length,
      events: (state.events || []).length,
      tasks: (state.tasks || []).length,
      recipes: (state.recipes || []).length,
      files: (state.files || []).length,
    },
  }));
});

/**
 * Un instantané cohérent de la base, sans arrêter le service (VACUUM INTO).
 * Il n'emporte ni les fichiers ni les photos : l'écran le dit et donne la
 * commande d'archive complète.
 */
api.post('/system/backup', auth, requireAdmin, (req: AuthedRequest, res: Response) => {
  try {
    const keep = Number(effectiveSetting('backupKeep')) || 7;
    const out = makeSnapshot(db, DATA_DIR, keep);
    log.info(`Sauvegarde : ${out.snapshot.name} (${Math.round(out.snapshot.bytes / 1024)} Ko) écrite par ${currentMember(req)?.id || '(membre inconnu)'}`
      + (out.deleted.length ? `, ${out.deleted.length} ancienne(s) effacée(s)` : '') + '.');
    res.json(out);
  } catch (e) {
    if (e instanceof BackupRefused) { res.status(409).json({ error: e.message }); return; }
    log.erreur('Sauvegarde impossible', e);
    res.status(500).json({ error: 'Sauvegarde impossible : ' + (e as Error).message });
  }
});

api.get('/system/backup/:name', auth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const p = snapshotPath(DATA_DIR, String(req.params.name));
  if (!p) { res.status(404).json({ error: 'Sauvegarde introuvable.' }); return; }
  // Une base entière quitte la machine : c'est le genre de geste qu'on veut
  // pouvoir dater après coup, pas reconstituer de mémoire.
  log.info(`Sauvegarde ${req.params.name} téléchargée par ${req.user?.email || '(compte inconnu)'}.`);
  res.download(p);
});

api.delete('/system/backup/:name', auth, requireAdmin, (req: Request, res: Response) => {
  if (!removeSnapshot(DATA_DIR, String(req.params.name))) { res.status(404).json({ error: 'Sauvegarde introuvable.' }); return; }
  log.info(`Sauvegarde ${req.params.name} effacée.`);
  res.json({ ok: true });
});

api.get('/system/update-status', auth, requireMember, (_req, res) => {
  try {
    const p = path.join(DATA_DIR, 'update-status.json');
    if (fs.existsSync(p)) {
      // Une mise à jour interrompue laissait ce fichier sur « running » pour
      // toujours, et l'interface bloquée sur « Mise à jour en cours… », sans
      // aucun bouton. Voir update-status.ts.
      const status = freshStatus(JSON.parse(fs.readFileSync(p, 'utf-8')), Date.now(), path.join(DATA_DIR, 'update.log'));
      res.json({ ...status, current: currentVersion() });
      return;
    }
  } catch { /* fichier illisible : on repart d'un état neutre plutôt que de bloquer */ }
  res.json({ state: 'idle', current: currentVersion() });
});

app.use('/api', api);

// ---- Static frontend (single-container deployment) ----
if (fs.existsSync(STATIC_DIR)) {
  // `index: false` laisse la route ci-dessous servir index.html, pour que la
  // racine et une adresse profonde reçoivent exactement les mêmes en-têtes.
  app.use(express.static(STATIC_DIR, {
    index: false,
    setHeaders: (res, filePath) => res.setHeader('Cache-Control', cacheControlFor(filePath)),
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    // Une adresse qui ressemble à un fichier et qui n'existe pas est une
    // absence, pas une route de l'application. Répondre index.html avec un 200
    // faisait conclure à un scanner que /.git/config, /.env et /wp-login.php
    // existaient tous : rien ne fuyait, mais les journaux du proxy devenaient
    // illisibles et chaque sonde repartait avec une réponse encourageante.
    const segments = req.path.split('/').filter(Boolean);
    const dernier = segments[segments.length - 1] ?? '';
    // Un segment caché (« /.git/config ») compte autant qu'une extension au
    // bout : c'est le répertoire qui porte le point, et c'est le chemin que
    // sondent le plus les robots.
    if (dernier.includes('.') || segments.some((seg) => seg.startsWith('.'))) {
      res.status(404).type('text/plain').send('Introuvable');
      return;
    }
    // Jamais de cache sur le document : c'est lui qui nomme les fichiers de
    // l'application, donc le garder revient à garder la version d'avant.
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });
}

export { app, auth, requireAdmin, requireMember };

/**
 * Ce que le service fait en plus de répondre : les rappels et l'écoute réseau.
 *
 * Séparé du montage des routes pour une raison précise : les tests de sécurité
 * doivent pouvoir monter **les vraies routes, avec leurs vrais gardes**, sans
 * ouvrir de port ni démarrer un planificateur qui enverrait des notifications
 * pendant la CI. Un garde éprouvé sur une application reconstruite pour le test
 * n'éprouve que la copie.
 */
export function start(): void {
  // ---- Rappels : clés VAPID, affectations, planificateur ----
  // Les clés sont générées une fois et gardées en base : en changer invaliderait
  // tous les abonnements. FOYER_VAPID_PUBLIC / FOYER_VAPID_PRIVATE les remplacent.
  const vapid = initPush(
    db,
    { publicKey: process.env.FOYER_VAPID_PUBLIC, privateKey: process.env.FOYER_VAPID_PRIVATE, subject: process.env.FOYER_VAPID_SUBJECT },
    () => String(effectiveSetting('publicUrl') || ''),
  );
  log.info(`Notifications : Web Push prêt (${vapid.generated ? 'clés VAPID générées et gardées en base' : 'clés VAPID existantes'}), `
    + `contact déclaré aux services push : ${vapid.subject.subject}`);
  if (vapid.subject.rejected) {
    // Le dire au démarrage, pas au premier rappel raté : un refus d'Apple se
    // présente comme un « HTTP 403 » et n'apprend rien à qui le lit.
    log.attention(`Notifications : le contact « ${vapid.subject.rejected.value} » a été écarté (${vapid.subject.rejected.reason}). `
      + `Posez FOYER_VAPID_SUBJECT, ou renseignez l’adresse publique du foyer dans Paramètres, section « Notifications ».`);
  }

  const notifLog = (line: string): void => log.info(line);

  /**
   * Ce membre veut-il ce genre de rappel sur son téléphone ?
   *
   * La préférence est personnelle : chacun coupe les siennes sans rien imposer
   * aux autres. Le foyer, lui, peut tout suspendre d'un geste (`pushPaused`).
   */
  const memberWants = (memberId: string, kind: 'reminder' | 'assigned'): boolean => {
    const state = getHousehold().state as HouseholdState;
    // Les deux clés sont écrites en toutes lettres : une clé calculée ne dit rien
    // au garde-fou de la CI, qui ne saurait plus si ces réglages servent.
    return kind === 'reminder'
      ? setting('pushReminders', state, memberId)
      : setting('pushAssigned', state, memberId);
  };

  // Quelqu'un d'autre vient de m'affecter une tâche : tout de suite, pas à la minute.
  onAssigned((memberId, task, opId) => {
    // Le foyer a suspendu les rappels, ou ce membre ne veut pas être prévenu des
    // affectations : rien ne part, et rien n'est noté comme manqué.
    if (effectiveSetting('pushPaused') === true || !memberWants(memberId, 'assigned')) return;
    const by = task.by ? (getHousehold().state as HouseholdState).members.find((m) => m.id === task.by)?.name : '';
    void notify(`assign|${opId}|${memberId}`, [memberId], {
      kind: 'assigned', title: task.text, body: (by ? by + ' vous a affecté cette tâche' : 'Une tâche vous a été affectée') + (task.due ? ' · ' + task.due.split('-').reverse().join('/') : ''),
      url: appUrl(), taskId: task.id, tag: 'task-' + task.id,
    }).then((r) => {
      const m = r.members[0];
      if (m && m.status !== 'skipped') notifLog(`Notifications : affectation « ${task.text} » → ${memberId} : ${m.status}${m.error ? ' (' + m.error + ')' : ''}`);
    }).catch((e) => notifLog('Notifications : affectation non envoyée : ' + (e as Error).message));
  });

  startScheduler({
    tasks: () => (getHousehold().state as HouseholdState).tasks || [],
    accounts: () => accountsOf().map((a) => a.memberId),
    url: appUrl,
    rules: () => ({
      paused: effectiveSetting('pushPaused') === true,
      quiet: { from: String(effectiveSetting('quietFrom')), to: String(effectiveSetting('quietTo')) },
    }),
    wants: memberWants,
    log: notifLog,
  });

  // Le dire au démarrage plutôt qu'au premier bourrage : cru sur une interface
  // ouverte, X-Forwarded-For rend la temporisation contournable par quiconque
  // joint le port directement.
  if (trustProxy !== false && BIND === '0.0.0.0') {
    log.attention(
      'Sécurité : le service écoute sur toutes les interfaces ET fait confiance à X-Forwarded-For. '
      + 'Quiconque joint le port directement peut donc se faire passer pour l’adresse de son choix, et contourner '
      + 'la temporisation des tentatives de connexion. Posez FOYER_BIND=127.0.0.1 si un proxy tourne sur la même '
      + 'machine, filtrez le port au pare-feu sinon, ou posez FOYER_TRUST_PROXY=false s’il n’y a aucun proxy devant.',
    );
  }

  app.listen(PORT, BIND, () => {
    log.info(`API + app disponibles sur http://${BIND}:${PORT}`);
  });
}

// Lancé comme service : on démarre. Importé par un test : on ne démarre pas.
if (require.main === module) start();
