// Le fournisseur OAuth 2.1 de Foyer : la logique du protocole derrière les
// points d'entrée que le SDK MCP monte (mcpAuthRouter). Foyer EST le serveur
// d'autorisation, il ne délègue à personne.
//
// Le résultat d'un flux réussi est, en base, un jeton d'accès `api_tokens`
// **comme les autres** (révocable au même endroit dans Paramètres), avec en plus
// une expiration (30 jours) et le client d'origine. Un jeton de rafraîchissement
// (90 jours, en rotation) permet d'en réémettre sans repasser par la connexion.
//
// L'étape interactive (connexion + consentement) n'est pas ici : `authorize`
// redirige vers la page servie par oauth/login.ts, qui, une fois la personne
// authentifiée et consentante, dépose le code d'autorisation et renvoie au
// client. Ici on ne fait qu'émettre et vérifier des jetons.
import crypto from 'crypto';
import { Response } from 'express';
import { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {
  getOAuthClient, upsertOAuthClient, insertOAuthCode, getOAuthCode, consumeOAuthCode,
  insertOAuthRefresh, getOAuthRefresh, rotateOAuthRefresh, revokeRefreshForAccessToken,
  createApiToken, getApiTokenByHash, revokeApiToken,
} from '../db';
import { genererJeton, hashJeton, prefixeJeton } from '../auth/tokens';
import { signOAuthRequest } from '../auth/session';
import { log } from '../log';

const ACCESS_TTL_S = 30 * 24 * 60 * 60; // 30 jours
const REFRESH_TTL_S = 90 * 24 * 60 * 60; // 90 jours
const CODE_TTL_S = 5 * 60; // 5 minutes
const now = (): number => Math.floor(Date.now() / 1000);
const iso = (epochS: number): string => new Date(epochS * 1000).toISOString();

/** Une adresse de redirection acceptée : https partout, http seulement en local (Claude Code, outils locaux). */
function validRedirect(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch { return false; }
}

/** Un secret opaque de jeton de rafraîchissement. Distinct d'un jeton d'accès `foyer_…`. */
const refreshSecret = (): string => 'foyer_rt_' + crypto.randomBytes(32).toString('base64url');

/** La portée demandée, ramenée à read/write. Le consentement, lui, tranche pour de bon. */
const asScope = (s: string): 'read' | 'write' => (s === 'write' ? 'write' : 'read');

const clientsStore: OAuthRegisteredClientsStore = {
  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = getOAuthClient(clientId);
    if (!row) return undefined;
    return {
      client_id: row.client_id,
      client_name: row.client_name || undefined,
      redirect_uris: JSON.parse(row.redirect_uris),
      ...(row.client_secret ? { client_secret: row.client_secret } : {}),
      ...(row.client_secret_expires_at ? { client_secret_expires_at: row.client_secret_expires_at } : {}),
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: row.client_secret ? 'client_secret_post' : 'none',
    };
  },
  registerClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
    // Enregistrement dynamique limité : uniquement des redirections https (plus
    // http local). C'est la porte qu'on ne veut pas ouvrir en grand sur Internet.
    const uris = client.redirect_uris || [];
    if (!uris.length || !uris.every(validRedirect)) {
      throw new InvalidClientMetadataError('redirect_uris doit lister des adresses https:// (ou http://localhost pour un outil local).');
    }
    upsertOAuthClient({
      client_id: client.client_id,
      client_name: client.client_name || '',
      redirect_uris: uris,
      client_secret: client.client_secret ?? null,
      client_secret_expires_at: client.client_secret_expires_at ?? null,
    });
    log.info(`OAuth : client « ${client.client_name || client.client_id} » enregistré.`);
    return client;
  },
};

/**
 * Émet un jeton d'accès (api_tokens) et un jeton de rafraîchissement adossés à
 * un membre, une portée et un client. Cœur commun de l'échange de code et de la
 * rotation. Rend la paire de secrets, montrés une seule fois au client.
 */
function issueTokens(userId: number, clientId: string, clientName: string, scope: 'read' | 'write', resource: string | null): OAuthTokens {
  const access = genererJeton();
  const token = createApiToken(userId, clientName || 'OAuth', hashJeton(access), prefixeJeton(access), scope, {
    expiresAt: iso(now() + ACCESS_TTL_S), oauthClientId: clientId,
  });
  const refresh = refreshSecret();
  insertOAuthRefresh({ token_hash: hashJeton(refresh), client_id: clientId, user_id: userId, access_token_id: token.id, scope, resource, expires_at: now() + REFRESH_TTL_S });
  return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

export const foyerOAuthProvider: OAuthServerProvider = {
  get clientsStore() { return clientsStore; },

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    // `state` obligatoire (défense contre la CSRF du flux) : absent, on renvoie
    // l'erreur au client plutôt que d'ouvrir la page de connexion.
    if (!params.state) {
      const url = new URL(params.redirectUri);
      url.searchParams.set('error', 'invalid_request');
      url.searchParams.set('error_description', 'Le paramètre state est obligatoire.');
      res.redirect(302, url.href);
      return;
    }
    // On ne montre rien ici : on signe la demande et on renvoie vers la page de
    // connexion et de consentement, servie par le backend (oauth/login.ts).
    const req = signOAuthRequest({
      clientId: client.client_id,
      clientName: client.client_name || client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state ?? '',
      resource: params.resource?.href ?? '',
      scopes: params.scopes ?? [],
    });
    res.redirect(302, '/oauth/login?req=' + encodeURIComponent(req));
  },

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const row = getOAuthCode(hashJeton(authorizationCode));
    if (!row || row.client_id !== client.client_id || row.used || row.expires_at < now()) {
      throw new InvalidGrantError('Code d’autorisation invalide ou expiré.');
    }
    return row.code_challenge;
  },

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string, _codeVerifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const hash = hashJeton(authorizationCode);
    const row = getOAuthCode(hash);
    if (!row || row.client_id !== client.client_id || row.expires_at < now()) throw new InvalidGrantError('Code d’autorisation invalide ou expiré.');
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) throw new InvalidGrantError('L’adresse de redirection ne correspond pas.');
    // Usage unique : la première requête gagne, une seconde échoue.
    if (!consumeOAuthCode(hash)) throw new InvalidGrantError('Ce code a déjà été échangé.');
    log.info(`OAuth : code échangé pour « ${client.client_name || client.client_id} » (portée ${row.scope}).`);
    return issueTokens(row.user_id, client.client_id, client.client_name || '', asScope(row.scope), row.resource);
  },

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const hash = hashJeton(refreshToken);
    const row = getOAuthRefresh(hash);
    if (!row || row.client_id !== client.client_id || row.rotated_at || row.expires_at < now()) {
      throw new InvalidGrantError('Jeton de rafraîchissement invalide ou expiré.');
    }
    // Rotation : ce jeton ne resservira pas. La course est tranchée en base.
    if (!rotateOAuthRefresh(hash)) throw new InvalidGrantError('Ce jeton de rafraîchissement a déjà servi.');
    // Le jeton d'accès adossé est révoqué : le client repart sur le neuf.
    if (row.access_token_id) revokeApiToken(row.access_token_id);
    return issueTokens(row.user_id, client.client_id, client.client_name || '', asScope(row.scope), row.resource);
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = getApiTokenByHash(hashJeton(token));
    if (!row || row.revoked_at || (row.expires_at && new Date(row.expires_at).getTime() < Date.now())) {
      throw new InvalidTokenError('Jeton d’accès invalide, expiré ou révoqué.');
    }
    return {
      token, clientId: row.oauth_client_id || '', scopes: [row.scope],
      ...(row.expires_at ? { expiresAt: Math.floor(new Date(row.expires_at).getTime() / 1000) } : {}),
    };
  },

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const hash = hashJeton(request.token);
    // Jeton d'accès de ce client ?
    const access = getApiTokenByHash(hash);
    if (access && access.oauth_client_id === client.client_id) {
      revokeApiToken(access.id);
      revokeRefreshForAccessToken(access.id);
      return;
    }
    // Sinon, jeton de rafraîchissement de ce client ?
    const refresh = getOAuthRefresh(hash);
    if (refresh && refresh.client_id === client.client_id) {
      rotateOAuthRefresh(hash);
      if (refresh.access_token_id) revokeApiToken(refresh.access_token_id);
    }
    // Un jeton inconnu : RFC 7009, on ne dit rien et on répond 200.
  },
};

/** Dépose un code d'autorisation après connexion + consentement. Appelé par oauth/login.ts. */
export function issueAuthorizationCode(input: {
  clientId: string; userId: number; redirectUri: string; codeChallenge: string; scope: 'read' | 'write'; resource: string | null;
}): string {
  const code = 'foyer_ac_' + crypto.randomBytes(32).toString('base64url');
  insertOAuthCode({
    code_hash: hashJeton(code), client_id: input.clientId, user_id: input.userId,
    redirect_uri: input.redirectUri, code_challenge: input.codeChallenge, scope: input.scope,
    resource: input.resource, expires_at: now() + CODE_TTL_S,
  });
  return code;
}

/** Le client existe-t-il, et l'adresse de redirection est-elle bien l'une des siennes ? (garde de la page de connexion) */
export function checkClientRedirect(clientId: string, redirectUri: string): boolean {
  const row = getOAuthClient(clientId);
  if (!row) return false;
  try { return (JSON.parse(row.redirect_uris) as string[]).includes(redirectUri); } catch { return false; }
}
