// Un PDF de tableau, sans dépendance : de quoi imprimer ou envoyer une liste
// (l'inventaire des équipements pour l'assurance) et l'ouvrir partout, iPhone
// compris.
//
// Le minimum du format, écrit à la main : des pages A4 en paysage, les polices
// standard Helvetica et Helvetica-Bold (présentes dans tout lecteur PDF, rien à
// embarquer), l'encodage WinAnsi, qui couvre le français (accents, ç, œ, «, »)
// et le signe euro. Un caractère hors de cet encodage devient « ? » plutôt que
// de casser le fichier. Pas d'image : les factures voyagent dans le zip.
//
// La largeur du texte s'estime avec la table des largeurs Helvetica des
// caractères courants ; une cellule trop longue est coupée avec « … ».

export interface PdfColumn { title: string; width: number; align?: 'left' | 'right'; }
export interface PdfTable { title: string; subtitle?: string; columns: PdfColumn[]; rows: string[][]; footer?: string; }

const PAGE_W = 842, PAGE_H = 595, MARGIN = 36;
const SIZE = 9, HEAD = 9, ROW_H = 15;

/** Largeurs Helvetica (millièmes d'em) des caractères ASCII imprimables ; les autres comptent comme « n ». */
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const charW = (ch: string, bold: boolean): number => {
  const base = ch.normalize('NFD')[0];
  const c = base.charCodeAt(0);
  const w = c >= 32 && c <= 126 ? W[c - 32] : 556;
  return bold ? w * 1.06 : w;
};
export const textWidth = (s: string, size: number, bold = false): number => [...s].reduce((t, ch) => t + charW(ch, bold), 0) * size / 1000;

/** Coupe un texte pour qu'il tienne dans `max` points, avec « … ». */
export function fit(s: string, max: number, size: number, bold = false): string {
  if (textWidth(s, size, bold) <= max) return s;
  let out = [...s];
  while (out.length && textWidth(out.join('') + '…', size, bold) > max) out = out.slice(0, -1);
  return out.join('') + '…';
}

/** Les caractères WinAnsi au-delà de Latin-1 (plage 0x80-0x9F). */
const WIN: Record<string, number> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '\u2014': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

/** Une chaîne PDF littérale en WinAnsi, échappée. */
export function pdfString(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const c = ch.charCodeAt(0);
    const b = WIN[ch] ?? (c === 0xa0 || c === 0x202f ? 0x20 : (c >= 0x20 && c <= 0xff && !(c >= 0x7f && c < 0xa0)) ? c : 0x3f);
    const t = String.fromCharCode(b);
    out += t === '(' || t === ')' || t === '\\' ? '\\' + t : t;
  }
  return '(' + out + ')';
}

export function tablePdf(t: PdfTable): Buffer {
  const usable = PAGE_H - 2 * MARGIN - 52 - 20;
  const perPage = Math.max(1, Math.floor(usable / ROW_H));
  const pages: string[][][] = [];
  for (let i = 0; i < Math.max(1, t.rows.length); i += perPage) pages.push(t.rows.slice(i, i + perPage));

  const contents = pages.map((rows, pi) => {
    const ops: string[] = [];
    const text = (x: number, y: number, s: string, size: number, bold = false) =>
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(s)} Tj ET`);
    let y = PAGE_H - MARGIN - 14;
    text(MARGIN, y, t.title, 15, true);
    if (t.subtitle) text(MARGIN, y - 16, t.subtitle, 9);
    y -= 40;
    // En-tête de colonnes, souligné.
    let x = MARGIN;
    for (const c of t.columns) {
      const s = fit(c.title, c.width - 6, HEAD, true);
      text(c.align === 'right' ? x + c.width - 6 - textWidth(s, HEAD, true) : x, y, s, HEAD, true);
      x += c.width;
    }
    ops.push(`0.6 w ${MARGIN} ${(y - 5).toFixed(2)} m ${PAGE_W - MARGIN} ${(y - 5).toFixed(2)} l S`);
    y -= ROW_H + 2;
    rows.forEach((row, ri) => {
      if (ri % 2 === 1) ops.push(`0.95 g ${MARGIN} ${(y - 4).toFixed(2)} ${PAGE_W - 2 * MARGIN} ${ROW_H} re f 0 g`);
      x = MARGIN;
      t.columns.forEach((c, ci) => {
        const s = fit(row[ci] ?? '', c.width - 6, SIZE);
        text(c.align === 'right' ? x + c.width - 6 - textWidth(s, SIZE) : x, y, s, SIZE);
        x += c.width;
      });
      y -= ROW_H;
    });
    const foot = (t.footer ? t.footer + '   ' : '') + `Page ${pi + 1} / ${pages.length}`;
    text(MARGIN, MARGIN - 12, foot, 8);
    return ops.join('\n');
  });

  // Objets : 1 catalogue, 2 pages, 3-4 polices, puis par page son objet et son contenu.
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  contents.forEach((c, i) => {
    objs[5 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`;
    objs[6 + 2 * i] = `<< /Length ${Buffer.byteLength(c, 'latin1')} >>\nstream\n${c}\nendstream`;
  });

  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(body, 'latin1');
    body += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) body += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  body += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
