// L'image Docker ne se publie qu'avec une release, sur un tag v*.
//
// Jusqu'à la 1.17.0, docker.yml poussait aussi « latest » à chaque merge sur
// main : un foyer sur « latest » recevait du code jamais tagué, et le tag
// publiait l'image une deuxième fois. La publication vit désormais dans
// release.yml, derrière les mêmes contrôles que les archives. Ce test lit les
// workflows eux-mêmes (pas une recopie) pour qu'un autre fichier qui
// redemanderait le droit d'écrire au registre se voie.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const DIR = path.join(__dirname, '..', '..', '.github', 'workflows');
const workflows = fs.readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n));
const release = fs.readFileSync(path.join(DIR, 'release.yml'), 'utf8');

/** Les lignes d'un job, de son en-tête au job suivant. */
function job(src: string, id: string): string {
  const m = new RegExp(`^  ${id}:\\n((?:(?!  \\S).*\\n|\\n)*)`, 'm').exec(src);
  assert.ok(m, `job « ${id} » introuvable dans release.yml`);
  return m[1];
}

describe('publication de l’image Docker', () => {
  it('seul release.yml peut écrire au registre', () => {
    for (const f of workflows) {
      if (f === 'release.yml') continue;
      const src = fs.readFileSync(path.join(DIR, f), 'utf8');
      assert.doesNotMatch(src, /packages:\s*write/, `${f} demande packages: write`);
      assert.doesNotMatch(src, /docker\/build-push-action/, `${f} construit une image`);
    }
  });

  it('release.yml ne se déclenche que sur un tag v*', () => {
    const on = /^on:\n((?: .*\n)+)/m.exec(release)?.[1] || '';
    assert.match(on, /^ {4}tags: \['v\*'\]$/m);
    assert.doesNotMatch(on, /branches|workflow_dispatch|pull_request|schedule/);
  });

  it('packages: write reste limité aux jobs de l’image et de l’index', () => {
    const top = release.slice(0, release.indexOf('\njobs:'));
    assert.doesNotMatch(top, /^\s*packages:/m);
    for (const id of ['tag', 'checks', 'build', 'publish']) assert.doesNotMatch(job(release, id), /packages:/, id);
    for (const id of ['image', 'manifest']) assert.match(job(release, id), /packages: write/, id);
  });

  it('les étiquettes et la release attendent que tout ait réussi', () => {
    assert.match(job(release, 'image'), /needs: \[tag, checks\]/);
    assert.match(job(release, 'image'), /push-by-digest=true/);
    assert.match(job(release, 'manifest'), /needs: \[tag, build, image\]/);
    assert.match(job(release, 'publish'), /needs: \[tag, build, manifest\]/);
  });

  it('chaque architecture se construit sur son runner natif, sans émulation', () => {
    // Plus de QEMU : son émulation arm64 de « npm ci » se figeait. Chaque archi
    // part sur sa machine, et l'index les réunit.
    assert.doesNotMatch(release, /setup-qemu-action/);
    const img = job(release, 'image');
    assert.match(img, /ubuntu-24\.04-arm/);
    assert.match(img, /platforms: linux\/\$\{\{ matrix\.arch \}\}/);
    assert.match(job(release, 'manifest'), /imagetools create/);
  });

  it('une préversion ne reçoit ni latest, ni mineure, ni majeure', () => {
    const tags = job(release, 'manifest').split('\n').filter((l) => /type=(semver|raw)/.test(l));
    for (const l of tags) {
      if (/pattern=\{\{version\}\}/.test(l)) continue;
      const cond = /enable=\$\{\{ needs\.tag\.outputs\.prerelease (!=|==) 'true' \}\}/.exec(l)?.[1];
      if (/value=next/.test(l)) assert.equal(cond, '==', l);
      else assert.equal(cond, '!=', `${l.trim()} doit être réservée aux versions stables`);
    }
    assert.match(job(release, 'manifest'), /flavor: latest=false/);
  });
});
