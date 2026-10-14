// Les fiches de l'employé : une présence inchangée n'envoie rien, un taux se lit à la française.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { EmpShift } from './employes.api';
import { parseRate, shiftFields, shiftPatch, stepMinutes } from './employe-form';

const s: EmpShift = { id: 7, employeeId: 1, day: '2026-10-14', minutes: 180, note: 'grand ménage', createdAt: '', createdBy: 'me', createdVia: null, updatedAt: null, updatedBy: null, updatedVia: null };

test('présence ouverte puis enregistrée telle quelle : aucun champ envoyé', () => {
  assert.deepEqual(shiftPatch(s, shiftFields(s, { day: '', minutes: 0 })), {});
  assert.deepEqual(shiftPatch(s, { ...shiftFields(s, { day: '', minutes: 0 }), minutes: 195, note: ' ' }), { minutes: 195, note: '' });
});

test('le pas reste entre un quart d’heure et une journée', () => {
  assert.equal(stepMinutes(15, -15), 15);
  assert.equal(stepMinutes(1440, 15), 1440);
  assert.equal(stepMinutes(180, 15), 195);
});

test('un taux se tape avec une virgule ; vide ou hors bornes, il n’y en a pas', () => {
  assert.equal(parseRate('14,50'), 14.5);
  assert.equal(parseRate(12), 12);
  assert.equal(parseRate(''), null);
  assert.equal(parseRate(null), null);
  assert.equal(parseRate('150'), null);
  assert.equal(parseRate('abc'), null);
});
