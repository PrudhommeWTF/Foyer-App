import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lessonSlots } from './ecole-slots';
import { awayAt } from './presence';
import { EdLessonView } from './ecole.api';

const L = (id: number, start: string, end: string, more: Partial<EdLessonView> = {}): EdLessonView => ({
  id, studentId: 1, memberId: 'nolan', halfBoard: true, day: '2026-10-15', start, end, subject: 'MATHS', teacher: '', room: 'B12', kind: 'COURS', cancelled: false, modified: false, ...more,
});
const lab = (s: string): string => s;

describe('École : cours importés en créneaux', () => {
  it('un cours devient un créneau ponctuel, hors du foyer, en lecture seule (ed:)', () => {
    const [s] = lessonSlots([L(1, '08:00', '09:00')], lab);
    assert.deepEqual(s, { id: 'ed:1', who: ['nolan'], dow: 4, start: '08:00', end: '09:00', label: 'MATHS · B12', k: 'ecole', away: true, rec: 'once', date: '2026-10-15' });
  });

  it('demi-pensionnaire : la pause de midi entre deux cours devient « Cantine », et il manque au déjeuner', () => {
    const slots = lessonSlots([L(1, '08:00', '12:00'), L(2, '13:30', '16:30')], lab);
    const cantine = slots.find((s) => s.label === 'Cantine')!;
    assert.deepEqual([cantine.start, cantine.end, cantine.away], ['12:00', '13:30', true]);
    assert.ok(awayAt(slots, '2026-10-15', 'dej').has('nolan'));
  });

  it('externe : le midi reste libre, il déjeune à la maison', () => {
    const slots = lessonSlots([L(1, '08:00', '12:00', { halfBoard: false }), L(2, '13:30', '16:30', { halfBoard: false })], lab);
    assert.equal(slots.some((s) => s.label === 'Cantine'), false);
    assert.equal(awayAt(slots, '2026-10-15', 'dej').has('nolan'), false);
  });

  it('professeur absent : le cours annulé reste affiché mais ne retire personne ; la sortie avancée libère le midi', () => {
    const slots = lessonSlots([L(1, '08:00', '12:00'), L(2, '13:30', '16:30', { cancelled: true })], lab);
    assert.equal(slots.find((s) => s.id === 'ed:2')!.away, false);
    assert.equal(slots.some((s) => s.label === 'Cantine'), false, 'plus de cours l’après-midi : pas de cantine');
    assert.equal(awayAt(slots, '2026-10-15', 'dej').has('nolan'), false);
  });

  it('un cours sans membre associé est ignoré', () => {
    assert.deepEqual(lessonSlots([L(1, '08:00', '09:00', { memberId: null })], lab), []);
  });
});
