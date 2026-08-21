// Les helpers de date sont des fonctions pures, testées avec `node:test` comme
// le backend. Aucun import Angular ici : c'est ce qui rend le fichier exécutable
// hors navigateur.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dstr, weekDates } from './helpers';

const iso = (offset: number, anchor: string): string[] => weekDates(offset, anchor).map(dstr);

test('weekDates suit la date d’ancrage et non une semaine figée', () => {
  // Le bug corrigé : la fonction renvoyait toujours la semaine du 13/07/2026,
  // quelle que soit la date du jour.
  assert.notDeepEqual(iso(0, '2026-08-21'), iso(0, '2026-07-15'));
  assert.equal(iso(0, '2026-08-21')[0], '2026-08-17');
});

test('la semaine commence le lundi et compte sept jours', () => {
  for (const anchor of ['2026-08-17', '2026-08-19', '2026-08-21', '2026-08-23']) {
    const w = iso(0, anchor);
    assert.equal(w.length, 7);
    assert.equal(w[0], '2026-08-17', 'lundi de la semaine du ' + anchor);
    assert.equal(w[6], '2026-08-23', 'dimanche de la semaine du ' + anchor);
  }
});

test('un dimanche appartient à la semaine qui l’a commencé', () => {
  // Piège classique : getDay() vaut 0 le dimanche, un décalage naïf renvoie la
  // semaine suivante et le planning saute un jour.
  assert.equal(iso(0, '2026-08-23')[0], '2026-08-17');
});

test('le décalage de semaines avance et recule de sept jours', () => {
  assert.equal(iso(1, '2026-08-21')[0], '2026-08-24');
  assert.equal(iso(-1, '2026-08-21')[0], '2026-08-10');
  assert.equal(iso(3, '2026-08-21')[0], '2026-09-07');
});

test('le passage à l’heure d’été ne décale pas les jours', () => {
  // Le changement d'heure français tombe le dernier dimanche de mars : une
  // arithmétique en millisecondes produirait ici un 29/03 à 23h, donc le 28.
  assert.deepEqual(iso(0, '2026-03-30'), [
    '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05',
  ]);
  assert.deepEqual(iso(0, '2026-10-26'), [
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
  ]);
});

test('la semaine traverse correctement les fins de mois et d’année', () => {
  assert.equal(iso(0, '2027-01-01')[0], '2026-12-28');
  assert.equal(iso(0, '2028-02-29')[0], '2028-02-28');
});
