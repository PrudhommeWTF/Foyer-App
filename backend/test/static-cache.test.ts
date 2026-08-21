// Le cache d'un navigateur est le seul endroit d'où une version périmée peut
// revenir sans que rien ne soit cassé nulle part. Ces tests fixent la règle qui
// l'empêche, et le dernier vérifie qu'elle est bien émise, sur un vrai serveur.
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cacheControlFor } from '../src/static-cache';

describe('ce que le navigateur a le droit de garder', () => {
  it('garde un an les fichiers dont le nom porte une empreinte', () => {
    // Le nom change avec le contenu : les mêmes octets, toujours.
    for (const f of ['main-NDQ3IISW.js', 'styles-2OGJRZCP.css', 'chunk-ABCD1234.js']) {
      assert.match(cacheControlFor(f), /max-age=31536000/, f);
      assert.match(cacheControlFor(f), /immutable/, f);
    }
  });

  it('ne garde jamais index.html, quel que soit son chemin', () => {
    // C'est lui qui nomme les fichiers empreints : le garder, c'est garder toute
    // l'application avec, y compris après une mise à jour du serveur.
    for (const f of ['index.html', '/opt/foyer/public/index.html', 'sous/dossier/page.html']) {
      assert.equal(cacheControlFor(f), 'no-store, must-revalidate', f);
    }
  });

  it('ne confond pas un nom écrit à la main avec une empreinte', () => {
    for (const f of ['foyer-app.js', 'polyfills.js', 'theme-dark.css', 'a-b.js']) {
      assert.doesNotMatch(cacheControlFor(f), /immutable/, f);
    }
  });

  it('fait revalider tout le reste', () => {
    for (const f of ['logo.svg', 'photo.jpg', 'police.woff2', 'manifest.webmanifest']) {
      assert.equal(cacheControlFor(f), 'public, max-age=0, must-revalidate', f);
    }
  });
});

describe('les en-têtes réellement émis par le serveur', () => {
  let server: http.Server;
  let base: string;
  let dir: string;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-static-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><script src="main-NDQ3IISW.js"></script></html>');
    fs.writeFileSync(path.join(dir, 'main-NDQ3IISW.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dir, 'logo.svg'), '<svg/>');

    const app = express();
    app.use(express.static(dir, {
      index: false,
      setHeaders: (res, filePath) => res.setHeader('Cache-Control', cacheControlFor(filePath)),
    }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.sendFile(path.join(dir, 'index.html'));
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', () => r()));
    base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const cc = async (url: string): Promise<string> =>
    (await fetch(base + url)).headers.get('cache-control') || '';

  it('la racine n’est pas gardée', async () => {
    assert.equal(await cc('/'), 'no-store, must-revalidate');
  });

  it('une adresse profonde non plus : c’est le même document', async () => {
    // /repas n'est pas un fichier : l'application se charge et route ensuite.
    assert.equal(await cc('/repas'), 'no-store, must-revalidate');
  });

  it('le fichier empreint est gardé un an', async () => {
    assert.match(await cc('/main-NDQ3IISW.js'), /max-age=31536000.*immutable/);
  });

  it('le reste est revalidé', async () => {
    assert.equal(await cc('/logo.svg'), 'public, max-age=0, must-revalidate');
  });
});
