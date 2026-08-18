// CAMT.053 (ISO 20022 bank-to-customer statement) parser.
//
// Only the parts a household needs are read: one account per <Stmt>, one row per
// <Ntry>, using the entry's booking date, signed amount and whatever free text
// the bank put in the remittance information.
import { isIsoDate, parseCents } from '../money';
import { ParseResult, RawRow, RejectedRow } from './types';
import { XmlNode, find, findAll, localName, parseXml, textOf } from './xml';

export const looksLikeCamt = (text: string): boolean =>
  /<Document[\s>][\s\S]*<BkToCstmrStmt/i.test(text) || /urn:iso:std:iso:20022[^"']*camt\.05[23]/i.test(text);

/** Booking date, falling back to the value date. */
function entryDate(entry: XmlNode): string | null {
  for (const tag of ['BookgDt', 'ValDt']) {
    const node = find(entry, tag);
    if (!node) continue;
    const raw = (textOf(node, 'Dt') || textOf(node, 'DtTm') || node.text).slice(0, 10);
    if (isIsoDate(raw)) return raw;
  }
  return null;
}

/** Direction: CRDT credits the account, DBIT debits it. */
function signedAmount(entry: XmlNode): number | null {
  const amt = find(entry, 'Amt');
  const cents = parseCents(amt ? amt.text : '');
  if (cents === null) return null;
  const side = textOf(entry, 'CdtDbtInd').toUpperCase();
  return side === 'DBIT' ? -Math.abs(cents) : Math.abs(cents);
}

/**
 * Best available label. Banks scatter it between the remittance information,
 * the counterparty name and the additional entry information, so we take the
 * first non-empty in the order that reads best for a human.
 */
function entryLabel(entry: XmlNode): string {
  const details = find(entry, 'NtryDtls');
  const candidates = [
    details ? textOf(details, 'Ustrd') : '',
    textOf(entry, 'Ustrd'),
    details ? textOf(details, 'Nm') : '',
    textOf(entry, 'AddtlNtryInf'),
    textOf(entry, 'AddtlTxInf'),
  ];
  const label = candidates.map((s) => s.replace(/\s+/g, ' ').trim()).find(Boolean);
  return label || 'Opération';
}

/** Account label: IBAN when present, otherwise the local id, plus the owner name. */
function accountLabel(stmt: XmlNode): string {
  const acct = find(stmt, 'Acct');
  if (!acct) return '';
  const id = textOf(acct, 'IBAN') || textOf(acct, 'Othr') || '';
  const owner = acct.children.filter((c) => localName(c.tag) === 'Ownr').map((c) => textOf(c, 'Nm'))[0] || '';
  return [owner, id].map((s) => s.trim()).filter(Boolean).join(' ');
}

export function parseCamt(text: string): ParseResult {
  const tree = parseXml(text);
  const rows: RawRow[] = [];
  const rejected: RejectedRow[] = [];

  const statements = findAll(tree, 'Stmt');
  const scopes = statements.length ? statements : [tree];

  let line = 0;
  for (const stmt of scopes) {
    const label = accountLabel(stmt);
    for (const entry of findAll(stmt, 'Ntry')) {
      line++;
      const ref = textOf(entry, 'NtryRef') || textOf(entry, 'AcctSvcrRef');
      const date = entryDate(entry);
      if (!date) { rejected.push({ line, reason: 'Date CAMT illisible (BookgDt et ValDt absents ou invalides).', raw: ref }); continue; }
      const amount = signedAmount(entry);
      if (amount === null || amount === 0) { rejected.push({ line, reason: 'Montant CAMT illisible.', raw: ref }); continue; }
      rows.push({
        line, date, amount, label: entryLabel(entry),
        accountLabel: label,
        category: '', subCategory: '', notes: '',
        // Only booked entries are settled; pending ones stay unticked.
        cleared: textOf(entry, 'Sts').toUpperCase().includes('BOOK'),
      });
    }
  }

  if (!rows.length && !rejected.length) {
    rejected.push({ line: 1, reason: 'Aucune écriture (Ntry) trouvée dans ce fichier CAMT.053.', raw: '' });
  }
  return { format: 'CAMT.053', rows, rejected, encoding: '' };
}
