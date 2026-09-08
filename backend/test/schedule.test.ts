// Récurrence des créneaux d'emploi du temps côté serveur : le flux ICS doit
// publier exactement ce que l'écran dérive. Port fidèle, donc mêmes règles.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SchedSlot } from '../src/models';
import { calendarFacts, frenchHolidays, occursOn, publishedSlotOccurrences } from '../src/schedule';

const slot = (over: Partial<SchedSlot> = {}): SchedSlot =>
  ({ id: 's1', who: [], dow: 1, start: '08:30', end: '16:30', label: 'École', k: 'ecole', rec: 'weekly', ...over }) as SchedSlot;

describe('occursOn', () => {
  it('un créneau hebdomadaire tombe le bon jour de la semaine', () => {
    assert.equal(occursOn(slot(), '2026-09-07'), true); // lundi
    assert.equal(occursOn(slot(), '2026-09-08'), false); // mardi
  });
  it('respecte la fenêtre de validité et les dates sautées', () => {
    assert.equal(occursOn(slot({ from: '2026-09-14' }), '2026-09-07'), false);
    assert.equal(occursOn(slot({ until: '2026-09-01' }), '2026-09-07'), false);
    assert.equal(occursOn(slot({ skip: ['2026-09-07'] }), '2026-09-07'), false);
  });
  it('une semaine sur deux compte la phase depuis « from »', () => {
    const s = slot({ interval: 2, from: '2026-09-07' });
    assert.equal(occursOn(s, '2026-09-07'), true);
    assert.equal(occursOn(s, '2026-09-14'), false); // semaine +1
    assert.equal(occursOn(s, '2026-09-21'), true); // semaine +2
  });
  it('un créneau ponctuel ne tombe que sa date', () => {
    const s = slot({ rec: 'once', date: '2026-09-10' });
    assert.equal(occursOn(s, '2026-09-10'), true);
    assert.equal(occursOn(s, '2026-09-17'), false);
  });
  it('le filtre scolaire cache le créneau pendant les vacances, l’affiche sinon', () => {
    const cal = calendarFacts([{ start: '2026-10-17', end: '2026-11-02' }]);
    const s = slot({ when: 'school' });
    assert.equal(occursOn(s, '2026-10-19', cal), false); // lundi de vacances
    assert.equal(occursOn(s, '2026-09-07', cal), true); // lundi de classe
  });
  it('sans connaissance des vacances, on affiche (on ne cache pas l’école)', () => {
    const s = slot({ when: 'school' });
    assert.equal(occursOn(s, '2026-10-19', calendarFacts([])), true);
  });
});

describe('publishedSlotOccurrences', () => {
  it('ne rend que les créneaux publiés (sync), sur la fenêtre', () => {
    const sched = [slot({ id: 'a', sync: true }), slot({ id: 'b', sync: false })];
    const occ = publishedSlotOccurrences(sched, '2026-09-07', '2026-09-21');
    assert.deepEqual([...new Set(occ.map((o) => o.slotId))], ['a']);
    assert.deepEqual(occ.map((o) => o.date), ['2026-09-07', '2026-09-14', '2026-09-21']);
  });
  it('rien quand aucun créneau n’est publié', () => {
    assert.equal(publishedSlotOccurrences([slot({ sync: false })], '2026-09-01', '2026-12-01').length, 0);
  });
});

describe('frenchHolidays', () => {
  it('calcule les fériés fixes et mobiles', () => {
    const h = frenchHolidays(2026);
    assert.ok(h.includes('2026-01-01'));
    assert.ok(h.includes('2026-07-14'));
    assert.ok(h.includes('2026-04-06')); // lundi de Pâques 2026
    assert.equal(h.length, 11);
  });
});
