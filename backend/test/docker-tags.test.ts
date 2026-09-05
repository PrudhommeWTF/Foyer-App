// L'image Docker est-elle construite pour les versions qu'on publie vraiment ?
//
// Le workflow ne filtrait que « v* », et les tags de release de ce dépôt
// s'appellent « 0.0.46 », sans « v ». Résultat : 46 releases, et pas une seule
// image versionnée sur GHCR. Rien ne le signalait, parce qu'un workflow qui ne
// se déclenche pas ne rate pas, il n'existe simplement pas ce jour-là.
//
// Ce test lit le filtre dans le workflow (pas une recopie : une recopie
// dériverait en silence) et vérifie qu'il attrape les deux conventions de nom.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'docker.yml');
const src = fs.readFileSync(WORKFLOW, 'utf8');

/** Les motifs de la ligne « tags: [...] » du déclencheur. */
const motifs: string[] = (/^\s*tags: \[(.+)\]\s*$/m.exec(src)?.[1] || '')
  .split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);

/**
 * Un filtre GitHub Actions, traduit en expression régulière.
 *
 * Sous-ensemble documenté qui nous concerne : `*` (tout sauf « / »), `**`
 * (tout), `?` (un caractère), et les classes `[…]`. Le reste est littéral.
 */
function versRegex(motif: string): RegExp {
  let out = '';
  for (let i = 0; i < motif.length; i++) {
    const c = motif[i];
    if (c === '[') { const j = motif.indexOf(']', i); if (j > i) { out += motif.slice(i, j + 1); i = j; continue; } }
    if (c === '*') { if (motif[i + 1] === '*') { out += '.*'; i++; } else out += '[^/]*'; continue; }
    if (c === '?') { out += '[^/]'; continue; }
    out += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$');
}

const attrape = (tag: string): boolean => motifs.some((m) => versRegex(m).test(tag));

describe('workflow Docker : le filtre de tags', () => {
  it('est bien lu dans le fichier', () => {
    assert.ok(motifs.length, 'la ligne « tags: [...] » du déclencheur est introuvable : ce test ne vérifie plus rien');
  });

  it('attrape les tags de release de ce dépôt, qui n’ont pas de préfixe', () => {
    // Les noms réellement publiés sur GitHub : 0.0.9 … 0.0.46.
    for (const tag of ['0.0.9', '0.0.46', '0.0.47', '1.0.0', '0.1.0-rc1']) {
      assert.ok(attrape(tag), `le tag « ${tag} » ne déclencherait aucune construction d’image`);
    }
  });

  it('garde valables les tags préfixés, au cas où', () => {
    for (const tag of ['v1.2.3', 'v0.0.47']) assert.ok(attrape(tag), tag);
  });

  it('ne se déclenche pas sur n’importe quoi', () => {
    for (const tag of ['nightly', 'derniere-bonne', 'release']) {
      assert.equal(attrape(tag), false, `« ${tag} » n’est pas une version et ne doit rien construire`);
    }
  });
});
