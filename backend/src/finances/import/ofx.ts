// OFX statement parser, covering both flavours banks actually ship:
//   * OFX 1.x, an SGML dialect where value tags are never closed;
//   * OFX 2.x, plain XML.
// Both are normalised into the same tree before reading.
import { isIsoDate, parseCents } from '../money';
import { ParseResult, RawRow, RejectedRow } from './types';
import { XmlNode, findAll, parseXml, textOf } from './xml';

export const looksLikeOfx = (text: string): boolean =>
  /<OFX[\s>]/i.test(text) || /^\s*OFXHEADER:/im.test(text);

/**
 * Close the dangling value tags of OFX 1.x so the XML reader can take over.
 * A value tag is one followed by text on the same line; container tags are
 * followed by a newline. Tags that already carry their closer are left alone.
 */
function normaliseSgml(text: string): string {
  return text.replace(/<([A-Z][A-Z0-9.]*)>([^<\r\n]+)(?!<\/\1>)/g, (_m, tag: string, value: string) => `<${tag}>${value.trim()}</${tag}>`);
}

/** OFX dates are YYYYMMDD, optionally followed by a time and a time zone. */
function ofxDate(raw: string): string | null {
  const digits = String(raw || '').trim().replace(/[^0-9]/g, '');
  if (digits.length < 8) return null;
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return isIsoDate(iso) ? iso : null;
}

/** Human label for an account: institution, account id and type when present. */
function accountLabel(stmt: XmlNode): string {
  return [textOf(stmt, 'ORG'), textOf(stmt, 'ACCTID') || textOf(stmt, 'BANKID'), textOf(stmt, 'ACCTTYPE')]
    .map((s) => s.trim()).filter(Boolean).join(' ');
}

export function parseOfx(text: string): ParseResult {
  const isXml = /^\s*<\?xml/i.test(text);
  const at = text.search(/<OFX[\s>]/i);
  const body = at >= 0 ? text.slice(at) : text;
  const tree = parseXml(isXml ? body : normaliseSgml(body));

  const rows: RawRow[] = [];
  const rejected: RejectedRow[] = [];

  // A file may hold several statements, one per account.
  const statements = [...findAll(tree, 'STMTRS'), ...findAll(tree, 'CCSTMTRS')];
  const scopes = statements.length
    ? statements.map((s) => ({ node: s, label: accountLabel(s) }))
    : [{ node: tree, label: '' }];

  let line = 0;
  for (const scope of scopes) {
    for (const tx of findAll(scope.node, 'STMTTRN')) {
      line++;
      const date = ofxDate(textOf(tx, 'DTPOSTED') || textOf(tx, 'DTUSER') || textOf(tx, 'DTAVAIL'));
      if (!date) { rejected.push({ line, reason: `Date OFX illisible : « ${textOf(tx, 'DTPOSTED')} ».`, raw: textOf(tx, 'FITID') }); continue; }
      const amount = parseCents(textOf(tx, 'TRNAMT'));
      if (amount === null || amount === 0) { rejected.push({ line, reason: `Montant OFX illisible : « ${textOf(tx, 'TRNAMT')} ».`, raw: textOf(tx, 'FITID') }); continue; }
      const label = [textOf(tx, 'NAME'), textOf(tx, 'MEMO')].map((s) => s.trim()).filter(Boolean).join(' ').trim()
        || textOf(tx, 'TRNTYPE') || 'Opération';
      const check = textOf(tx, 'CHECKNUM');
      rows.push({
        line, date, amount, label,
        accountLabel: scope.label,
        category: '', subCategory: '',
        notes: check ? `Chèque ${check}` : '',
        cleared: false,
      });
    }
  }

  if (!rows.length && !rejected.length) {
    rejected.push({ line: 1, reason: 'Aucune opération (STMTTRN) trouvée dans ce fichier OFX.', raw: '' });
  }
  return { format: isXml ? 'OFX 2.x (XML)' : 'OFX 1.x (SGML)', rows, rejected, encoding: '' };
}
