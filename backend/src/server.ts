import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  bootstrap,
  countUsers,
  createUser,
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
  resetHousehold,
  saveHousehold,
  setIcsToken,
  setSchoolHolidaysCache,
  updateUserCredentials,
} from './db';
import { buildInitialState, HouseholdState } from './seed';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const DATA_DIR = process.env.FOYER_DATA_DIR || path.join(__dirname, '..', 'data');
const GITHUB_REPO = process.env.FOYER_GITHUB_REPO || 'PrudhommeWTF/Foyer-App';

const selfUpdateEnabled = (): boolean => /^(1|true|yes|on)$/i.test(process.env.FOYER_SELF_UPDATE || '');

function currentVersion(): string {
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
const ALLOW_SIGNUP = (process.env.FOYER_ALLOW_SIGNUP || 'true') !== 'false';
// The frontend uses a relative base href, so a single build works served at the
// root or behind a reverse proxy on a sub-path.
const STATIC_DIR = process.env.FOYER_STATIC_DIR || path.join(__dirname, '..', 'public');

bootstrap();

const app = express();

// Behind a reverse proxy (Caddy/Traefik/Nginx, Proxmox ingress…): trust the first
// hop so client IPs (rate-limiting) and protocol are read from X-Forwarded-* headers.
app.set('trust proxy', 1);

// Security headers. The frontend is a self-hosted SPA that inlines styles and loads
// Google fonts; images come as data:/blob: URLs. upgrade-insecure-requests is disabled
// so plain-HTTP LAN installs (e.g. http://10.x:8099) keep working.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
      'upgrade-insecure-requests': null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS: same-origin by default (the API serves its own SPA). Extra origins can be
// allow-listed via FOYER_CORS_ORIGINS (comma-separated) for split deployments.
const corsOrigins = (process.env.FOYER_CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : false, // false → no cross-origin; same-origin requests are unaffected
  credentials: true,
}));

app.use(express.json({ limit: '15mb' })); // documents/photos are stored as data URLs

// Throttle credential endpoints to blunt brute-force / account-enumeration attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez dans quelques minutes.' },
});

interface AuthedRequest extends Request {
  user?: { id: number; email: string; tv: number };
}

function sign(user: { id: number; email: string; token_version: number }): string {
  return jwt.sign({ id: user.id, email: user.email, tv: user.token_version }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Non authentifié' });
    return;
  }
  let payload: { id: number; email: string; tv?: number };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { id: number; email: string; tv?: number };
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
  req.user = { id: user.id, email: user.email, tv: user.token_version };
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

const api = express.Router();

api.get('/health', (_req, res) => res.json({ ok: true }));

// ---- First-run setup (onboarding) ----
api.get('/setup/status', (_req, res) => {
  res.json({ needsSetup: countUsers() === 0, allowSignup: ALLOW_SIGNUP });
});

api.post('/setup', authLimiter, (req: Request, res: Response) => {
  if (countUsers() > 0) {
    res.status(409).json({ error: 'La configuration a déjà été effectuée' });
    return;
  }
  const { household, admin, members } = req.body || {};
  if (!household?.name?.trim()) { res.status(400).json({ error: 'Le nom du foyer est requis' }); return; }
  if (!admin?.name?.trim()) { res.status(400).json({ error: 'Votre prénom est requis' }); return; }
  if (!admin?.email?.trim() || !EMAIL_RE.test(String(admin.email).trim())) { res.status(400).json({ error: 'Email administrateur invalide' }); return; }
  if (String(admin.password || '').length < 6) { res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères' }); return; }

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
    if (hasPwd && m.password.length < 6) { res.status(400).json({ error: `Mot de passe de « ${m.name} » : 6 caractères minimum` }); return; }
  }

  // Every login email must be unique (across admin + members) and not already taken.
  const logins = [String(admin.email).trim(), ...normMembers.filter((m) => m.email).map((m) => m.email)].map((e) => e.toLowerCase());
  if (new Set(logins).size !== logins.length) { res.status(400).json({ error: 'Deux comptes utilisent le même email' }); return; }
  for (const e of logins) { if (findUserByEmail(e)) { res.status(409).json({ error: `Un compte existe déjà avec l'email ${e}` }); return; } }

  const state = buildInitialState({
    household: { name: household.name, weekStart: household.weekStart, currency: household.currency, theme: household.theme, academie: household.academie },
    admin: { name: admin.name, role: admin.role, color: admin.color, email: admin.email, birthday: admin.birthday || null },
    members: normMembers.map((m) => ({ id: m.id, name: m.name, role: m.role, color: m.color, birthday: m.birthday, email: m.email || undefined })),
  });

  const adminUser = createUserWithMember(String(admin.email), String(admin.password), String(admin.name).trim(), state.members[0].id);
  for (const m of normMembers) {
    if (m.email && m.password) createUserWithMember(m.email, m.password, m.name, m.id);
  }
  saveHousehold(state);
  res.status(201).json({ token: sign(adminUser), user: { email: adminUser.email, name: adminUser.name, memberId: adminUser.member_id } });
});

api.post('/auth/login', authLimiter, (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email et mot de passe requis' });
    return;
  }
  const user = findUserByEmail(String(email));
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    res.status(401).json({ error: 'Identifiants invalides' });
    return;
  }
  res.json({ token: sign(user), user: { email: user.email, name: user.name, memberId: user.member_id } });
});

api.post('/auth/register', authLimiter, (req: Request, res: Response) => {
  if (!ALLOW_SIGNUP) {
    res.status(403).json({ error: 'Les inscriptions sont désactivées' });
    return;
  }
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email et mot de passe requis' });
    return;
  }
  if (findUserByEmail(String(email))) {
    res.status(409).json({ error: 'Un compte existe déjà avec cet email' });
    return;
  }
  const user = createUser(String(email), String(password), String(name || '').trim() || 'Membre');
  res.status(201).json({ token: sign(user), user: { email: user.email, name: user.name, memberId: user.member_id } });
});

api.get('/state', auth, (_req, res) => {
  res.json(getHousehold());
});

api.put('/state', auth, (req: AuthedRequest, res: Response) => {
  const state = req.body?.state as HouseholdState | undefined;
  if (state == null || typeof state !== 'object') {
    res.status(400).json({ error: 'État invalide' });
    return;
  }

  // Non-admins may edit shared household data, but must not tamper with the member
  // roster: no adding/removing members, no changing anyone's admin flag, and no
  // editing a member other than themselves (which would include self-promotion).
  const me = currentMember(req);
  if (!me?.admin) {
    const current = (getHousehold().state as HouseholdState).members || [];
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

  const result = saveHousehold(state);
  res.json(result);
});

api.post('/state/reset', auth, (_req, res) => {
  const result = resetHousehold();
  res.json({ ...getHousehold(), ...result });
});

// ---- Current user ----
api.get('/me', auth, (req: AuthedRequest, res: Response) => {
  const u = req.user ? getUserById(req.user.id) : undefined;
  if (!u) { res.status(401).json({ error: 'Non authentifié' }); return; }
  const m = currentMember(req);
  res.json({ email: u.email, name: u.name, memberId: u.member_id, admin: !!m?.admin });
});

// ---- Member login accounts (admin-managed) ----
api.get('/members/accounts', auth, (_req, res) => {
  res.json({ accounts: listMemberAccounts() });
});

api.post('/members/:memberId/account', auth, requireAdmin, (req: Request, res: Response) => {
  const memberId = req.params.memberId;
  const state = getHousehold().state as HouseholdState;
  const member = state.members.find((m) => m.id === memberId);
  if (!member) { res.status(404).json({ error: 'Membre introuvable (enregistrez-le d’abord)' }); return; }
  if (getUserByMemberId(memberId)) { res.status(409).json({ error: 'Ce membre a déjà un accès' }); return; }
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'Email invalide' }); return; }
  if (password.length < 6) { res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' }); return; }
  if (findUserByEmail(email)) { res.status(409).json({ error: 'Cet email est déjà utilisé' }); return; }
  createUserWithMember(email, password, member.name, memberId);
  res.status(201).json({ memberId, email: email.toLowerCase() });
});

api.put('/members/:memberId/account', auth, requireAdmin, (req: Request, res: Response) => {
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
    if (password.length < 6) { res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' }); return; }
  }
  if (email === undefined && password === undefined) { res.status(400).json({ error: 'Rien à mettre à jour' }); return; }
  updateUserCredentials(user.id, email, password);
  res.json({ memberId, email: (email ?? user.email).toLowerCase() });
});

api.delete('/members/:memberId/account', auth, requireAdmin, (req: AuthedRequest, res: Response) => {
  const memberId = req.params.memberId;
  const user = getUserByMemberId(memberId);
  if (!user) { res.status(404).json({ error: 'Ce membre n’a pas d’accès' }); return; }
  if (req.user && user.id === req.user.id) { res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre accès' }); return; }
  deleteUser(user.id);
  res.json({ ok: true });
});

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

api.get('/calendar/school-holidays', auth, async (req: Request, res: Response) => {
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

// ---- ICS calendar feed (events only) ----
const pad2 = (n: number): string => String(n).padStart(2, '0');
const icsDate = (ds: string): string => ds.replace(/-/g, '');
function icsAddDay(ds: string): string {
  const d = new Date(ds + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}
const icsEsc = (s: string): string => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsRrule(recur: string): string {
  switch (recur) {
    case 'daily': return 'FREQ=DAILY';
    case 'weekday': return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly': return 'FREQ=WEEKLY';
    case 'monthly': return 'FREQ=MONTHLY';
    default: return '';
  }
}
function buildIcs(state: HouseholdState): string {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').slice(0, 15) + 'Z';
  const mname = (id: string): string => state.members.find((m) => m.id === id)?.name || '';
  const L: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Foyer//Calendrier//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(state.familyName)}`];
  for (const ev of state.events) {
    const allDay = !ev.time || ev.time === '—';
    L.push('BEGIN:VEVENT', `UID:${ev.id}@foyer`, `DTSTAMP:${dtstamp}`);
    if (allDay) {
      L.push(`DTSTART;VALUE=DATE:${icsDate(ev.date)}`);
      L.push(`DTEND;VALUE=DATE:${icsAddDay(ev.end && ev.end !== ev.date ? ev.end : ev.date)}`);
    } else {
      const [hh, mm] = ev.time.split(':');
      L.push(`DTSTART:${icsDate(ev.date)}T${pad2(+hh)}${pad2(+mm)}00`);
      if (ev.end && ev.end !== ev.date) L.push(`DTEND:${icsDate(ev.end)}T${pad2(+hh)}${pad2(+mm)}00`);
      else L.push(`DTEND:${icsDate(ev.date)}T${pad2(Math.min(+hh + 1, 23))}${pad2(+mm)}00`);
    }
    const rr = icsRrule(ev.recur);
    if (rr) L.push(`RRULE:${rr}`);
    L.push(`SUMMARY:${icsEsc(ev.title)}`);
    const who = mname(ev.who);
    if (who) L.push(`DESCRIPTION:${icsEsc(who)}`);
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

api.get('/calendar/ics', auth, (_req, res) => {
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
api.get('/calendar/feed.ics', (req: Request, res: Response) => {
  const token = String(req.query['token'] || '');
  const state = getStateByIcsToken(token) as HouseholdState | null;
  if (!state) { res.status(404).type('text/plain').send('Calendrier introuvable'); return; }
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="foyer.ics"');
  res.send(buildIcs(state));
});

// ---- System / self-update ----
api.get('/system/version', auth, (_req, res) => {
  res.json({ current: currentVersion(), selfUpdate: selfUpdateEnabled(), repo: GITHUB_REPO });
});

api.get('/system/update-check', auth, async (_req, res) => {
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
api.post('/system/update', auth, requireAdmin, (_req, res) => {
  if (!selfUpdateEnabled()) {
    res.status(400).json({ error: 'Mise à jour automatique non activée sur ce serveur. Lancez « deploy/lxc/update.sh » manuellement.' });
    return;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'update-status.json'), JSON.stringify({ state: 'running', message: 'Mise à jour lancée…', ts: Date.now() }));
    fs.writeFileSync(path.join(DATA_DIR, '.update-trigger'), String(Date.now()));
    res.json({ started: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

api.get('/system/update-status', auth, (_req, res) => {
  try {
    const p = path.join(DATA_DIR, 'update-status.json');
    if (fs.existsSync(p)) { res.json({ ...JSON.parse(fs.readFileSync(p, 'utf-8')), current: currentVersion() }); return; }
  } catch { /* ignore */ }
  res.json({ state: 'idle', current: currentVersion() });
});

app.use('/api', api);

// ---- Static frontend (single-container deployment) ----
if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[foyer] API + app disponibles sur http://0.0.0.0:${PORT}`);
});
