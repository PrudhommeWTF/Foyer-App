// La route d'import, bout en bout, sans socket.
//
// `fetch` est remplacé le temps du test : ce qui est vérifié ici, c'est
// l'enchaînement réel (aller chercher, contrôler le type, lire, ranger la photo,
// répondre), pas la pile TCP. La validation d'adresse et le lecteur JSON-LD ont
// leurs propres fichiers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { initBlobs } from '../src/storage/blobs';
import { migrateHousehold } from '../src/storage/schema';
import * as files from '../src/storage/files';
import { recipesRouter } from '../src/recipes/routes';

const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'recipes', 'marmiton-gratin-courgettes.json'), 'utf8',
));

/** Un JPEG minuscule mais authentique : le type est reconnu d'après les octets. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

const pageWith = (node: unknown): string =>
  `<!DOCTYPE html><html><head><script type="application/ld+json">${JSON.stringify(node)}</script></head><body></body></html>`;

let server: http.Server;
let base: string;
let dir: string;
const realFetch = globalThis.fetch;

/** Réponses que le faux réseau doit servir, par fragment d'URL. */
let routes: { match: RegExp; status?: number; type: string; body: Buffer | string }[] = [];
const calls: string[] = [];

function stubFetch(): void {
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find((r) => r.match.test(url));
    if (!hit) return new Response('nope', { status: 404 });
    const body = typeof hit.body === 'string' ? hit.body : new Uint8Array(hit.body);
    return new Response(body as BodyInit, { status: hit.status ?? 200, headers: { 'content-type': hit.type } });
  }) as typeof fetch;
}

const post = async (body: unknown): Promise<{ status: number; json: any }> => {
  const res = await realFetch(base + '/recipes/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-imp-'));
  const db = new Database(':memory:');
  initBlobs(dir);
  migrateHousehold(db);
  files.initFiles(db);

  const app = express();
  app.use('/api/recipes', recipesRouter());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api';

  calls.length = 0;
  routes = [];
  stubFetch();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.FOYER_RECIPE_IMPORT;
});

describe('import réussi', () => {
  it('rend la recette lue et range la photo', async () => {
    routes = [
      { match: /marmiton\.org/, type: 'text/html; charset=utf-8', body: pageWith(FIXTURE) },
      { match: /afcdn\.com/, type: 'image/jpeg', body: JPEG },
    ];
    const { status, json } = await post({ url: 'https://www.marmiton.org/recettes/r_17071.aspx', recipeId: 'r-neuve' });

    assert.equal(status, 200);
    assert.equal(json.recipe.name, 'Gratin de courgettes rapide');
    assert.equal(json.recipe.portions, 4);
    assert.equal(json.recipe.prepMin, 15);
    assert.equal(json.recipe.ingr.length, 8);
    assert.equal(json.recipe.steps.length, 7);
    assert.deepEqual(json.warnings, []);

    // La photo est rangée sous la recette visée, prête à être servie.
    assert.ok(json.photoId);
    assert.equal(files.get(json.photoId)!.ownerId, 'r-neuve');
    assert.equal(files.get(json.photoId)!.mime, 'image/jpeg');
    assert.ok(files.fileOf(json.photoId));
  });

  it('ne renvoie pas l’URL de l’image : le client n’en a pas l’usage', async () => {
    routes = [
      { match: /marmiton/, type: 'text/html', body: pageWith(FIXTURE) },
      { match: /afcdn/, type: 'image/jpeg', body: JPEG },
    ];
    const { json } = await post({ url: 'https://www.marmiton.org/r.aspx', recipeId: 'r1' });
    assert.equal(json.recipe.imageUrl, undefined);
  });

  it('ne va pas chercher la photo quand aucune recette ne l’attend', async () => {
    routes = [{ match: /marmiton/, type: 'text/html', body: pageWith(FIXTURE) }];
    const { json } = await post({ url: 'https://www.marmiton.org/r.aspx' });
    assert.equal(json.photoId, null);
    assert.equal(calls.some((u) => /afcdn/.test(u)), false);
  });
});

describe('la photo est un supplément, pas une condition', () => {
  it('une image injoignable n’empêche pas d’importer, mais se signale', async () => {
    routes = [{ match: /marmiton/, type: 'text/html', body: pageWith(FIXTURE) }];
    const { status, json } = await post({ url: 'https://www.marmiton.org/r.aspx', recipeId: 'r1' });
    assert.equal(status, 200);
    assert.equal(json.recipe.ingr.length, 8, 'la recette passe quand même');
    assert.equal(json.photoId, null);
    assert.ok(json.warnings.some((w: string) => /photo/i.test(w)));
  });

  it('un fichier qui n’est pas une image est refusé sur ses octets', async () => {
    routes = [
      { match: /marmiton/, type: 'text/html', body: pageWith(FIXTURE) },
      // Le serveur annonce du JPEG, envoie du HTML : c'est le contenu qui tranche.
      { match: /afcdn/, type: 'image/jpeg', body: '<html>page de connexion</html>' },
    ];
    const { json } = await post({ url: 'https://www.marmiton.org/r.aspx', recipeId: 'r1' });
    assert.equal(json.photoId, null);
    assert.ok(json.warnings.some((w: string) => /photo/i.test(w)));
  });
});

describe('pages qui ne conviennent pas', () => {
  // Adresse de documentation (TEST-NET-3, RFC 5737) : publique du point de vue
  // du garde, donc pas de résolution DNS, donc aucun test qui flanche le jour où
  // la CI n'a pas de réseau. Le `fetch` reste bouchonné : rien ne part.
  const HOTE = 'https://203.0.113.10';

  it('refuse une page sans recette, en disant quoi vérifier', async () => {
    routes = [{ match: /203\.0\.113/, type: 'text/html', body: '<html><body>un article</body></html>' }];
    const { status, json } = await post({ url: HOTE + '/article', recipeId: 'r1' });
    assert.equal(status, 422);
    assert.match(json.error, /page d’une recette/);
  });

  it('refuse un lien qui ne pointe pas sur une page web', async () => {
    routes = [{ match: /203\.0\.113/, type: 'application/pdf', body: '%PDF-1.7' }];
    const { status, json } = await post({ url: HOTE + '/r.pdf', recipeId: 'r1' });
    assert.equal(status, 422);
    assert.match(json.error, /pas sur une page web/);
  });

  it('traduit les refus du site en langage utile', async () => {
    routes = [{ match: /203\.0\.113/, status: 403, type: 'text/html', body: 'no' }];
    const { status, json } = await post({ url: HOTE + '/r', recipeId: 'r1' });
    assert.equal(status, 422);
    assert.match(json.error, /refuse la lecture automatique/);
  });

  it('refuse une adresse du réseau local avant tout appel', async () => {
    const { status, json } = await post({ url: 'http://192.168.1.1/x', recipeId: 'r1' });
    assert.equal(status, 422);
    assert.match(json.error, /réseau local/);
    assert.deepEqual(calls, [], 'aucun appel ne doit partir');
  });

  it('refuse une requête sans adresse', async () => {
    const { status, json } = await post({ recipeId: 'r1' });
    assert.equal(status, 400);
    assert.match(json.error, /Collez l’adresse/);
  });
});

describe('interrupteur de configuration', () => {
  it('coupé, la route refuse et n’ouvre aucune connexion', async () => {
    process.env.FOYER_RECIPE_IMPORT = 'false';
    routes = [{ match: /marmiton/, type: 'text/html', body: pageWith(FIXTURE) }];
    const { status, json } = await post({ url: 'https://www.marmiton.org/r.aspx', recipeId: 'r1' });
    assert.equal(status, 503);
    assert.match(json.error, /FOYER_RECIPE_IMPORT/);
    assert.deepEqual(calls, []);
  });
});
