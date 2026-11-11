// Le garde-fou du build de l'Atelier : ce qu'il doit refuser, et ce qu'il ne
// doit pas prendre pour une faute. Sans ces tests, un motif trop lâche laisserait
// passer une adresse extérieure en gardant le build vert.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { infractions } from './build-atelier.mjs';

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
