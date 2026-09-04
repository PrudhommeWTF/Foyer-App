// La surface HTTP des fichiers du foyer, bout en bout.
//
// Ce qui est vérifié ici est la frontière entre deux besoins opposés : une photo
// de recette doit être une image, un document de famille peut être à peu près
// n'importe quoi. Se tromper de sens d'un côté laisse passer un PDF déguisé en
// photo, de l'autre refuse un .odt que quelqu'un voulait ranger.
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
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
/** Un .odt est une archive ZIP, que le détecteur partagé ne nomme pas. */
const ODT = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 3)]);
const INCONNU = Buffer.from('note libre sans en-tête reconnaissable, mais parfaitement légitime');

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
  it('range un document et rend sa fiche', async () => {
    const { status, json } = await put('document', 'd1', 'Passeport.pdf', PDF);
    assert.equal(status, 201);
    assert.equal(json.file.ownerKind, 'document');
    assert.equal(json.file.ownerId, 'd1');
    assert.equal(json.file.mime, 'application/pdf');
    assert.equal(json.file.size, PDF.length);
  });

  it('accepte un document dont le format n’est pas reconnu, sous un type neutre', async () => {
    // Le refuser le laisserait en data-URL dans l'état : exactement la dette
    // que ce module solde.
    const { status, json } = await put('document', 'd1', 'Notes.txt', INCONNU);
    assert.equal(status, 201);
    assert.equal(json.file.mime, 'application/octet-stream');
    assert.equal(json.file.name, 'Notes.txt', 'le nom porte l’extension, à défaut du type');
  });

  it('accepte une bureautique, que le détecteur ne cherche pas à nommer', async () => {
    // Le détecteur reste celui des pièces Finances, où « je ne reconnais pas
    // ces octets » doit rester un refus. L'élargir ferait accepter un .docx en
    // pièce comptable, ce que le message d'erreur là-bas n'annonce pas.
    const { status, json } = await put('document', 'd1', 'Bail.odt', ODT);
    assert.equal(status, 201);
    assert.equal(json.file.mime, 'application/octet-stream');
  });

  it('refuse toujours un PDF posé comme photo de recette', async () => {
    const { status, json } = await put('recipe', 'r1', 'gratin.jpg', PDF);
    assert.equal(status, 415);
    assert.match(json.error, /Formats acceptés/);
  });

  it('refuse un genre de rattachement inconnu', async () => {
    const { status, json } = await put('facture', 'x1', 'a.pdf', PDF);
    assert.equal(status, 400);
    assert.match(json.error, /recipe, document/);
  });

  it('des octets identiques dans deux modules ne coûtent qu’un fichier', async () => {
    const a = await put('recipe', 'r1', 'photo.png', PNG);
    const b = await put('document', 'd1', 'copie.png', PNG);
    assert.equal(b.json.deduplicated, true);
    assert.notEqual(a.json.file.id, b.json.file.id, 'deux fiches, un seul fichier');
  });
});

describe('service', () => {
  it('affiche un PDF dans l’onglet et propose le reste au téléchargement', async () => {
    const pdf = (await put('document', 'd1', 'Passeport.pdf', PDF)).json.file;
    const autre = (await put('document', 'd1', 'Notes.txt', INCONNU)).json.file;

    const rp = await fetch(`${base}/files/${pdf.id}`);
    assert.equal(rp.status, 200);
    assert.match(rp.headers.get('content-disposition')!, /^inline;/);
    assert.equal(rp.headers.get('x-content-type-options'), 'nosniff');

    // Des octets qu'on ne sait pas nommer ne sont jamais rendus dans l'origine
    // de l'application : ce serait la porte ouverte à une page déposée en pièce.
    const ra = await fetch(`${base}/files/${autre.id}`);
    assert.match(ra.headers.get('content-disposition')!, /^attachment;/);
  });

  it('rend les octets déposés, à l’identique', async () => {
    const f = (await put('document', 'd1', 'Notes.txt', INCONNU)).json.file;
    const res = await fetch(`${base}/files/${f.id}`);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), INCONNU);
  });

  it('distingue le fichier inconnu du fichier absent du disque', async () => {
    const f = (await put('document', 'd1', 'Passeport.pdf', PDF)).json.file;
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
    const f = (await put('document', 'd1', 'Passeport.pdf', PDF)).json.file;
    const res = await fetch(`${base}/files/${f.id}`, { method: 'DELETE' });
    assert.equal(res.status, 204);
    assert.equal(files.get(f.id), null);
    assert.equal((await fetch(`${base}/files/${f.id}`)).status, 404);
  });

  it('garde les octets tant qu’une autre fiche les réclame', async () => {
    const a = (await put('recipe', 'r1', 'photo.png', PNG)).json.file;
    const b = (await put('document', 'd1', 'copie.png', PNG)).json.file;
    await fetch(`${base}/files/${b.id}`, { method: 'DELETE' });
    // La photo de recette doit survivre à la suppression du document.
    assert.equal((await fetch(`${base}/files/${a.id}`)).status, 200);
  });

  it('répond franchement sur un fichier déjà parti', async () => {
    assert.equal((await fetch(`${base}/files/9999`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/files/zero`, { method: 'DELETE' })).status, 400);
  });
});
