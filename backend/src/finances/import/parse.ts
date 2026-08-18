// Format detection and dispatch.
//
// The extension is a hint, never the decision: bank aggregators routinely name
// an HTML table « .xls » and a semicolon file « .csv » that is really TSV. We
// look at the bytes.
import { parseDelimited, parseTable } from './csv';
import { decodeText } from './decode';
import { looksLikeCamt, parseCamt } from './camt';
import { looksLikeOfx, parseOfx } from './ofx';
import { ParseResult } from './types';
import { OLE2_MESSAGE, isOle2, isZip, looksLikeHtmlTable, readHtmlTable, readXlsx } from './xlsx';

/** Thrown when a file cannot be read at all; the message is shown to the user. */
export class UnsupportedFile extends Error {}

export function parseFile(buf: Buffer, filename: string): ParseResult {
  if (!buf.length) throw new UnsupportedFile('Le fichier est vide.');

  // Real Excel 97-2003: refused on purpose, with the way out.
  if (isOle2(buf)) throw new UnsupportedFile(OLE2_MESSAGE);

  // Real .xlsx (a ZIP of XML parts), whatever the extension says.
  if (isZip(buf)) {
    try {
      return { ...parseTable(readXlsx(buf), 'XLSX'), encoding: 'XML (UTF-8)' };
    } catch (e) {
      throw new UnsupportedFile(`Fichier .xlsx illisible : ${(e as Error).message}`);
    }
  }

  const { text, encoding } = decodeText(buf);
  const head = text.slice(0, 4096);

  if (looksLikeOfx(head)) return { ...parseOfx(text), encoding };
  if (looksLikeCamt(head)) return { ...parseCamt(text), encoding };
  if (looksLikeHtmlTable(head)) {
    const table = readHtmlTable(text);
    if (!table.length) throw new UnsupportedFile('Tableau HTML détecté, mais aucune ligne exploitable.');
    return { ...parseTable(table, 'Tableau HTML'), encoding };
  }

  // Anything else is treated as delimited text. An XML file that is neither OFX
  // nor CAMT would fail the column check with an explicit message, which is the
  // behaviour we want.
  if (/^\s*<\?xml|^\s*</.test(head) && !/[;,\t]/.test(head.split(/\r?\n/)[0] || '')) {
    throw new UnsupportedFile(
      `Format XML non reconnu pour « ${filename} ». Les formats acceptés sont : CSV, OFX, CAMT.053 et .xlsx.`,
    );
  }
  return { ...parseDelimited(text, 'CSV'), encoding };
}
