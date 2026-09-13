// Surface HTTP des jetons d'accès par membre : lister, créer (une fois le secret
// montré, jamais réaffiché), révoquer. Chacun gère les siens ; un administrateur
// voit et révoque ceux de n'importe quel membre.
//
// Séparé de auth/routes.ts pour tenir en un fichier relisible seul, comme le
// reste du kit d'authentification. Monté sous /api par server.ts.
import express, { Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ApiTokenRow, countActiveApiTokens, createApiToken, getApiTokenById, getUserById, getUserByMemberId, listApiTokensForUser, revokeApiToken, revokeRefreshForAccessToken } from '../db';
import { log } from '../log';
import { AuthedRequest, auth, denyToken, motDePasseBon, requireAdmin, requireMember, route } from './session';
import { genererJeton, hashJeton, prefixeJeton } from './tokens';

const jsonSmall = express.json({ limit: '256kb' });

/**
 * La création d'un jeton redonne le mot de passe : on borne le débit pour ne pas
 * en faire une fenêtre de devinette, comme les routes d'identifiants.
 */
const creationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez dans quelques minutes.' },
});

/** La vue publique d'un jeton : tout sauf le condensat. Le secret n'y figure jamais. */
function vue(t: ApiTokenRow): Omit<ApiTokenRow, 'token_hash' | 'user_id'> {
  const { token_hash: _h, user_id: _u, ...reste } = t;
  return reste;
}

export function tokensRouter(): Router {
  const r = express.Router();

  // ---- Ses propres jetons ----
  r.get('/me/tokens', auth, requireMember, (req: AuthedRequest, res: Response) => {
    res.json({ tokens: listApiTokensForUser(req.user!.id).map(vue) });
  });

  r.post('/me/tokens', creationLimiter, auth, requireMember, denyToken, jsonSmall, route(async (req, res) => {
    const user = getUserById(req.user!.id);
    if (!user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    const name = String(req.body?.name || '').trim();
    const scope = req.body?.scope === 'write' ? 'write' : req.body?.scope === 'read' ? 'read' : null;
    if (!name) { res.status(400).json({ error: 'Donnez un nom à cet accès (par ex. « Claude sur mon iPhone »).' }); return; }
    if (name.length > 60) { res.status(400).json({ error: 'Le nom est trop long (60 caractères maximum).' }); return; }
    if (!scope) { res.status(400).json({ error: 'Portée invalide : « read » (lecture seule) ou « write » (lecture et écriture).' }); return; }
    if (!await motDePasseBon(req, user)) {
      log.attention(`Jeton : mot de passe incorrect à la création pour ${user.email}.`);
      res.status(403).json({ error: 'Mot de passe incorrect.' });
      return;
    }
    const secret = genererJeton();
    const row = createApiToken(user.id, name, hashJeton(secret), prefixeJeton(secret), scope);
    log.info(`Jeton : « ${name} » (${scope}) créé pour ${user.email} depuis ${req.ip || 'adresse inconnue'}.`);
    // Le secret n'apparaît qu'ici, une seule fois.
    res.status(201).json({ token: secret, ...vue(row) });
  }));

  r.delete('/me/tokens/:id', auth, requireMember, (req: AuthedRequest, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const t = Number.isInteger(id) ? getApiTokenById(id) : undefined;
    if (!t || t.user_id !== req.user!.id) { res.status(404).json({ error: 'Jeton introuvable' }); return; }
    revokeApiToken(t.id);
    revokeRefreshForAccessToken(t.id);
    log.info(`Jeton : « ${t.name} » révoqué par ${req.user!.email}.`);
    res.json({ ok: true });
  });

  // ---- Jetons d'un membre, vus et révoqués par un administrateur ----
  // Un parent révoque ceux d'un enfant. Réservé à un administrateur : la liste
  // est l'inventaire des accès à surveiller.
  r.get('/members/:memberId/tokens', auth, requireAdmin, denyToken, (req: AuthedRequest, res: Response) => {
    const user = getUserByMemberId(String(req.params.memberId));
    if (!user) { res.status(404).json({ error: 'Ce membre n’a pas d’accès' }); return; }
    res.json({ tokens: listApiTokensForUser(user.id).map(vue) });
  });

  r.delete('/members/:memberId/tokens/:tid', auth, requireAdmin, denyToken, (req: AuthedRequest, res: Response) => {
    const user = getUserByMemberId(String(req.params.memberId));
    if (!user) { res.status(404).json({ error: 'Ce membre n’a pas d’accès' }); return; }
    const tid = parseInt(req.params.tid, 10);
    const t = Number.isInteger(tid) ? getApiTokenById(tid) : undefined;
    if (!t || t.user_id !== user.id) { res.status(404).json({ error: 'Jeton introuvable' }); return; }
    revokeApiToken(t.id);
    revokeRefreshForAccessToken(t.id);
    log.attention(`Jeton : « ${t.name} » de ${user.email} révoqué par l’administrateur ${req.user!.email}.`);
    res.json({ ok: true });
  });

  return r;
}

/** Le nombre de jetons actifs d'un membre, pour la fiche de famille. Rendu 0 si le membre n'a pas de compte. */
export function activeTokenCount(memberId: string): number {
  const u = getUserByMemberId(memberId);
  return u ? countActiveApiTokens(u.id) : 0;
}
