// Modifier ou supprimer une seule occurrence d'un événement récurrent.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventItem } from './models';
import { occursOn } from './helpers';
import { eventsOn } from './agenda';
import { EventDraft, applyToSeries, detachOccurrence, draftChanges, isSeries, seriesDate, withSkip, withoutSkip } from './event-scope';

// Le judo du mardi, depuis le mardi 1er septembre 2026.
const judo: EventItem = { id: 'e1', date: '2026-09-01', time: '18:00', endTime: '19:00', title: 'Judo', who: ['m1'], recur: 'weekly', place: 'Dojo', by: 'm1', at: '2026-08-20T10:00:00Z' };
const draftOf = (ev: EventItem, over: Partial<EventDraft> = {}): EventDraft => ({
  date: ev.date, title: ev.title, time: ev.time, endTime: ev.endTime ?? null, place: ev.place ?? null, allDay: ev.allDay, who: [...ev.who], recur: ev.recur, end: ev.end ?? null, ...over,
});

test('une date sautée disparaît de la série, y compris la toute première', () => {
  const ev = withSkip(withSkip(judo, '2026-09-15'), '2026-09-01');
  assert.equal(occursOn(ev, '2026-09-15'), false);
  assert.equal(occursOn(ev, '2026-09-01'), false);
  assert.equal(occursOn(ev, '2026-09-08'), true);
  assert.equal(occursOn(ev, '2026-09-22'), true);
  assert.deepEqual(eventsOn([ev], '2026-09-15'), []);
});

test('les dates sautées sont sans effet sur un événement ponctuel', () => {
  const rdv: EventItem = { ...judo, recur: 'none', skip: ['2026-09-01'] };
  assert.equal(occursOn(rdv, '2026-09-01'), true);
});

test('rétablir une date sautée la fait revenir, et ne laisse pas de liste vide', () => {
  const ev = withoutSkip(withSkip(judo, '2026-09-15'), '2026-09-15');
  assert.equal(occursOn(ev, '2026-09-15'), true);
  assert.equal('skip' in ev, false);
  assert.deepEqual(ev, judo);
});

test('sauter deux fois la même date ne la duplique pas', () => {
  assert.deepEqual(withSkip(withSkip(judo, '2026-09-15'), '2026-09-15').skip, ['2026-09-15']);
});

test('cette occurrence seulement : la série saute la date, un événement ponctuel porte la modification', () => {
  const draft = draftOf(judo, { date: '2026-09-15', time: '17:00', endTime: '18:00' });
  const { series, single } = detachOccurrence(judo, '2026-09-15', draft, 'e2', 'm2', '2026-09-10T08:00:00Z');
  assert.deepEqual(series.skip, ['2026-09-15']);
  assert.equal(series.time, '18:00', 'la série garde son heure');
  assert.equal(single.recur, 'none');
  assert.equal(single.date, '2026-09-15');
  assert.equal(single.time, '17:00');
  assert.equal(single.by, 'm2');
  const day = eventsOn([series, single], '2026-09-15');
  assert.deepEqual(day.map((e) => e.id), ['e2'], 'le 15, un seul judo, celui de 17 h');
  assert.deepEqual(eventsOn([series, single], '2026-09-22').map((e) => e.time), ['18:00'], 'le 22, la série reprend');
});

test('une occurrence déplacée à un autre jour quitte son mardi', () => {
  const draft = draftOf(judo, { date: '2026-09-16' });
  const { series, single } = detachOccurrence(judo, '2026-09-15', draft, 'e2', null, 'x');
  assert.deepEqual(eventsOn([series, single], '2026-09-15'), []);
  assert.deepEqual(eventsOn([series, single], '2026-09-16').map((e) => e.id), ['e2']);
});

test('ouvert sur une occurrence, la date laissée telle quelle garde le départ de la série', () => {
  assert.equal(seriesDate('2026-09-01', '2026-11-10', '2026-11-10'), '2026-09-01');
});

test('ouvert sur une occurrence, déplacer la date décale toute la série d’autant', () => {
  assert.equal(seriesDate('2026-09-01', '2026-11-10', '2026-11-11'), '2026-09-02');
});

test('toute la série : un départ décalé emporte les dates sautées avec lui', () => {
  const ev = withSkip(judo, '2026-09-15');
  const out = applyToSeries(ev, draftOf(ev, { date: '2026-09-02' }), 'm1', 'now');
  assert.deepEqual(out.skip, ['2026-09-16']);
  assert.equal(occursOn(out, '2026-09-16'), false);
  assert.equal(occursOn(out, '2026-09-23'), true);
  assert.equal(out.upBy, 'm1');
});

test('toute la série sans déplacement : les dates sautées restent', () => {
  const ev = withSkip(judo, '2026-09-15');
  assert.deepEqual(applyToSeries(ev, draftOf(ev, { time: '18:30' }), null, 'now').skip, ['2026-09-15']);
});

test('sauvegarder sans rien toucher ne change rien', () => {
  assert.equal(draftChanges(judo, draftOf(judo)), false);
  assert.equal(draftChanges(judo, draftOf(judo, { who: ['m1'] })), false);
  assert.equal(draftChanges(judo, draftOf(judo, { title: 'Judo !' })), true);
  assert.equal(draftChanges(judo, draftOf(judo, { who: ['m1', 'm2'] })), true);
});

test('les membres dans un autre ordre ne sont pas une modification', () => {
  const ev = { ...judo, who: ['m1', 'm2'] };
  assert.equal(draftChanges(ev, draftOf(ev, { who: ['m2', 'm1'] })), false);
});

test('isSeries', () => {
  assert.equal(isSeries(judo), true);
  assert.equal(isSeries({ recur: 'none' }), false);
});
