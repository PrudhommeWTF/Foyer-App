// La règle de l'invitation d'accueil : les combinaisons état du canal, app
// installée, report. Ce qui compte, c'est qu'un canal déjà « on » ne repropose
// rien, qu'un iPhone non installé (« install ») reste muet sur l'accueil, et
// qu'un report tienne jusqu'à son terme mais pas au-delà.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pushInviteVisible } from './push-invite';

const NOW = Date.parse('2026-09-10T12:00:00Z');
const FUTUR = NOW + 3 * 24 * 60 * 60 * 1000;
const PASSE = NOW - 24 * 60 * 60 * 1000;

test('canal éteint, installé, sans report : on propose', () => {
  assert.equal(pushInviteVisible('off', true, 0, NOW), true);
});

test('canal éteint, installé, report en cours : on ne propose pas', () => {
  assert.equal(pushInviteVisible('off', true, FUTUR, NOW), false);
});

test('canal éteint, installé, report dépassé : on repropose', () => {
  assert.equal(pushInviteVisible('off', true, PASSE, NOW), true);
});

test('canal éteint mais app non installée : rien sur l’accueil', () => {
  assert.equal(pushInviteVisible('off', false, 0, NOW), false);
});

test('canal déjà activé : rien à proposer', () => {
  assert.equal(pushInviteVisible('on', true, 0, NOW), false);
});

test('iPhone non installé (« install ») : muet sur l’accueil', () => {
  assert.equal(pushInviteVisible('install', false, 0, NOW), false);
  assert.equal(pushInviteVisible('install', true, 0, NOW), false);
});

test('canal indisponible ou refusé : rien', () => {
  assert.equal(pushInviteVisible('unsupported', true, 0, NOW), false);
  assert.equal(pushInviteVisible('denied', true, 0, NOW), false);
  assert.equal(pushInviteVisible('checking', true, 0, NOW), false);
});
