// Le registre des exercices du module Révisions existe en deux copies, une par
// paquet : ici, où le serveur refait la correction et calcule les clés de
// maîtrise, et dans l'application, où l'exercice tourne hors ligne. Deux copies
// qui divergent, ce serait deux corrections : une réponse jugée juste à l'écran
// compterait fausse au serveur. Ce test refuse la moindre différence, fichier
// par fichier, et un fichier présent d'un seul côté.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.join(__dirname, '..', '..');
const BACK = path.join(ROOT, 'backend', 'src', 'revisions', 'exercises');
const FRONT = path.join(ROOT, 'frontend', 'src', 'app', 'core', 'revisions', 'exercises');
const files = (dir: string): string[] => fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();

test('les deux registres d’exercices ont les mêmes fichiers', () => {
  assert.deepEqual(files(FRONT), files(BACK), 'un exercice ajouté d’un côté doit l’être de l’autre : cp backend/src/revisions/exercises/*.ts frontend/src/app/core/revisions/exercises/');
});

test('chaque fichier est identique octet pour octet', () => {
  for (const f of files(BACK)) {
    assert.ok(fs.readFileSync(path.join(BACK, f)).equals(fs.readFileSync(path.join(FRONT, f))),
      `${f} diffère entre backend/src/revisions/exercises et frontend/src/app/core/revisions/exercises.\n` +
      'Modifiez l’un, puis copiez-le sur l’autre : cp backend/src/revisions/exercises/*.ts frontend/src/app/core/revisions/exercises/');
  }
});

test('le registre n’importe rien hors de son dossier : il reste copiable tel quel', () => {
  for (const f of files(BACK)) {
    for (const m of fs.readFileSync(path.join(BACK, f), 'utf8').matchAll(/^\s*import\s[^;]*from\s+'([^']+)'/gm)) {
      assert.match(m[1], /^\.\/[\w-]+$/, `${f} importe ${m[1]}`);
    }
  }
});
