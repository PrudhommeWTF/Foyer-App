// Le montage OAuth : les points d'entrée standard (autorisation, jeton,
// enregistrement dynamique, révocation, découverte) que le SDK MCP fabrique à
// partir de notre fournisseur, et la « provocation » de découverte sur /mcp.
//
// L'émetteur (issuer) est l'« Adresse publique de Foyer » (réglage publicUrl).
// Elle peut changer en cours de route : le routeur est donc reconstruit à la
// volée quand elle bouge, plutôt que figé au démarrage. Sans elle, OAuth reste
// éteint (les endpoints répondent comme des chemins inconnus), et on le dit une
// fois dans le journal. Le réglage `mcpEnabled` gouverne OAuth comme le reste.
import { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { foyerOAuthProvider } from './provider';
import { effectiveSetting } from '../settings/repo';
import { log } from '../log';

/**
 * Le limiteur des points OAuth, créé **une seule fois** au chargement du module.
 * Les limiteurs internes du SDK sont désactivés (voir plus bas) : express-rate-limit
 * refuse qu'on en crée un pendant une requête, or le routeur d'autorisation est
 * construit paresseusement (l'émetteur peut changer). On borne donc ces points
 * ici, à un endroit sûr. Monté sur les chemins OAuth par server.ts.
 */
export const oauthLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de requêtes OAuth, réessayez dans un instant.' },
});

/** OAuth suit l'interrupteur des assistants. */
export const oauthEnabled = (): boolean => effectiveSetting('mcpEnabled') === true;
/** L'émetteur : l'adresse publique du foyer, sans quoi il n'y a pas de flux OAuth. */
const issuer = (): string => String(effectiveSetting('publicUrl') || '').trim();

let cache: { issuer: string; handler: RequestHandler } | null = null;
let warned = false;

/**
 * Monte les endpoints OAuth au niveau racine, reconstruits quand l'émetteur
 * change. Éteint (assistants désactivés, ou adresse publique absente), on laisse
 * simplement passer : les chemins /authorize, /token, /register, /revoke et
 * /.well-known/* retombent alors sur le 404 habituel.
 */
export function oauthAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!oauthEnabled()) { next(); return; }
  const iss = issuer();
  if (!iss) {
    if (!warned) {
      warned = true;
      log.attention('OAuth : les connecteurs claude.ai et ChatGPT ont besoin de l’« Adresse publique de Foyer » (publicUrl). Renseignez-la dans Paramètres → Notifications, ou posez FOYER_PUBLIC_URL. En attendant, seuls les jetons en Bearer fonctionnent.');
    }
    next();
    return;
  }
  warned = false;
  if (!cache || cache.issuer !== iss) {
    try {
      cache = { issuer: iss, handler: mcpAuthRouter({
        provider: foyerOAuthProvider, issuerUrl: new URL(iss), scopesSupported: ['read', 'write'], resourceName: 'Foyer',
        // Le SDK crée sinon ses propres limiteurs express-rate-limit ; comme ce
        // routeur est fabriqué à la volée (pendant une requête), v7 refuse
        // (ERR_ERL_CREATED_IN_REQUEST_HANDLER). On les coupe et on borne les
        // chemins nous-mêmes via `oauthLimiter` (voir server.ts).
        authorizationOptions: { rateLimit: false }, clientRegistrationOptions: { rateLimit: false },
        tokenOptions: { rateLimit: false }, revocationOptions: { rateLimit: false },
      }) };
    } catch (e) {
      log.erreur('OAuth : adresse publique invalide, endpoints OAuth désactivés', e);
      next();
      return;
    }
  }
  cache.handler(req, res, next);
}

/**
 * La « provocation » de découverte sur /mcp : une requête sans jeton reçoit un
 * 401 avec `WWW-Authenticate: Bearer resource_metadata="…"`, ce qui indique au
 * client MCP où trouver la configuration OAuth. Ne s'applique que si OAuth est
 * utilisable (activé et adresse publique posée) ; sinon la garde d'auth normale
 * répond. Une requête qui porte déjà un `Bearer …` passe (elle sera validée par
 * `auth`).
 */
export function mcpChallenge(req: Request, res: Response, next: NextFunction): void {
  const hasBearer = (req.headers.authorization || '').startsWith('Bearer ');
  const iss = issuer();
  if (!hasBearer && oauthEnabled() && iss) {
    const meta = iss.replace(/\/$/, '') + '/.well-known/oauth-protected-resource';
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${meta}"`);
    res.status(401).json({ error: 'Jeton d’accès requis. Ce serveur propose une autorisation OAuth (voir WWW-Authenticate).' });
    return;
  }
  next();
}
