// Money and date helpers for the finances module.
//
// Amounts are signed integer cents everywhere: parsing happens once, at the
// edge (form input or import file), and never again. Summing 6000 floats drifts;
// summing 6000 integers does not.

/**
 * Parse a human or machine amount into signed cents. Accepts both decimal
 * separators, thin/regular spaces as thousands separators, a trailing euro sign,
 * and parenthesised negatives. Returns null when nothing numeric is found, so
 * callers can report a precise error instead of silently importing a zero.
 */
export function parseCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;

  let s = String(input).trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }

  s = s.replace(/[\s  ]/g, '').replace(/[€EUR]/gi, '');
  if (/^[-+]/.test(s)) { if (s[0] === '-') negative = !negative; s = s.slice(1); }

  // Whichever separator comes last is the decimal one ("1.234,56" and "1,234.56").
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    s = s.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + s.slice(decimalAt + 1);
  } else if (lastComma >= 0) {
    s = s.replace(',', '.');
  }
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;

  const [whole, frac = ''] = s.split('.');
  const cents = parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Cents to a plain decimal string with a dot, for CSV export. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** True for a well-formed 'YYYY-MM-DD' that is also a real calendar day. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 'DD/MM/YYYY' to 'YYYY-MM-DD'; null when the date is not a real day. */
export function frDateToIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/** True for a well-formed 'YYYY-MM'. */
export function isMonth(s: string): boolean { return /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }

/** First and last ISO day of a 'YYYY-MM' month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/**
 * Normalise a label for deduplication: uppercase, accents stripped, whitespace
 * collapsed. Deliberately conservative. Anything more aggressive (dropping
 * reference numbers, fixing mojibake) would make the fingerprint unstable, and
 * two exports of the same operation would stop matching.
 */
export function normaliseLabel(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
