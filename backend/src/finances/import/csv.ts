// Delimited-text parser (CSV, TSV, and the semicolon-separated Bankin' export).
//
// Columns are matched by normalised header name, so the Bankin' layout
// (Date;Description;Compte;Montant;Catégorie;Sous-Catégorie;Note;Pointée) and the
// English one (date,description,amount,asset_account,category,…) both work with
// no configuration.
import { frDateToIso, isIsoDate, parseCents } from '../money';
import { ParseResult, RawRow, RejectedRow } from './types';

/** Split delimited text into rows, honouring quoted fields and embedded newlines. */
export function splitDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const push = (): void => { row.push(field); field = ''; };
  const endRow = (): void => { push(); if (row.some((c) => c !== '')) rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === sep) { push(); i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    field += c; i++;
  }
  endRow();
  return rows;
}

/** Pick the separator that yields the most consistent column count. */
export function sniffSeparator(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
  let best = ';';
  let bestScore = -1;
  for (const sep of [';', ',', '\t', '|']) {
    const rows = splitDelimited(sample, sep).filter((r) => r.length > 1);
    if (!rows.length) continue;
    const width = rows[0].length;
    const consistent = rows.filter((r) => r.length === width).length;
    // More columns is better, but only when the file is consistently that wide.
    const score = consistent === rows.length ? width * 10 + consistent : consistent;
    if (score > bestScore) { bestScore = score; best = sep; }
  }
  return best;
}

const norm = (s: string): string =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Header aliases, in priority order. First match wins. */
const FIELDS: Record<string, string[]> = {
  date: ['date', 'dateoperation', 'datedoperation', 'datecomptable', 'datevaleur', 'bookingdate'],
  label: ['description', 'libelle', 'libelleoperation', 'intitule', 'label', 'name', 'payee', 'narrative'],
  account: ['compte', 'assetaccount', 'account', 'accountname', 'comptebancaire', 'nomducompte'],
  amount: ['montant', 'amount', 'montanteur', 'valeur', 'value'],
  debit: ['debit'],
  credit: ['credit'],
  category: ['categorie', 'category'],
  subCategory: ['souscategorie', 'subcategory', 'sous categorie'],
  notes: ['note', 'notes', 'commentaire', 'comment', 'memo'],
  cleared: ['pointee', 'pointe', 'cleared', 'rapprochee'],
};

function mapHeader(header: string[]): Record<string, number> {
  const normalised = header.map(norm);
  const idx: Record<string, number> = {};
  for (const [field, names] of Object.entries(FIELDS)) {
    for (const n of names) {
      const at = normalised.indexOf(n);
      if (at >= 0) { idx[field] = at; break; }
    }
  }
  return idx;
}

/**
 * Accept ISO dates, French dates, and the bare serial numbers a spreadsheet
 * stores dates as. The serial range is bounded to 1970-2100 so a stray amount
 * in the date column is rejected instead of silently becoming a date.
 */
export function readDate(v: string): string | null {
  const s = String(v || '').trim();
  if (!s) return null;
  const fr = frDateToIso(s);
  if (fr) return fr;
  const iso = s.slice(0, 10);
  if (isIsoDate(iso)) return iso;
  // Some exports write 2026/08/17.
  const alt = iso.replace(/\//g, '-');
  if (isIsoDate(alt)) return alt;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(parseFloat(s));
    if (serial >= 25569 && serial <= 73415) {
      // Excel counts from 1899-12-30 (its 1900 leap-year bug included).
      return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
    }
  }
  return null;
}

const TRUTHY = new Set(['oui', 'yes', 'true', '1', 'x', 'o']);

export function parseDelimited(text: string, format = 'CSV'): ParseResult {
  const sep = sniffSeparator(text);
  return parseTable(splitDelimited(text, sep), format, sep);
}

/**
 * Read a header row plus data rows into operations. Shared by the delimited
 * parser and the spreadsheet readers, so a column layout only has to be
 * recognised once.
 */
export function parseTable(table: string[][], format: string, sep = ';'): ParseResult {
  const rejected: RejectedRow[] = [];
  if (!table.length) return { format, rows: [], rejected: [{ line: 1, reason: 'Fichier vide.', raw: '' }], encoding: '' };

  const idx = mapHeader(table[0]);
  const missing = ['date', 'label'].filter((f) => idx[f] === undefined);
  if (idx['amount'] === undefined && idx['debit'] === undefined && idx['credit'] === undefined) missing.push('montant');
  if (missing.length) {
    return {
      format, rows: [], encoding: '',
      rejected: [{
        line: 1,
        reason: `Colonnes introuvables : ${missing.join(', ')}. En-tête lu : ${table[0].join(' | ')}. Séparateur détecté : « ${sep === '\t' ? 'tabulation' : sep} ».`,
        raw: table[0].join(sep),
      }],
    };
  }

  const rows: RawRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const line = r + 1;
    const at = (f: string): string => (idx[f] === undefined ? '' : String(cells[idx[f]] ?? '').trim());

    const date = readDate(at('date'));
    if (!date) { rejected.push({ line, reason: `Date illisible : « ${at('date')} ».`, raw: cells.join(sep) }); continue; }

    // Either a single signed amount, or separate debit/credit columns.
    let amount: number | null = null;
    if (idx['amount'] !== undefined && at('amount')) amount = parseCents(at('amount'));
    else {
      const debit = at('debit') ? parseCents(at('debit')) : null;
      const credit = at('credit') ? parseCents(at('credit')) : null;
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
    }
    if (amount === null) { rejected.push({ line, reason: `Montant illisible : « ${at('amount') || at('debit') || at('credit')} ».`, raw: cells.join(sep) }); continue; }
    if (amount === 0) { rejected.push({ line, reason: 'Montant nul, ligne ignorée.', raw: cells.join(sep) }); continue; }

    const label = at('label');
    if (!label) { rejected.push({ line, reason: 'Libellé vide.', raw: cells.join(sep) }); continue; }

    rows.push({
      line, date, amount, label,
      accountLabel: at('account'),
      category: at('category'),
      subCategory: at('subCategory'),
      notes: at('notes'),
      cleared: TRUTHY.has(at('cleared').toLowerCase()),
    });
  }
  return { format, rows, rejected, encoding: '' };
}
