// La bibliothèque ajoutée par la famille : ce qu'un dossier de SVG déposés à la
// main donne à l'Atelier. Un fichier n'est jamais servi tel qu'il a été déposé.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { familyFile, familyLibrary, loadFamilyLibrary } from '../src/atelier/library';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
let dir = '';
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-atelier-')); });
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('bibliothèque de la famille', () => {
  it('crée les dossiers et le fichier de licences au premier démarrage', () => {
    assert.deepEqual(loadFamilyLibrary(dir), { personnages: 0, decors: 0 });
    const root = path.join(dir, 'atelier', 'bibliotheque');
    for (const f of ['personnages', 'decors', 'LICENCES.md']) assert.ok(fs.existsSync(path.join(root, f)), f);
    assert.deepEqual(familyLibrary(), { sprites: [], backgrounds: [] });
  });

  it('prend les SVG déposés, nettoyés, et ignore le reste', () => {
    const root = path.join(dir, 'atelier', 'bibliotheque');
    fs.writeFileSync(path.join(root, 'personnages', 'Chat de la maison.svg'), `<svg ${NS} width="80" height="60" onload="x()"><script>x()</script><path d="M0 0"/></svg>`);
    fs.writeFileSync(path.join(root, 'personnages', 'sans-taille.svg'), `<svg ${NS}><path d="M0 0"/></svg>`);
    fs.writeFileSync(path.join(root, 'personnages', 'casse.svg'), '<svg><g>');
    fs.writeFileSync(path.join(root, 'personnages', 'photo.png'), 'pas un svg');
    fs.writeFileSync(path.join(root, 'decors', 'Jardin.svg'), `<svg ${NS} viewBox="0 0 480 360"><path d="M1 1"/></svg>`);
    fs.writeFileSync(path.join(root, 'LICENCES.md'), 'tenu à la main');
    assert.deepEqual(loadFamilyLibrary(dir), { personnages: 1, decors: 1 });
    const { sprites, backgrounds } = familyLibrary();
    assert.equal(sprites[0]!.name, 'Chat de la maison'); assert.equal(sprites[0]!.width, 80); assert.equal(sprites[0]!.height, 60);
    assert.match(sprites[0]!.md5, /^[0-9a-f]{32}\.svg$/); assert.equal(sprites[0]!.order, 'characters,00 famille');
    assert.equal(backgrounds[0]!.name, 'Jardin'); assert.equal(backgrounds[0]!.width, 480);
    assert.equal(familyFile(sprites[0]!.md5)!.toString(), `<svg ${NS} width="80" height="60"><path d="M0 0"/></svg>`);
    assert.equal(familyFile('inconnu.svg'), null);
    assert.equal(fs.readFileSync(path.join(root, 'LICENCES.md'), 'utf8'), 'tenu à la main', 'le fichier de licences n’est pas réécrit');
  });
});
