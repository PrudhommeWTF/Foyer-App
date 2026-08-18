// Spreadsheet reading, without a spreadsheet library.
//
// « .xls » from a bank aggregator is rarely a real Excel file: it is often an
// HTML table or delimited text wearing the wrong extension. We sniff the bytes
// rather than trust the name, and handle the three shapes that actually occur.
// The genuine binary Excel 97-2003 format is refused with an explicit message:
// decoding BIFF8 by hand is unreasonable, and CSV is one click away.
import { XmlNode, findAll, localName, parseXml } from './xml';
import { isOle2, isZip, readZip } from './zip';

/** Column letters to a 0-based index: A gives 0, AA gives 26. */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase());
  if (!letters) return 0;
  let n = 0;
  for (const ch of letters[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Concatenated text of a shared-string entry (which may be split into runs). */
function sharedText(node: XmlNode): string {
  return findAll(node, 't').map((t) => t.text).join('');
}

/** Read the first worksheet of an .xlsx into a rectangular table of strings. */
export function readXlsx(buf: Buffer): string[][] {
  const parts = readZip(buf, (n) =>
    n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));

  const sharedNode = parts.get('xl/sharedStrings.xml');
  const shared = sharedNode
    ? parseXml(sharedNode.toString('utf-8')).children
      .filter((c) => localName(c.tag) === 'sst')
      .flatMap((sst) => sst.children.filter((c) => localName(c.tag) === 'si').map(sharedText))
    : [];

  const sheetNames = [...parts.keys()].filter((n) => n.startsWith('xl/worksheets/')).sort();
  if (!sheetNames.length) throw new Error("Aucune feuille de calcul trouvée dans le fichier .xlsx.");
  const sheet = parseXml(parts.get(sheetNames[0])!.toString('utf-8'));

  const table: string[][] = [];
  for (const row of findAll(sheet, 'row')) {
    const cells: string[] = [];
    for (const c of row.children.filter((x) => localName(x.tag) === 'c')) {
      const at = c.attrs['r'] ? columnIndex(c.attrs['r']) : cells.length;
      const type = c.attrs['t'] || '';
      let value = '';
      if (type === 's') {
        const idx = parseInt(findAll(c, 'v').map((v) => v.text)[0] || '', 10);
        value = Number.isInteger(idx) ? (shared[idx] ?? '') : '';
      } else if (type === 'inlineStr') {
        value = findAll(c, 't').map((t) => t.text).join('');
      } else {
        value = findAll(c, 'v').map((v) => v.text)[0] || '';
      }
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    table.push(cells);
  }
  return table;
}

/** Read an HTML `<table>` (the usual disguise of a fake .xls) into a table. */
export function readHtmlTable(text: string): string[][] {
  const rows: string[][] = [];
  for (const tr of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    for (const td of String(tr[1]).matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) {
      cells.push(String(td[1])
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/\s+/g, ' ')
        .trim());
    }
    if (cells.some((c) => c !== '')) rows.push(cells);
  }
  return rows;
}

export const looksLikeHtmlTable = (text: string): boolean => /<table\b/i.test(text) && /<tr\b/i.test(text);

/** Refusal message for the one format we deliberately do not decode. */
export const OLE2_MESSAGE =
  'Ce fichier est un classeur Excel 97-2003 (format binaire). Ce format n’est pas pris en charge : '
  + 'rouvrez-le dans un tableur et réexportez-le en CSV (séparateur point-virgule) ou en .xlsx.';

export { isOle2, isZip };
