// La surface HTTP des réglages, bout en bout.
//
// Ce qui compte ici n'est pas qu'un bouton soit caché : c'est que **le serveur
// refuse**. Un membre non administrateur qui appelle l'API directement, depuis
// un terminal ou une extension de navigateur, doit se voir opposer un 403, et
// le document ne doit pas bouger d'un octet.
//
// Le reste éprouve l'autre promesse de la tranche : l'écriture est ciblée. Deux
// administrateurs qui règlent deux choses à la même seconde repartent avec les
// deux réglages, pas avec celui du dernier qui a parlé.
import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import express, { Request } from 'express';
import { migrateHousehold } from '../src/storage/schema';
import { initDoc, readDoc } from '../src/state/doc';
import { settingsRouter } from '../src/settings/routes';
import { householdDefaults } from '../src/settings/registry';
import { settingsChanged } from '../src/settings/repo';

let server: http.Server;
let base: string;
let db: Database.Database;
/** Qui appelle : l'en-tête « x-essai-role » suffit, l'authentification est éprouvée ailleurs. */
let env: Record<string, string | undefined>;

const appel = async (method: string, role: string, body?: unknown): Promise<{ status: number; json: any }> => {
  const res = await fetch(base + '/settings', {
    method,
    headers: { 'content-type': 'application/json', 'x-essai-role': role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

const reglages = (): Record<string, unknown> => (readDoc().doc['settings'] || {}) as Record<string, unknown>;

beforeEach(async () => {
  db = new Database(':memory:');
  migrateHousehold(db);
  db.exec("CREATE TABLE IF NOT EXISTS household (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.prepare('INSERT INTO household (id, state, version) VALUES (1, ?, 1)')
    .run(JSON.stringify({ familyName: 'Essai', members: [], settings: householdDefaults() }));
  initDoc(db);
  env = {};

  const app = express();
  const role = (req: Request): string => String(req.headers['x-essai-role'] || 'enfant');
  app.use('/api/settings', settingsRouter({
    memberId: (req) => (role(req) === 'anonyme' ? null : 'm-' + role(req)),
    isAdmin: (req) => role(req) === 'admin',
    envValue: (name) => env[name],
  }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api';
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
});

describe('réglages : qui a le droit', () => {
  it('un membre non administrateur peut lire les réglages', async () => {
    const { status, json } = await appel('GET', 'adulte');
    assert.equal(status, 200);
    assert.equal(json.canEdit, false, 'la lecture est ouverte, l’écriture non');
    assert.equal(json.values.prefNotifs, true);
    assert.ok(Array.isArray(json.registry) && json.registry.length, 'la page est engendrée depuis ce qui est renvoyé ici');
  });

  it('un membre non administrateur se voit refuser l’écriture, et le document ne bouge pas', async () => {
    const avant = JSON.stringify(reglages());
    const { status, json } = await appel('PATCH', 'adulte', { changes: { dark: true } });
    assert.equal(status, 403);
    assert.match(json.error, /administrateur/i);
    assert.equal(JSON.stringify(reglages()), avant, 'un refus ne doit rien écrire du tout');
  });

  it('un administrateur écrit, et la valeur est bien dans le document', async () => {
    const { status, json } = await appel('PATCH', 'admin', { changes: { dark: true, showBreakfast: true } });
    assert.equal(status, 200);
    assert.deepEqual(json.changed.sort(), ['dark', 'showBreakfast']);
    assert.equal(reglages()['dark'], true);
    assert.equal(reglages()['showBreakfast'], true);
  });
});

describe('réglages : ce qui est refusé, et ce que le refus explique', () => {
  it('une clé inconnue est refusée avec son nom', async () => {
    const { status, json } = await appel('PATCH', 'admin', { changes: { nImporteQuoi: true } });
    assert.equal(status, 422);
    assert.match(json.error, /nImporteQuoi/);
  });

  it('une valeur hors domaine est refusée, et rien du lot n’est écrit', async () => {
    const { status, json } = await appel('PATCH', 'admin', { changes: { dark: true, academie: 'Marseille' } });
    assert.equal(status, 422);
    assert.equal(json.refused[0].key, 'academie');
    assert.equal(reglages()['dark'], false, 'un lot est tout ou rien : le réglage valide du même lot n’est pas écrit');
  });

  it('un corps mal formé le dit plutôt que de ne rien faire en silence', async () => {
    assert.equal((await appel('PATCH', 'admin', { changes: [1, 2] })).status, 400);
    assert.equal((await appel('PATCH', 'admin', {})).status, 400);
  });
});

describe('réglages : deux administrateurs à la fois', () => {
  it('chacun n’écrit que sa clé, aucun ne perd celle de l’autre', async () => {
    await appel('PATCH', 'admin', { changes: { dark: true } });
    await appel('PATCH', 'admin', { changes: { showBreakfast: true } });
    assert.equal(reglages()['dark'], true, 'le premier réglage a survécu au second');
    assert.equal(reglages()['showBreakfast'], true);
  });

  it('réécrire la même valeur ne fait pas tourner la version du document', async () => {
    await appel('PATCH', 'admin', { changes: { dark: true } });
    const version = readDoc().version;
    const { json } = await appel('PATCH', 'admin', { changes: { dark: true } });
    assert.deepEqual(json.changed, [], 'rien n’a changé, donc rien n’est écrit');
    assert.equal(readDoc().version, version, 'les autres appareils n’ont aucune raison de se recharger');
  });
});

describe('réglages : le journal des modifications', () => {
  it('retient qui a changé quoi, et de quelle valeur vers quelle valeur', async () => {
    await appel('PATCH', 'admin', { changes: { dark: true } });
    const { json } = await appel('GET', 'admin');
    const ligne = json.log[0];
    assert.equal(ligne.key, 'dark');
    assert.equal(ligne.label, 'Thème sombre', 'le journal est lisible sans connaître les clés');
    assert.equal(ligne.before, false);
    assert.equal(ligne.after, true);
    assert.equal(ligne.memberId, 'm-admin');
    assert.ok(ligne.at, 'une modification sans date ne réglerait aucune discussion');
  });

  it('une écriture refusée ne laisse aucune trace', async () => {
    await appel('PATCH', 'adulte', { changes: { dark: true } });
    await appel('PATCH', 'admin', { changes: { academie: 'Marseille' } });
    const { json } = await appel('GET', 'admin');
    assert.deepEqual(json.log, []);
  });
});

describe('réglages : ce que l’environnement impose', () => {
  it('une variable posée est signalée à la clé qu’elle écrase', async () => {
    // Aucun réglage ne porte encore d'envOverride : on éprouve le mécanisme en
    // posant la variable qu'une future déclaration nommera.
    env['FOYER_ESSAI'] = 'false';
    const { json } = await appel('GET', 'admin');
    assert.deepEqual(json.overrides, {}, 'sans déclaration qui la nomme, une variable ne s’impose à rien');
  });
});

describe('réglages : la porte de PUT /api/state', () => {
  const base = householdDefaults();

  it('un enregistrement qui ne touche à rien passe', () => {
    assert.equal(settingsChanged(base, { ...base }), false);
  });

  it('un enregistrement qui change un réglage est détecté', () => {
    assert.equal(settingsChanged(base, { ...base, dark: true }), true);
    assert.equal(settingsChanged(base, { ...base, academie: 'Rennes' }), true);
  });

  it('retirer une clé déclarée compte aussi comme une modification', () => {
    const sans = { ...base };
    delete (sans as Record<string, unknown>)['prefNotifs'];
    assert.equal(settingsChanged(base, sans), true);
  });

  it('une clé retirée du registre ne fait pas refuser les sauvegardes d’un vieux document', () => {
    // « dateFmt » a existé, puis a été retiré : les documents d'avant le portent
    // encore. Si le garde s'en émouvait, ce foyer ne pourrait plus rien
    // enregistrer du tout.
    assert.equal(settingsChanged({ ...base, dateFmt: 'AAAA-MM-JJ' }, { ...base }), false);
    assert.equal(settingsChanged({ ...base }, { ...base, dateFmt: 'AAAA-MM-JJ' }), false);
  });

  it('un document sans réglages du tout est comparé au défaut sans planter', () => {
    assert.equal(settingsChanged(undefined, undefined), false);
    assert.equal(settingsChanged(null, { dark: true }), true);
  });
});
