// Le moteur de récurrence existe en deux copies, une par paquet, parce que le
// frontend et le backend ne partagent aucun code (voir l'en-tête du fichier).
// Deux copies qui divergent, ce serait deux moteurs : un geste noté par
// l'assistant ne reviendrait pas à la même date qu'un geste coché à l'écran.
// Ce test refuse la moindre différence, et vérifie au passage que la copie du
// serveur calcule bien ce qu'on attend d'elle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { nextOccurrence } from '../src/tasks/recurrence';

const ROOT = path.join(__dirname, '..', '..');
const BACK = path.join(ROOT, 'backend', 'src', 'tasks', 'recurrence.ts');
const FRONT = path.join(ROOT, 'frontend', 'src', 'app', 'core', 'recurrence.ts');

test('les deux copies du moteur de récurrence sont identiques octet pour octet', () => {
  assert.ok(fs.readFileSync(BACK).equals(fs.readFileSync(FRONT)),
    'backend/src/tasks/recurrence.ts et frontend/src/app/core/recurrence.ts doivent être identiques.\n' +
    'Modifiez l’un, puis copiez-le sur l’autre : cp frontend/src/app/core/recurrence.ts backend/src/tasks/recurrence.ts');
});

test('le moteur n’importe rien : il reste copiable tel quel', () => {
  assert.doesNotMatch(fs.readFileSync(BACK, 'utf8'), /^\s*import\s/m);
});

test('après la réalisation : la cadence repart du jour du geste, pas de la date prévue', () => {
  const rec = { freq: 'weekly' as const, every: 4, base: 'done' as const };
  assert.equal(nextOccurrence(rec, '2026-10-17', '2026-10-17'), '2026-11-14');
  // Fait le 20/11 alors que c'était prévu le 14/11 : la suivante est le 18/12, pas le 12/12.
  assert.equal(nextOccurrence(rec, '2026-11-14', '2026-11-20'), '2026-12-18');
});

test('le calcul ne dépend pas du fuseau du serveur', () => {
  const rec = { freq: 'monthly' as const, every: 6, base: 'done' as const };
  // Le passage à l'heure d'hiver (dernier dimanche d'octobre) ne décale aucun jour.
  assert.equal(nextOccurrence(rec, '2026-10-25', '2026-10-25'), '2027-04-25');
  assert.equal(nextOccurrence({ freq: 'daily', every: 1, base: 'done' }, '2026-10-25', '2026-10-25'), '2026-10-26');
});
