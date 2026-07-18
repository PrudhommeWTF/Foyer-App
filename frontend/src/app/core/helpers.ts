import { EventItem } from './models';
import { MONTH_NAMES } from './constants';

export function pad2(n: number): string { return String(n).padStart(2, '0'); }

export function dstr(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

/** Parse a 'YYYY-MM-DD' key into a local Date at midnight. */
export function parseDay(ds: string): Date { return new Date(ds + 'T00:00:00'); }

/** Whether an event occurs on a given day, taking recurrence & multi-day ranges into account. */
export function occursOn(ev: EventItem, ds: string): boolean {
  const r = ev.recur || 'none';
  if (r === 'none') {
    const end = ev.end || ev.date;
    return ds >= ev.date && ds <= end;
  }
  if (ev.date === ds) return true;
  const d = parseDay(ds);
  const start = parseDay(ev.date);
  if (d < start) return false;
  if (r === 'daily') return true;
  if (r === 'weekday') { const w = d.getDay(); return w >= 1 && w <= 5; }
  if (r === 'weekly') return d.getDay() === start.getDay();
  if (r === 'monthly') return d.getDate() === start.getDate();
  return false;
}

/** The 7 dates of a meal-planning week, offset from the reference week (13 Jul 2026). */
export function weekDates(offset: number): Date[] {
  const base = new Date(2026, 6, 13);
  base.setDate(base.getDate() + offset * 7);
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) { const d = new Date(base); d.setDate(base.getDate() + i); out.push(d); }
  return out;
}

export function monthLabelFor(off: number): string {
  const base = 2026 * 12 + 6;
  const idx = base + off;
  const y = Math.floor(idx / 12);
  const m = ((idx % 12) + 12) % 12;
  return MONTH_NAMES[m] + ' ' + y;
}

export function parseAmt(v: string | number): number {
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : Math.abs(n);
}
export function fmtAmt(n: number): string { return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function fmtInt(n: number): string { return n.toLocaleString('fr-FR'); }

export function contactIni(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function fileTypeOf(name: string): 'PDF' | 'IMG' | 'DOC' | 'XLS' | 'AUTRE' {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['pdf'].includes(ext)) return 'PDF';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return 'IMG';
  if (['doc', 'docx', 'txt', 'pages'].includes(ext)) return 'DOC';
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return 'XLS';
  return 'AUTRE';
}

export function uid(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Capitalise first letter (used for month/period labels). */
export function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Easter Sunday (Meeus/Jones/Butcher), as a UTC Date. */
function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** French metropolitan public holidays for a given year → {date:'YYYY-MM-DD', name}. */
export function frenchHolidays(year: number): { date: string; name: string }[] {
  const iso = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const e = easter(year);
  const plus = (n: number) => { const d = new Date(e); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  return [
    { date: `${year}-01-01`, name: 'Jour de l’an' },
    { date: plus(1), name: 'Lundi de Pâques' },
    { date: `${year}-05-01`, name: 'Fête du Travail' },
    { date: `${year}-05-08`, name: 'Victoire 1945' },
    { date: plus(39), name: 'Ascension' },
    { date: plus(50), name: 'Lundi de Pentecôte' },
    { date: `${year}-07-14`, name: 'Fête nationale' },
    { date: `${year}-08-15`, name: 'Assomption' },
    { date: `${year}-11-01`, name: 'Toussaint' },
    { date: `${year}-11-11`, name: 'Armistice 1918' },
    { date: `${year}-12-25`, name: 'Noël' },
  ];
}

/** Whether a 'YYYY-MM-DD' matches a birthday's month+day (year ignored). */
export function isBirthdayOn(birthday: string | null | undefined, ds: string): boolean {
  if (!birthday || birthday.length < 10) return false;
  return birthday.slice(5, 10) === ds.slice(5, 10);
}

/** Age turned on a given day for a birthday (or null). */
export function ageOn(birthday: string, ds: string): number | null {
  const by = parseInt(birthday.slice(0, 4), 10);
  const y = parseInt(ds.slice(0, 4), 10);
  if (isNaN(by) || isNaN(y)) return null;
  return y - by;
}
