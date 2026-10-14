// Les fiches de l'employé à domicile, sans Angular : la présence et l'employé
// tels que saisis, ce qui change, et la lecture d'un taux horaire tapé.
import type { EmpEmployee, EmpRole, EmpShift } from './employes.api';

export interface ShiftFields { day: string; minutes: number; note: string; }
export function shiftFields(s: EmpShift | null, d: { day: string; minutes: number }): ShiftFields {
  return s ? { day: s.day, minutes: s.minutes, note: s.note || '' } : { day: d.day, minutes: d.minutes, note: '' };
}
/** Un quart d'heure de plus ou de moins, entre un quart d'heure et une journée. */
export const stepMinutes = (m: number, delta: number): number => Math.max(15, Math.min(1440, m + delta));
/** Les seuls champs changés d'une présence : rien de changé, rien n'est envoyé. */
export function shiftPatch(s: EmpShift, f: ShiftFields): { day?: string; minutes?: number; note?: string } {
  const p: { day?: string; minutes?: number; note?: string } = {};
  const note = f.note.trim();
  if (f.day !== s.day) p.day = f.day;
  if (f.minutes !== s.minutes) p.minutes = f.minutes;
  if (note !== (s.note || '')) p.note = note;
  return p;
}

/**
 * Un taux horaire net tapé (« 14,50 »), en euros, ou null s'il n'y en a pas ou
 * qu'il est hors bornes. Un champ numérique lie un nombre ou null, jamais une
 * chaîne : on le normalise sans supposer un .trim().
 */
export function parseRate(v: unknown): number | null {
  const brut = String(v ?? '').replace(',', '.').trim();
  if (!brut) return null;
  const n = Number(brut);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export interface EmployeeFields { first: string; last: string; name: string; role: EmpRole; rate: string; from: string; }
export function employeeFields(e: EmpEmployee | null, today: string): EmployeeFields {
  return { first: '', last: '', name: e?.name || '', role: e?.role || 'menage', rate: '', from: today };
}
