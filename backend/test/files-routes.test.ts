// La surface HTTP des fichiers du foyer, bout en bout.
//
// Depuis le retrait du module Documents, le seul genre de propriétaire encore
// accepté est la photo de recette : le détecteur lit les octets, et une photo
// doit être une image. Un PDF déguisé en photo est refusé, un genre de
// rattachement inconnu aussi.
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
import { filesRouter } from '../src/storage/routes';

let server: http.Server;
let base: string;
let dir: string;

/** En-têtes minuscules mais authentiques : le détecteur lit les octets. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PNG2 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

const put = async (owner: string, id: string, name: string, body: Buffer) => {
  const res = await fetch(`${base}/files?owner=${owner}&id=${encodeURIComponent(id)}&filename=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(body),
  });
  return { status: res.status, json: res.status === 204 ? null : await res.json() };
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-fic-'));
  const db = new Database(':memory:');
  initBlobs(dir);
  migrateHousehold(db);
  files.initFiles(db);

  const app = express();
  // La limite du foyer, ici généreuse : ce fichier éprouve les types acceptés,
  // pas la taille. Le plafond du serveur, lui, reste celui du routeur.
  app.use('/api/files', filesRouter(() => 20 * 1024 * 1024));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api';
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('dépôt', () => {
  it('range une photo de recette et rend sa fiche', async () => {
    const { status, json } = await put('recipe', 'r1', 'gratin.png', PNG);
    assert.equal(status, 201);
    assert.equal(json.file.ownerKind, 'recipe');
    assert.equal(json.file.ownerId, 'r1');
    assert.equal(json.file.mime, 'image/png');
    assert.equal(json.file.size, PNG.length);
  });

  it('refuse un PDF posé comme photo de recette', async () => {
    const { status, json } = await put('recipe', 'r1', 'gratin.jpg', PDF);
    assert.equal(status, 415);
    assert.match(json.error, /Formats acceptés/);
  });

  it('refuse un genre de rattachement inconnu', async () => {
    const { status, json } = await put('document', 'x1', 'a.pdf', PDF);
    assert.equal(status, 400);
    assert.match(json.error, /recipe/);
  });

  it('des octets identiques dans deux fiches ne coûtent qu’un fichier', async () => {
    const a = await put('recipe', 'r1', 'photo.png', PNG);
    const b = await put('recipe', 'r2', 'copie.png', PNG);
    assert.equal(b.json.deduplicated, true);
    assert.notEqual(a.json.file.id, b.json.file.id, 'deux fiches, un seul fichier');
  });
});

describe('service', () => {
  it('affiche une photo dans l’onglet', async () => {
    const png = (await put('recipe', 'r1', 'gratin.png', PNG)).json.file;
    const rp = await fetch(`${base}/files/${png.id}`);
    assert.equal(rp.status, 200);
    assert.match(rp.headers.get('content-disposition')!, /^inline;/);
    assert.equal(rp.headers.get('x-content-type-options'), 'nosniff');
  });

  it('rend les octets déposés, à l’identique', async () => {
    const f = (await put('recipe', 'r1', 'gratin.png', PNG)).json.file;
    const res = await fetch(`${base}/files/${f.id}`);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  });

  it('distingue le fichier inconnu du fichier absent du disque', async () => {
    const f = (await put('recipe', 'r1', 'gratin.png', PNG)).json.file;
    assert.equal((await fetch(`${base}/files/9999`)).status, 404);

    // Une restauration incomplète : la fiche existe, les octets non. Le message
    // doit dire quoi faire, pas seulement que ça a raté.
    fs.rmSync(path.join(dir, 'pieces'), { recursive: true, force: true });
    const res = await fetch(`${base}/files/${f.id}`);
    assert.equal(res.status, 410);
    assert.match((await res.json()).error, /pieces/);
  });
});

describe('suppression', () => {
  it('retire la fiche et rend les octets au disque', async () => {
    const f = (await put('recipe', 'r1', 'gratin.png', PNG)).json.file;
    const res = await fetch(`${base}/files/${f.id}`, { method: 'DELETE' });
    assert.equal(res.status, 204);
    assert.equal(files.get(f.id), null);
    assert.equal((await fetch(`${base}/files/${f.id}`)).status, 404);
  });

  it('garde les octets tant qu’une autre fiche les réclame', async () => {
    const a = (await put('recipe', 'r1', 'photo.png', PNG)).json.file;
    const b = (await put('recipe', 'r2', 'copie.png', PNG)).json.file;
    await fetch(`${base}/files/${b.id}`, { method: 'DELETE' });
    // La première photo doit survivre à la suppression de la seconde.
    assert.equal((await fetch(`${base}/files/${a.id}`)).status, 200);
  });

  it('répond franchement sur un fichier déjà parti', async () => {
    // Un dépôt pour créer le répertoire, puis une suppression sur un identifiant
    // qui n'existe pas, et sur un identifiant qui n'en est pas un.
    await put('recipe', 'r1', 'gratin.png', PNG2);
    assert.equal((await fetch(`${base}/files/9999`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/files/zero`, { method: 'DELETE' })).status, 400);
  });
});
