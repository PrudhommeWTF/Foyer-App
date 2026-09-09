// Les vacances scolaires en barres étalées : une plage doit couvrir ses jours
// d'un seul tenant, bornée à la fenêtre affichée, plutôt que de se répéter en
// pastille chaque jour.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SchoolHoliday, holidayBands } from './agenda';

const hol = (name: string, start: string, end: string): SchoolHoliday => ({ name, start, end, zone: 'A' });
const C = '#F0B24B';

test('une plage entièrement dans la fenêtre couvre ses jours d’un seul tenant', () => {
  const bands = holidayBands([hol('Toussaint', '2026-10-19', '2026-11-02')], '2026-10-19', '2026-10-25', C);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].col, 1);
  assert.equal(bands[0].span, 7, 'du lundi au dimanche de cette semaine');
  assert.equal(bands[0].startsHere, true);
  assert.equal(bands[0].endsHere, false, 'la plage déborde au-delà de la fenêtre');
});

test('une plage qui déborde des deux côtés est bornée à la fenêtre', () => {
  const bands = holidayBands([hol('Noël', '2026-12-19', '2027-01-04')], '2026-12-21', '2026-12-27', C);
  assert.equal(bands[0].col, 1);
  assert.equal(bands[0].span, 7);
  assert.equal(bands[0].startsHere, false);
  assert.equal(bands[0].endsHere, false);
});

test('une plage qui commence en milieu de semaine part de la bonne colonne', () => {
  // Vacances qui débutent le mercredi (3e jour) d'une semaine lundi→dimanche.
  const bands = holidayBands([hol('Hiver', '2026-02-11', '2026-02-22')], '2026-02-09', '2026-02-15', C);
  assert.equal(bands[0].col, 3, 'mercredi = 3e colonne');
  assert.equal(bands[0].span, 5, 'du mercredi au dimanche');
  assert.equal(bands[0].startsHere, true);
  assert.equal(bands[0].endsHere, false);
});

test('une plage hors de la fenêtre ne produit aucune barre', () => {
  assert.deepEqual(holidayBands([hol('Toussaint', '2026-10-19', '2026-11-02')], '2026-09-07', '2026-09-13', C), []);
});

test('la dernière semaine d’une plage finit à la bonne colonne', () => {
  const bands = holidayBands([hol('Toussaint', '2026-10-19', '2026-11-02')], '2026-11-02', '2026-11-08', C);
  assert.equal(bands[0].col, 1);
  assert.equal(bands[0].span, 1, 'seul le lundi est encore en vacances');
  assert.equal(bands[0].endsHere, true);
});

test('deux plages qui se chevauchent prennent des voies différentes', () => {
  const bands = holidayBands(
    [hol('Zone A', '2026-10-19', '2026-10-25'), hol('Zone B', '2026-10-21', '2026-10-27')],
    '2026-10-19', '2026-10-25', C,
  );
  assert.equal(bands.length, 2);
  assert.notEqual(bands[0].lane, bands[1].lane, 'des plages qui se touchent ne partagent pas une voie');
});
