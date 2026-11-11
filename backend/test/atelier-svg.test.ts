// Le nettoyage des SVG de l'Atelier : ce qui doit disparaître d'un dessin, ce qui
// doit y rester, et ce qui fait refuser le fichier. Un oubli ici n'échoue pas
// bruyamment : il laisse un script dormir dans le dessin d'un enfant.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeSvg } from '../src/atelier/svg';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const propre = (s: string): string => { const r = sanitizeSvg(s); assert.ok(r.ok, r.ok ? '' : r.error); return r.ok ? r.svg : ''; };

describe('nettoyage d’un SVG', () => {
  it('garde un dessin ordinaire tel qu’il est', () => {
    const dessin = `<svg ${NS} viewBox="0 0 120 152" width="120px" height="152px"><g id="a"><path d="M0 0 L10 10 C1 2 3 4 5 6 Z" fill="#F2B544" stroke-width="3"/></g></svg>`;
    assert.equal(propre(dessin), dessin);
  });

  it('retire les scripts, avec leur contenu', () => {
    const r = propre(`<svg ${NS}><script>alert(1)</script><script href="x.js"/><path d="M0 0"/></svg>`);
    assert.equal(r, `<svg ${NS}><path d="M0 0"/></svg>`);
  });

  it('retire les gestionnaires d’événements, quelle que soit la casse', () => {
    const r = propre(`<svg ${NS} onload="x()"><path d="M0 0" onclick="x()" ONMOUSEOVER="x()" fill="red"/></svg>`);
    assert.equal(r, `<svg ${NS}><path d="M0 0" fill="red"/></svg>`);
  });

  it('retire foreignObject et tout élément inconnu, avec ce qu’ils contiennent', () => {
    const r = propre(`<svg ${NS}><foreignObject><div><path d="M1 1"/></div></foreignObject><iframe src="x"/><a href="#x"><path d="M2 2"/></a><path d="M0 0"/></svg>`);
    assert.equal(r, `<svg ${NS}><path d="M0 0"/></svg>`);
  });

  it('ne laisse aucun lien sortir du document', () => {
    const r = propre(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://exemple.fr/a.png"/><image href="//exemple.fr/a.png"/><image xlink:href="javascript:alert(1)"/><use href="#forme"/></svg>`);
    assert.ok(!/exemple|javascript/.test(r));
    assert.ok(!r.includes('<use'));
  });

  it('garde une photo embarquée et un renvoi interne', () => {
    const r = propre(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><defs><clipPath id="c"><path d="M0 0"/></clipPath></defs><image xlink:href="data:image/jpeg;base64,AAAA" clip-path="url(#c)"/></svg>`);
    assert.ok(r.includes('xlink:href="data:image/jpeg;base64,AAAA"'));
    assert.ok(r.includes('clip-path="url(#c)"'));
  });

  it('refuse une image embarquée qui n’est pas une photo', () => {
    const r = propre(`<svg ${NS}><image href="data:image/svg+xml;base64,AAAA"/><image href="data:text/html,x"/></svg>`);
    assert.ok(!r.includes('data:'));
  });

  it('retire un style qui charge une ressource ou exécute', () => {
    const r = propre(`<svg ${NS}><path style="fill:url(http://x.fr/a)" d="M0 0"/><path style="width:expression(alert(1))"/><path style="fill:url(#g)"/></svg>`);
    assert.ok(!/x\.fr|expression/.test(r));
    assert.ok(r.includes('style="fill:url(#g)"'));
  });

  it('retire prologue, type de document et commentaires', () => {
    const r = propre(`<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><!-- Generator: x --><svg ${NS}><path d="M0 0"/></svg>`);
    assert.equal(r, `<svg ${NS}><path d="M0 0"/></svg>`);
  });

  it('refuse les entités, les sections CDATA et ce qui n’est pas bien formé', () => {
    for (const mauvais of [
      `<!DOCTYPE svg [<!ENTITY x "y">]><svg ${NS}/>`,
      `<svg ${NS}><![CDATA[<script>x</script>]]></svg>`,
      `<svg ${NS}><path d="M0 0"></svg>`,
      `<svg ${NS}><path d="M0 0"`,
      `<svg ${NS}><g>`,
      '<html><body>bonjour</body></html>',
      'bonjour',
    ]) assert.equal(sanitizeSvg(mauvais).ok, false, mauvais);
  });

  it('rend toujours un document reconstruit, jamais l’entrée', () => {
    const r = propre(`<svg ${NS}><text x="1">a < b</text></svg>`.replace('a < b', 'a &lt; b &amp; c'));
    assert.ok(r.includes('a &lt; b &amp; c'));
    assert.ok(propre(`<svg ${NS}><path d="a&b"/></svg>`).includes('d="a&amp;b"'));
  });
});
