import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import {
  bootstrap,
  createUser,
  findUserByEmail,
  getHousehold,
  resetHousehold,
  saveHousehold,
} from './db';

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

const api = express.Router();

api.get('/health', (_req, res) => res.json({ ok: true }));

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
