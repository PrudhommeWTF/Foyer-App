// Mise en forme du récapitulatif « Ménage ». Le calcul du net (le taux du jour de
// chaque présence) est fait par le serveur ; ces tests protègent la présentation
// dans les unités du CESU : heures décimales à virgule, euros à virgule, et le
// détail par taux quand il change en cours de mois.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cesuSummary, decHours, eurosFmt, eurosPlain, hoursPlain, RecapLite } from './employe.format';

test('decHours : minutes vers heures décimales lisibles', () => {
  assert.equal(decHours(540), '9 h');
  assert.equal(decHours(210), '3,5 h');
  assert.equal(decHours(45), '0,75 h');
  assert.equal(decHours(0), '0 h');
});

test('eurosFmt : centimes vers euros à virgule', () => {
  assert.equal(eurosFmt(13050), '130,50 €');
  assert.equal(eurosFmt(0), '0,00 €');
  assert.equal(eurosFmt(16200), '162,00 €');
});

test('hoursPlain / eurosPlain : sans unité, pour le presse-papier CESU', () => {
  assert.equal(hoursPlain(540), '9');
  assert.equal(hoursPlain(210), '3,5');
  assert.equal(hoursPlain(45), '0,75');
  assert.equal(eurosPlain(13050), '130,50');
});

test('cesuSummary : un seul taux, pas de détail', () => {
  const r: RecapLite = { minutes: 540, netCents: 13050, buckets: [{ netHourlyCents: 1450, minutes: 540, netCents: 13050 }] };
  const s = cesuSummary(r, true);
  assert.equal(s.heures, '9 h');
  assert.equal(s.net, '130,50 €');
  assert.equal(s.conges, 'inclus dans le taux (majoration de 10 %)');
  assert.equal(s.detail, null);
});

test('cesuSummary : taux changé en cours de mois, détail par taux', () => {
  const r: RecapLite = {
    minutes: 660,
    netCents: 16200,
    buckets: [
      { netHourlyCents: 1450, minutes: 360, netCents: 8700 },
      { netHourlyCents: 1500, minutes: 300, netCents: 7500 },
    ],
  };
  const s = cesuSummary(r, false);
  assert.equal(s.heures, '11 h');
  assert.equal(s.net, '162,00 €');
  assert.equal(s.conges, 'non inclus');
  assert.equal(s.detail, '6 h à 14,50 €/h ; 5 h à 15,00 €/h');
});

test('cesuSummary : taux non réglé, net à régler', () => {
  const r: RecapLite = { minutes: 540, netCents: null, buckets: [{ netHourlyCents: null, minutes: 540, netCents: null }] };
  const s = cesuSummary(r, true);
  assert.equal(s.net, 'taux à régler');
  assert.equal(s.detail, null);
});
