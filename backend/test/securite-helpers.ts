// Socle commun des tests de sécurité : un serveur qui monte **les vraies routes**
// de `src/server.ts`, avec leurs vrais gardes.
//
// Reconstruire une application de test à côté ne prouverait rien : c'est
// exactement l'erreur qui laisse une route protégée dans le test et ouverte en
// production. On importe donc `src/server.ts`, qui exporte son application sans
// démarrer l'écoute ni le planificateur (voir `start()` là-bas).
//
// L'import est **dynamique et tardif** parce que `src/db.ts` ouvre la base au
// chargement du module, d'après l'environnement : il faut avoir posé
// FOYER_DATA_DIR et FOYER_JWT_SECRET avant.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';

export const SECRET = 'secret-de-test-suffisamment-long-pour-etre-accepte';

export interface Contexte {
  base: string;
  app: Express;
  server: http.Server;
  dir: string;
  /** Jeton d'un compte : administrateur, membre ordinaire, ou compte sans membre. */
  jetons: { admin: string; membre: string; sansMembre: string };
  /** Identifiants en base, pour les tests qui manipulent `token_version`. */
  ids: { admin: number; membre: number; sansMembre: number };
}

/**
 * Un foyer complet dans un répertoire jetable : un administrateur, un membre
 * ordinaire, et un compte volontairement rattaché à aucun membre (celui que
 * `POST /auth/register` produit).
 *
 * À appeler **une fois par fichier de test**, dans un `before`, jamais dans un
 * `beforeEach` : `src/db.ts` ouvre sa base au chargement du module, et le second
 * import rendrait le module déjà en cache, toujours branché sur la première base.
 */
export async function demarrer(): Promise<Contexte> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-secu-'));
  process.env.FOYER_DATA_DIR = dir;
  process.env.FOYER_DB_PATH = path.join(dir, 'foyer.db');
  process.env.FOYER_JWT_SECRET = SECRET;
  process.env.FOYER_STATIC_DIR = path.join(dir, 'public-absent');

  const { app } = await import('../src/server');
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

  const setup = await appel(base, 'POST', '/setup', {
    household: { name: 'Foyer de test' },
    admin: { name: 'Thomas', email: 'admin@example.fr', password: 'MotDePasseSolide1' },
    members: [
      { name: 'Camille', email: 'membre@example.fr', password: 'MotDePasseSolide2' },
      // Sans identifiants : c'est à lui qu'on ouvrira un accès avant de le retirer
      // du foyer, pour obtenir un compte qui survit à sa fiche de membre.
      { name: 'Alex' },
    ],
  });
  if (setup.status !== 201) throw new Error('onboarding de test échoué : ' + JSON.stringify(setup.json));

  const membre = await appel(base, 'POST', '/auth/login', { email: 'membre@example.fr', password: 'MotDePasseSolide2' });

  // Le compte sans membre, construit comme la vie le produit : un accès ouvert
  // en bonne et due forme, puis le membre retiré du foyer. Le compte survit à sa
  // fiche, et c'est précisément le cas que le garde doit couvrir maintenant que
  // l'inscription libre n'existe plus. Une base héritée porte les mêmes lignes.
  const db = await import('../src/db');
  const etat = await appel(base, 'GET', '/state', undefined, setup.json.token);
  const membres = etat.json.state.members as { id: string; name: string }[];
  const aRetirer = membres.find((m) => m.name === 'Alex')!.id;
  const ouvert = await appel(base, 'POST', `/members/${aRetirer}/account`, {
    email: 'orphelin@example.fr', password: 'MotDePasseSolide3',
  }, setup.json.token);
  if (ouvert.status !== 201) throw new Error('ouverture d’accès de test échouée : ' + JSON.stringify(ouvert.json));
  const sansJeton = (await appel(base, 'POST', '/auth/login', { email: 'orphelin@example.fr', password: 'MotDePasseSolide3' })).json.token;

  const retire = await appel(base, 'PUT', '/state', {
    version: etat.json.version,
    state: { ...etat.json.state, members: membres.filter((m) => m.id !== aRetirer) },
  }, setup.json.token);
  if (retire.status !== 200) throw new Error('retrait du membre de test échoué : ' + JSON.stringify(retire.json));

  const idDe = (email: string): number => {
    const u = db.findUserByEmail(email);
    if (!u) throw new Error('compte de test introuvable : ' + email);
    return u.id;
  };

  return {
    base, app, server, dir,
    jetons: { admin: setup.json.token, membre: membre.json.token, sansMembre: sansJeton },
    ids: { admin: idDe('admin@example.fr'), membre: idDe('membre@example.fr'), sansMembre: idDe('orphelin@example.fr') },
  };
}

export async function arreter(ctx: Contexte): Promise<void> {
  await new Promise<void>((r) => ctx.server.close(() => r()));
  fs.rmSync(ctx.dir, { recursive: true, force: true });
}

export interface Reponse { status: number; json: any }

export async function appel(base: string, method: string, chemin: string, body?: unknown, jeton?: string): Promise<Reponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (jeton) headers['authorization'] = 'Bearer ' + jeton;
  const res = await fetch(base + chemin, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const texte = await res.text();
  let json: unknown = null;
  try { json = texte ? JSON.parse(texte) : null; } catch { json = texte; }
  return { status: res.status, json };
}
