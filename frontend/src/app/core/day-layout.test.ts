// Le placement horaire partagé par le Calendrier et l'Emploi du temps : qui
// partage sa largeur avec qui, et combien de temps dure ce qui n'a pas de fin.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hourRange, isWholeDay, layoutTimed, toMinutes } from './day-layout';

const lay = (xs: [string, string, string?][]) => layoutTimed(xs.map(([item, start, end]) => ({ item, start, end })));
const by = (ps: ReturnType<typeof lay>, id: string) => ps.find((p) => p.item === id)!;

test('un élément seul dans sa grappe prend toute la largeur', () => {
  const ps = lay([['a', '08:00', '09:00'], ['b', '08:30', '10:00'], ['c', '14:00', '15:00']]);
  assert.deepEqual([by(ps, 'a').col, by(ps, 'a').cols], [0, 2]);
  assert.deepEqual([by(ps, 'b').col, by(ps, 'b').cols], [1, 2]);
  assert.deepEqual([by(ps, 'c').col, by(ps, 'c').cols], [0, 1], 'grappe disjointe : pleine largeur');
});

test('une grappe en chaîne partage ses colonnes, une colonne libérée se réutilise', () => {
  const ps = lay([['a', '08:00', '12:00'], ['b', '08:00', '09:00'], ['c', '09:00', '10:00'], ['d', '09:30', '11:00']]);
  assert.equal(by(ps, 'a').cols, 3);
  assert.equal(by(ps, 'c').col, by(ps, 'b').col, 'c reprend la colonne de b, terminé à 9 h');
  assert.equal(by(ps, 'd').col, 2);
});

test('un élément sans fin dure la durée minimale, une fin avant le début aussi', () => {
  const [a] = lay([['a', '10:00']]);
  assert.deepEqual([a.s, a.e], [600, 630]);
  const [b] = layoutTimed([{ item: 'b', start: '23:50', end: '08:00' }], { minDur: 30 });
  assert.deepEqual([b.s, b.e], [1430, 1440], 'bornée à minuit');
  const [c] = layoutTimed([{ item: 'c', start: '10:00' }], { minDur: 60 });
  assert.equal(c.e, 660);
});

test('journée entière : 00:00 → 23:59', () => {
  assert.ok(isWholeDay('00:00', '23:59'));
  assert.ok(!isWholeDay('00:00', '12:00'));
  assert.ok(!isWholeDay('08:00', '23:59'));
  assert.equal(toMinutes('nope'), 0);
});

test('plage horaire : heures pleines autour des créneaux, bornée, défaut sans créneau', () => {
  assert.deepEqual(hourRange([]), [7, 19]);
  assert.deepEqual(hourRange([{ s: 8 * 60 + 15, e: 18 * 60 }]), [8, 18]);
  assert.deepEqual(hourRange([{ s: 5 * 60, e: 23 * 60 + 30 }]), [6, 22]);
  assert.deepEqual(hourRange([{ s: 9 * 60 + 30, e: 9 * 60 + 45 }]), [9, 10]);
});
