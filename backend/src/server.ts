import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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
  getUserById,
  getUserByMemberId,
  listMemberAccounts,
  resetHousehold,
  saveHousehold,
  updateUserCredentials,
} from './db';
import { buildInitialState, HouseholdState } from './seed';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

const PORT = parseInt(process.env.PORT || '8099', 10);
const JWT_SECRET = process.env.FOYER_JWT_SECRET || 'foyer-dev-secret-change-me';
const ALLOW_SIGNUP = (process.env.FOYER_ALLOW_SIGNUP || 'true') !== 'false';
// The frontend uses a relative base href, so a single build works served at the
// root or behind a reverse proxy on a sub-path.
const STATIC_DIR = process.env.FOYER_STATIC_DIR || path.join(__dirname, '..', 'public');

bootstrap();

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' })); // documents/photos are stored as data URLs

interface AuthedRequest extends Request {
  user?: { id: number; email: string };
}

function sign(user: { id: number; email: string }): string {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Non authentifié' });
    return;
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET) as { id: number; email: string };
    next();
  } catch {
    res.status(401).json({ error: 'Session expirée' });
  }
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

api.post('/setup', (req: Request, res: Response) => {
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
    .map((m: { name: string; role?: string; color?: string; email?: string; password?: string }, i: number) => ({
      id: 'm' + (i + 1),
      name: String(m.name).trim(),
      role: (m.role || '').trim(),
      color: m.color || '#4E93B8',
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
    household: { name: household.name, weekStart: household.weekStart, currency: household.currency, theme: household.theme },
    admin: { name: admin.name, role: admin.role, color: admin.color, email: admin.email },
    members: normMembers.map((m) => ({ id: m.id, name: m.name, role: m.role, color: m.color, email: m.email || undefined })),
  });

  const adminUser = createUserWithMember(String(admin.email), String(admin.password), String(admin.name).trim(), state.members[0].id);
  for (const m of normMembers) {
    if (m.email && m.password) createUserWithMember(m.email, m.password, m.name, m.id);
  }
  saveHousehold(state);
  res.status(201).json({ token: sign(adminUser), user: { email: adminUser.email, name: adminUser.name, memberId: adminUser.member_id } });
});

api.post('/auth/login', (req: Request, res: Response) => {
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

api.post('/auth/register', (req: Request, res: Response) => {
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

api.put('/state', auth, (req: Request, res: Response) => {
  const state = req.body?.state;
  if (state == null || typeof state !== 'object') {
    res.status(400).json({ error: 'État invalide' });
    return;
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
