// Le garde-fou du build de l'Atelier : ce qu'il doit refuser, et ce qu'il ne
// doit pas prendre pour une faute. Sans ces tests, un motif trop lâche laisserait
// passer une adresse extérieure en gardant le build vert.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HOTES_INERTES, hotesInconnus, infractions } from './build-atelier.mjs';

describe('contrôles du bundle de l’Atelier', () => {
  it('refuse une adresse extérieure, avec ou sans protocole', () => {
    assert.equal(infractions('app.bundle.js', 'fetch("https://scratch.mit.edu/x")').length, 1);
    assert.equal(infractions('font.css', 'src: url(http://fonts.gstatic.com/s/roboto.woff2)').length, 1);
    assert.equal(infractions('a.js', 'load("//cdn.jsdelivr.net/npm/x")').length, 1);
  });

  it('accepte les espaces de noms XML, qui ne sont pas contactés', () => {
    assert.deepEqual(infractions('app.bundle.js', 'createElementNS("http://www.w3.org/2000/svg","path")'), []);
    assert.deepEqual(infractions('Farm.svg', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"/>'), []);
    assert.deepEqual(infractions('a.svg', '<svg xmlns:i="http://ns.adobe.com/AdobeIllustrator/10.0/"/>'), []);
  });

  it('ne tolère un espace de noms d’outil de dessin que dans un SVG', () => {
    assert.equal(infractions('app.bundle.js', 'x="http://ns.adobe.com/AdobeIllustrator/10.0/"').length, 1);
  });

  it('refuse eval et new Function dans le code', () => {
    assert.ok(infractions('app.bundle.js', 'r+=eval(e)').includes('eval ou new Function'));
    assert.ok(infractions('app.bundle.js', 'var f=new Function("a","return a")').includes('eval ou new Function'));
    assert.deepEqual(infractions('app.bundle.js', 'medieval(x);retrieval (y)'), []);
  });

  it('refuse le SQL construit côté client', () => {
    for (const sql of ["'select * from projects where id = ?'", "'insert into usershapes ('", "'delete from '+t", "'update '+db+' set '", "'update projects set name = ?'"]) {
      assert.ok(infractions('app.bundle.js', sql).includes('instruction SQL'), sql);
    }
    assert.deepEqual(infractions('app.bundle.js', 'e.select();t.update(n);set.delete(from)'), []);
  });

  it('refuse un reste de statistiques d’usage', () => {
    assert.equal(infractions('app.bundle.js', 'OS.analyticsEvent("editor","open")').length, 1);
    assert.equal(infractions('x.html', '<script src="firebase.js"></script>').length, 1);
  });

  it('refuse un SVG qui exécuterait quelque chose', () => {
    assert.equal(infractions('a.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>').length, 1);
    assert.equal(infractions('a.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>').length, 1);
    assert.equal(infractions('a.svg', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>').length, 1);
  });
});

describe('contrôle des hôtes du niveau Grands codeurs', () => {
  it('laisse passer les hôtes listés, sous toutes leurs formes', () => {
    assert.deepEqual(hotesInconnus('xmlns="http://www.w3.org/2000/svg" See https://github.com/x/y. "//fb.me/react"'), []);
  });

  it('nomme tout hôte absent de la liste', () => {
    assert.deepEqual(hotesInconnus('fetch("https://cdn.assets.scratch.mit.edu/a") new WebSocket(`wss://device-manager.scratch.mit.edu:20110/x`)'),
      ['cdn.assets.scratch.mit.edu', 'device-manager.scratch.mit.edu']);
    assert.deepEqual(hotesInconnus('s.src="//fast.wistia.com/e.js"'), ['fast.wistia.com']);
    assert.deepEqual(hotesInconnus('href="https://Scratch.MIT.edu"'), ['scratch.mit.edu']);
  });

  it('ne prend pas un chemin relatif pour une adresse', () => {
    assert.deepEqual(hotesInconnus('src="static/blocks-media/default/a.svg" import("./chunks/paper.js") url(../fonts/x.woff2) "ws://127.0.0.1:20111/x"'), []);
  });

  it('aucun serveur de Scratch, de statistiques ou de vidéo n’est dans la liste', () => {
    for (const h of Object.keys(HOTES_INERTES)) assert.ok(!/scratch|wistia|analytics|googletagmanager|firebase|jsdelivr|code\.org/.test(h), h);
  });
});

// La bibliothèque du niveau des grands : ce que ses listes citent doit exister, et
// ce que exclusions.json écarte ne doit pas y revenir par une liste modifiée à la main.
describe('bibliothèque des Grands codeurs', () => {
  const bib = fileURLToPath(new URL('../vendor/atelier/bibliotheque/', import.meta.url));
  const lire = (f) => JSON.parse(readFileSync(join(bib, f), 'utf8'));
  const listes = Object.fromEntries(['sprites', 'costumes', 'backdrops', 'sounds'].map((n) => [n, lire(`grands/${n}.json`)]));
  const exclusions = lire('exclusions.json'), noms = lire('noms.json');

  it('chaque fichier cité existe, dans la bibliothèque ou parmi ce que Foyer fournit', () => {
    const fournis = fileURLToPath(new URL('../vendor/atelier/grands/dist/bibliotheque/', import.meta.url));
    for (const liste of Object.values(listes)) {
      for (const e of liste) {
        for (const f of [e, ...(e.costumes ?? []), ...(e.sounds ?? [])]) {
          if (f.md5ext) assert.ok(existsSync(join(bib, 'fichiers', f.md5ext)) || existsSync(join(fournis, f.md5ext)), `${e.name} : ${f.md5ext} manque`);
        }
      }
    }
  });

  it('aucun nom en double dans une liste : l’éditeur retrouve l’élément choisi par son nom', () => {
    for (const [n, liste] of Object.entries(listes)) {
      const vus = liste.map((e) => e.name);
      assert.deepEqual(vus.filter((v, i) => vus.indexOf(v) !== i), [], n);
    }
  });

  it('rien de ce qui est écarté n’y figure : marques, photographies de personnes, miaulement', () => {
    const fr = (cle) => noms[cle];
    const interdits = new Set([...Object.keys(exclusions.personnages), ...Object.keys(exclusions.photographies)].map(fr).filter(Boolean));
    for (const e of listes.sprites) assert.ok(!interdits.has(e.name), e.name);
    const texte = JSON.stringify(listes);
    for (const mot of ['Meow', 'Scratch', 'Gobo', 'Pico', 'Nano', 'Giga', 'Tera']) assert.ok(!new RegExp(`"name":"${mot}\\b`).test(texte), mot);
    // Les noms d'origine des écartés n'ont pas de nom français : ils ne peuvent pas entrer
    for (const nom of [...Object.keys(exclusions.personnages), ...Object.keys(exclusions.photographies).filter((k) => k !== '_')]) assert.equal(noms[nom], undefined, nom);
  });
});

describe('défis des petits codeurs', () => {
  const dossier = join(fileURLToPath(new URL('..', import.meta.url)), 'vendor', 'atelier', 'petits');
  const defis = JSON.parse(readFileSync(join(dossier, 'www', 'defis', 'defis.json'), 'utf8'));
  const outil = readFileSync(join(dossier, 'outils', 'images-defis.cjs'), 'utf8');

  it('chaque défi a un identifiant unique, un nom, une phrase et son image', () => {
    assert.ok(defis.length > 0);
    assert.equal(new Set(defis.map((d) => d.id)).size, defis.length);
    for (const d of defis) {
      assert.match(d.id, /^[a-z0-9-]+$/);
      assert.ok(d.name && d.desc, d.id);
      assert.ok(existsSync(join(dossier, 'www', 'defis', d.image)), `image absente : ${d.image}`);
    }
  });

  it('l’outil qui prend les images connaît le script de chaque défi', () => {
    for (const d of defis) assert.ok(outil.includes(`'${d.id}': [`), `pas de script pour ${d.id}`);
  });
});
