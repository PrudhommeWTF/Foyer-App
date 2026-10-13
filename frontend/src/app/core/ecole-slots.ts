import { EdLessonView } from './ecole.api';
import { weekdayOf } from './helpers';
import { SchedSlot } from './models';

/**
 * Les cours importés d'ÉcoleDirecte, vus comme des créneaux d'emploi du temps.
 *
 * Une source **en plus** des créneaux saisis à la main, jamais fusionnée avec
 * eux : rien n'est écrit dans le document, les identifiants commencent par
 * `ed:` et l'écran les montre en lecture seule. La présence (`presence.ts`) et
 * les couverts du planning des repas les lisent comme les autres.
 *
 * - Un cours annulé reste visible (barré) mais ne retire personne du foyer.
 * - Un élève demi-pensionnaire passe la pause de midi à l'école : le trou entre
 *   le dernier cours du matin et le premier de l'après-midi devient un créneau
 *   « Cantine ». Externe, ce trou reste libre : il déjeune à la maison.
 */
export const ED_SLOT_PREFIX = 'ed:';
export const isEdSlot = (id: string): boolean => id.startsWith(ED_SLOT_PREFIX);

/** La fenêtre où un trou entre deux cours est la pause de midi. */
const LUNCH_FROM = '11:00';
const LUNCH_TO = '14:30';

export function lessonSlots(lessons: EdLessonView[], label: (subject: string) => string): SchedSlot[] {
  const out: SchedSlot[] = [];
  const byDay = new Map<string, EdLessonView[]>();
  for (const l of lessons) {
    if (!l.memberId) continue;
    out.push({
      id: ED_SLOT_PREFIX + l.id, who: [l.memberId], dow: weekdayOf(l.day), start: l.start, end: l.end,
      label: label(l.subject) + (l.room ? ' · ' + l.room : ''), k: 'ecole', away: !l.cancelled, rec: 'once', date: l.day,
    });
    if (!l.cancelled && l.halfBoard) {
      const k = l.memberId + '|' + l.day;
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(l);
    }
  }
  for (const [k, day] of byDay) {
    const sorted = day.slice().sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i], b = sorted[i + 1];
      // Un trou qui touche la pause de midi : au moins un cours avant, un après.
      if (b.start > a.end && a.end < LUNCH_TO && b.start > LUNCH_FROM) {
        const [memberId, date] = k.split('|');
        out.push({ id: `${ED_SLOT_PREFIX}cantine:${memberId}:${date}`, who: [memberId], dow: weekdayOf(date), start: a.end, end: b.start, label: 'Cantine', k: 'repas', away: true, rec: 'once', date });
        break;
      }
    }
  }
  return out;
}
