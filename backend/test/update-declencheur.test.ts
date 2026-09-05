// Le fichier déclencheur est une frontière de privilège.
//
// Le service, non privilégié, l'écrit ; `deploy/lxc/self-update.sh`, exécuté
// **en root** par systemd, le lit et se sert de son contenu dans des URL et dans
// « git clone --branch ». Un service compromis y écrirait volontiers autre chose
// qu'un numéro de version. Le filtre du script est donc éprouvé ici, tel qu'il
// est écrit dans le script (extrait du fichier, pas recopié : une recopie
// dériverait sans que rien ne le dise).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const SCRIPT = path.join(__dirname, '..', '..', 'deploy', 'lxc', 'self-update.sh');
const src = fs.readFileSync(SCRIPT, 'utf8');

/** Le motif que le script utilise réellement, pris dans sa ligne WANT=. */
const motif = (/^WANT=.*grep -oP '([^']+)'/m.exec(src) || [])[1];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-decl-'));

/** Ce que le script retiendrait du contenu donné. */
function retenu(contenu: string): string {
  const f = path.join(dir, 'trigger');
  fs.writeFileSync(f, contenu);
  try { return execFileSync('grep', ['-oP', motif, f], { encoding: 'utf8' }).split('\n')[0]; }
  catch { return ''; }
}

describe('déclencheur de mise à jour : ce que le script accepte de root', () => {
  it('le motif est bien celui du script installé', () => {
    assert.ok(motif, 'la ligne WANT= de self-update.sh est introuvable : ce test ne vérifie plus rien');
    assert.match(src, /if \[ -n "\$WANT" \]/, 'le tag lu doit bien être celui qui est installé');
  });

  it('retient un tag de version, préversion comprise', () => {
    assert.equal(retenu('tag=v1.3.0-rc1\n'), 'v1.3.0-rc1');
    assert.equal(retenu('tag=1.2.0\n'), '1.2.0');
    assert.equal(retenu('tag=v2.0.0+build7\n'), 'v2.0.0+build7');
  });

  it('ignore l’ancien contenu, pour que les deux versions du couple coexistent', () => {
    // Avant, le déclencheur portait un horodatage. Un serveur à jour face à un
    // helper ancien, ou l'inverse, ne doit rien casser : le script retombe alors
    // sur sa propre recherche de version.
    assert.equal(retenu('1757068800000'), '');
  });

  it('refuse tout ce qui n’est pas un numéro de version', () => {
    for (const mechant of [
      'tag=$(id)\n',
      'tag=`id`\n',
      'tag=v1.0.0;rm -rf /\n',
      'tag=v1.0.0 --upload-pack=touch /tmp/x\n',
      'tag=../../../etc/passwd\n',
      'tag=v1.0.0 $(id)\n',
      'tag=https://ailleurs.example/x\n',
      'tag=\n',
    ]) {
      const r = retenu(mechant);
      assert.ok(!r || /^v?\d[\w.+-]*$/.test(r), `« ${mechant.trim()} » a laissé passer « ${r} »`);
    }
  });

  it('ne lit pas une ligne qui ne commence pas par tag=', () => {
    assert.equal(retenu('# tag=v9.9.9\n'), '');
    assert.equal(retenu('autre=v9.9.9\n'), '');
  });
});
