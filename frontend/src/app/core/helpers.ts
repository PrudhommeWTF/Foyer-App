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
