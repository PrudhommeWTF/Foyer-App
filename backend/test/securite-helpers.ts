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
  /** Jeton d'un compte : administrateur, adulte ordinaire, enfant, ou compte sans membre. */
  jetons: { admin: string; membre: string; enfant: string; sansMembre: string };
  /** Identifiants en base, pour les tests qui manipulent `token_version`. */
  ids: { admin: number; membre: number; enfant: number; sansMembre: number };
  /** Identifiants créés côté Finances et Documents, pour éprouver les accès directs. */
  pieces: { transactionId: number; pieceFinances: number; document: number; photoRecette: number };
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
  // Une application compilée minimale : sans elle, le service ne monte pas du
  // tout le service de fichiers statiques, et les tests qui portent sur la route
  // de repli éprouveraient la page 404 d'Express au lieu de la nôtre.
  const statique = path.join(dir, 'public');
  fs.mkdirSync(statique, { recursive: true });
  fs.writeFileSync(path.join(statique, 'index.html'), '<!doctype html><title>Foyer</title><div id="app"></div>');
  process.env.FOYER_STATIC_DIR = statique;

  const { app } = await import('../src/server');
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

  const setup = await appel(base, 'POST', '/setup', {
    household: { name: 'Foyer de test' },
    admin: { name: 'Thomas', email: 'admin@example.fr', password: 'MotDePasseSolide1' },
    members: [
      { name: 'Camille', email: 'membre@example.fr', password: 'MotDePasseSolide2' },
      { name: 'Lena', email: 'enfant@example.fr', password: 'MotDePasseSolide7' },
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

  // Lena est marquée enfant : c'est une propriété de la fiche, pas du compte.
  const etat2 = await appel(base, 'GET', '/state', undefined, setup.json.token);
  const membres2 = (etat2.json.state.members as { id: string; name: string; enfant?: boolean }[])
    .map((m) => (m.name === 'Lena' ? { ...m, enfant: true } : m));
  const marque = await appel(base, 'PUT', '/state', { version: etat2.json.version, state: { ...etat2.json.state, members: membres2 } }, setup.json.token);
  if (marque.status !== 200) throw new Error('marquage enfant échoué : ' + JSON.stringify(marque.json));
  const enfantJeton = (await appel(base, 'POST', '/auth/login', { email: 'enfant@example.fr', password: 'MotDePasseSolide7' })).json.token;

  // De quoi éprouver un accès direct : une opération, sa pièce jointe, un
  // document de famille et une photo de recette.
  const compte = await appel(base, 'POST', '/finances/accounts', { name: 'Compte joint', kind: 'courant' }, setup.json.token);
  const tx = await appel(base, 'POST', '/finances/transactions', {
    accountId: compte.json.account.id, date: '2026-09-01', amount: '-84,30', label: 'Assurance, ref client 44821',
  }, setup.json.token);
  const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const pj = await brut(base, `/finances/attachments?owner=transaction&id=${tx.json.transaction.id}`, PDF, setup.json.token);
  const doc = await brut(base, '/files?owner=document&id=d1&filename=carte-identite.pdf', PDF, setup.json.token);
  const photo = await brut(base, '/files?owner=recipe&id=r1&filename=tarte.png', PNG, setup.json.token);

  const idDe = (email: string): number => {
    const u = db.findUserByEmail(email);
    if (!u) throw new Error('compte de test introuvable : ' + email);
    return u.id;
  };

  return {
    base, app, server, dir,
    jetons: { admin: setup.json.token, membre: membre.json.token, enfant: enfantJeton, sansMembre: sansJeton },
    ids: {
      admin: idDe('admin@example.fr'), membre: idDe('membre@example.fr'),
      enfant: idDe('enfant@example.fr'), sansMembre: idDe('orphelin@example.fr'),
    },
    pieces: {
      transactionId: tx.json.transaction.id,
      pieceFinances: pj.json.attachment.id,
      document: doc.json.file.id,
      photoRecette: photo.json.file.id,
    },
  };
}

export async function arreter(ctx: Contexte): Promise<void> {
  await new Promise<void>((r) => ctx.server.close(() => r()));
  fs.rmSync(ctx.dir, { recursive: true, force: true });
}

export interface Reponse { status: number; json: any }

/** Envoi d'un fichier en corps brut, comme le fait l'application. */
export async function brut(base: string, chemin: string, corps: Buffer, jeton: string): Promise<Reponse> {
  const res = await fetch(base + chemin, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer ' + jeton },
    body: new Uint8Array(corps),
  });
  return { status: res.status, json: await res.json() };
}

export async function appel(base: string, method: string, chemin: string, body?: unknown, jeton?: string): Promise<Reponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (jeton) headers['authorization'] = 'Bearer ' + jeton;
  const res = await fetch(base + chemin, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const texte = await res.text();
  let json: unknown = null;
  try { json = texte ? JSON.parse(texte) : null; } catch { json = texte; }
  return { status: res.status, json };
}
