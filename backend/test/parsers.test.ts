// Lecture des formats acceptés : CSV, OFX 1.x et 2.x, CAMT.053, .xlsx, faux
// .xls (tableau HTML), et refus explicite du binaire Excel 97-2003.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { describe, it } from 'node:test';
import { UnsupportedFile, parseFile } from '../src/finances/import/parse';
import { decodeText } from '../src/finances/import/decode';
import { sniffSeparator, splitDelimited } from '../src/finances/import/csv';

const utf8 = (s: string): Buffer => Buffer.from(s, 'utf-8');

// ---- fabrication d'un .xlsx minimal, pour éprouver le lecteur ZIP ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function makeZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const deflated = zlib.deflateRawSync(f.data);
    const name = Buffer.from(f.name, 'utf-8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc32(f.data), 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, deflated);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc32(f.data), 16);
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + deflated.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** A one-sheet workbook whose cells are all inline strings. */
function makeXlsx(rows: string[][]): Buffer {
  const col = (i: number): string => String.fromCharCode(65 + i);
  const body = rows.map((cells, r) =>
    `<row r="${r + 1}">${cells.map((c, i) =>
      `<c r="${col(i)}${r + 1}" t="inlineStr"><is><t>${c.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c>`).join('')}</row>`).join('');
  return makeZip([
    { name: 'xl/worksheets/sheet1.xml', data: utf8(`<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`) },
  ]);
}

describe('découpage délimité', () => {
  it('respecte les guillemets, les séparateurs internes et les doubles guillemets', () => {
    const rows = splitDelimited('a;b\n"Retraits, Chq. et Vir.";"dit ""bonjour"""\n', ';');
    assert.deepEqual(rows, [['a', 'b'], ['Retraits, Chq. et Vir.', 'dit "bonjour"']]);
  });

  it('devine le séparateur sur l’en-tête le plus cohérent', () => {
    assert.equal(sniffSeparator('Date;Description;Montant\n"01/01/2026";"X";"-1.0"\n'), ';');
    assert.equal(sniffSeparator('Date,Description,Montant\n2026-01-01,X,-1.00\n'), ',');
    assert.equal(sniffSeparator('Date\tDescription\tMontant\n2026-01-01\tX\t-1.00\n'), '\t');
  });
});

describe('CSV', () => {
  it('lit le format Bankin et le format anglais avec la même logique', () => {
    const bankin = parseFile(utf8('Date;Description;Compte;Montant;Catégorie;Sous-Catégorie;Note;Pointée\n"17/08/2026";"Prlv X";"Joint";"-562.0";"Impôts";"Fonciers";"note";"Oui"\n'), 'a.csv');
    assert.equal(bankin.rows.length, 1);
    assert.deepEqual(
      { ...bankin.rows[0], line: 0 },
      { line: 0, date: '2026-08-17', amount: -56200, label: 'Prlv X', accountLabel: 'Joint', category: 'Impôts', subCategory: 'Fonciers', notes: 'note', cleared: true },
    );

    const english = parseFile(utf8('date,description,amount,asset_account,category,subcategory,notes\n2026-08-17,Prlv X,-562.00,Joint,Taxes,Land,\n'), 'b.csv');
    assert.equal(english.rows.length, 1);
    assert.equal(english.rows[0].amount, -56200);
    assert.equal(english.rows[0].accountLabel, 'Joint');
  });

  it('accepte des colonnes débit et crédit séparées', () => {
    const r = parseFile(utf8('Date;Libellé;Débit;Crédit\n01/08/2026;Loyer;750,00;\n02/08/2026;Salaire;;2500,00\n'), 'c.csv');
    assert.deepEqual(r.rows.map((x) => x.amount), [-75000, 250000]);
  });

  it('rejette les lignes illisibles en nommant la ligne et le motif', () => {
    const r = parseFile(utf8('Date;Description;Montant\n01/08/2026;OK;-10,00\nn’importe quoi;Cassée;-10,00\n03/08/2026;Sans montant;abc\n'), 'd.csv');
    assert.equal(r.rows.length, 1);
    assert.equal(r.rejected.length, 2);
    assert.equal(r.rejected[0].line, 3);
    assert.match(r.rejected[0].reason, /Date illisible/);
    assert.match(r.rejected[1].reason, /Montant illisible/);
  });

  it('explique quelles colonnes manquent au lieu d’échouer en silence', () => {
    const r = parseFile(utf8('Colonne1;Colonne2\na;b\n'), 'e.csv');
    assert.equal(r.rows.length, 0);
    assert.match(r.rejected[0].reason, /Colonnes introuvables/);
    assert.match(r.rejected[0].reason, /Séparateur détecté/);
  });
});

describe('encodage', () => {
  it('lit l’UTF-8, avec ou sans BOM', () => {
    assert.deepEqual(decodeText(utf8('Impôts')), { text: 'Impôts', encoding: 'UTF-8' });
    assert.equal(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8('Impôts')])).encoding, 'UTF-8 (BOM)');
  });

  it('bascule sur Windows-1252 quand les octets ne sont pas de l’UTF-8 valide', () => {
    // « Impôts » en CP1252 : ô vaut 0xF4, invalide en UTF-8 isolé.
    const cp1252 = Buffer.from([0x49, 0x6d, 0x70, 0xf4, 0x74, 0x73]);
    const decoded = decodeText(cp1252);
    assert.equal(decoded.encoding, 'Windows-1252');
    assert.equal(decoded.text, 'Impôts');
  });

  it('rend le symbole euro du Windows-1252', () => {
    assert.equal(decodeText(Buffer.from([0x80, 0xe9])).text, '€é');
  });

  it('reporte l’encodage utilisé dans le résultat de lecture', () => {
    const r = parseFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8('Date;Description;Montant\n01/08/2026;X;-1,00\n')]), 'f.csv');
    assert.equal(r.encoding, 'UTF-8 (BOM)');
  });
});

describe('OFX', () => {
  const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>EUR
<BANKACCTFROM><BANKID>30003<ACCTID>00012345678<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260817120000[+1:CET]<TRNAMT>-562.00<FITID>A1<NAME>Prlv Direction Generale Des Fin</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260808<TRNAMT>1700.00<FITID>A2<NAME>Correction Virement Rejete</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it('lit l’OFX 1.x, dont les balises de valeur ne sont jamais fermées', () => {
    const r = parseFile(utf8(SGML), 'x.ofx');
    assert.equal(r.format, 'OFX 1.x (SGML)');
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0].date, '2026-08-17');
    assert.equal(r.rows[0].amount, -56200);
    assert.equal(r.rows[0].label, 'Prlv Direction Generale Des Fin');
    assert.match(r.rows[0].accountLabel, /00012345678/);
    assert.equal(r.rows[1].amount, 170000);
  });

  it('lit l’OFX 2.x en XML', () => {
    const xml = `<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
      <BANKACCTFROM><ACCTID>987654</ACCTID><ACCTTYPE>SAVINGS</ACCTTYPE></BANKACCTFROM>
      <BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260805</DTPOSTED>
      <TRNAMT>-50.00</TRNAMT><FITID>B1</FITID><NAME>Retrait Dab</NAME><MEMO>Remoulins</MEMO>
      </STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const r = parseFile(utf8(xml), 'x.ofx');
    assert.equal(r.format, 'OFX 2.x (XML)');
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].label, 'Retrait Dab Remoulins');
    assert.equal(r.rows[0].amount, -5000);
  });

  it('sépare les comptes quand le fichier porte plusieurs relevés', () => {
    const two = SGML.replace('</BANKMSGSRSV1>', `<STMTTRNRS><STMTRS>
      <BANKACCTFROM><ACCTID>99999<ACCTTYPE>CHECKING</BANKACCTFROM>
      <BANKTRANLIST><STMTTRN><DTPOSTED>20260801<TRNAMT>-10.00<FITID>C1<NAME>Autre compte</STMTTRN>
      </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>`);
    const labels = new Set(parseFile(utf8(two), 'x.ofx').rows.map((r) => r.accountLabel));
    assert.equal(labels.size, 2);
  });
});

describe('CAMT.053', () => {
  const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>
<Stmt><Acct><Id><IBAN>FR7630003012340000123456789</IBAN></Id><Ownr><Nm>M DUPONT</Nm></Ownr></Acct>
<Ntry><Amt Ccy="EUR">562.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
  <BookgDt><Dt>2026-08-17</Dt></BookgDt><NtryRef>R1</NtryRef>
  <NtryDtls><TxDtls><RmtInf><Ustrd>Prlv Direction Generale Des Fin</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">1700.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>PDNG</Sts>
  <ValDt><Dt>2026-08-08</Dt></ValDt><AddtlNtryInf>Correction Virement Rejete</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

  it('lit les écritures, avec le bon signe et le bon libellé', () => {
    const r = parseFile(utf8(CAMT), 'x.xml');
    assert.equal(r.format, 'CAMT.053');
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0].amount, -56200);
    assert.equal(r.rows[0].label, 'Prlv Direction Generale Des Fin');
    assert.equal(r.rows[0].cleared, true, 'BOOK vaut pointée');
    assert.equal(r.rows[1].amount, 170000, 'CRDT crédite le compte');
    assert.equal(r.rows[1].date, '2026-08-08', 'à défaut de date comptable, la date de valeur');
    assert.equal(r.rows[1].cleared, false, 'PDNG n’est pas pointée');
  });

  it('nomme le compte par son titulaire et son IBAN', () => {
    const r = parseFile(utf8(CAMT), 'x.xml');
    assert.match(r.rows[0].accountLabel, /M DUPONT/);
    assert.match(r.rows[0].accountLabel, /FR7630003012340000123456789/);
  });
});

describe('tableurs', () => {
  it('lit un vrai .xlsx, quelle que soit son extension', () => {
    const buf = makeXlsx([
      ['Date', 'Description', 'Compte', 'Montant'],
      ['17/08/2026', 'Prlv Direction Generale Des Fin', 'Joint', '-562.00'],
      ['05/08/2026', 'Retrait Dab', 'Joint', '-50.00'],
    ]);
    const r = parseFile(buf, 'export.xls');
    assert.equal(r.format, 'XLSX');
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0].amount, -56200);
    assert.equal(r.rows[1].label, 'Retrait Dab');
  });

  it('convertit les dates stockées en numéro de série', () => {
    // 46251 correspond au 17/08/2026 dans la numérotation d'Excel.
    const r = parseFile(makeXlsx([['Date', 'Description', 'Montant'], ['46251', 'X', '-1.00']]), 'x.xlsx');
    assert.equal(r.rows[0].date, '2026-08-17');
  });

  it('ne prend pas un montant pour une date', () => {
    const r = parseFile(makeXlsx([['Date', 'Description', 'Montant'], ['12345678', 'X', '-1.00']]), 'x.xlsx');
    assert.equal(r.rows.length, 0);
    assert.match(r.rejected[0].reason, /Date illisible/);
  });

  it('lit un faux .xls qui est en réalité un tableau HTML', () => {
    const html = `<html><body><table>
      <tr><th>Date</th><th>Description</th><th>Compte</th><th>Montant</th></tr>
      <tr><td>17/08/2026</td><td>Prlv&nbsp;Direction</td><td>Joint</td><td>-562,00</td></tr>
    </table></body></html>`;
    const r = parseFile(utf8(html), 'export.xls');
    assert.equal(r.format, 'Tableau HTML');
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].label, 'Prlv Direction');
    assert.equal(r.rows[0].amount, -56200);
  });

  it('lit un faux .xls qui est en réalité du texte tabulé', () => {
    const r = parseFile(utf8('Date\tDescription\tMontant\n17/08/2026\tPrlv X\t-562,00\n'), 'export.xls');
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].amount, -56200);
  });

  it('refuse le binaire Excel 97-2003 avec la marche à suivre', () => {
    const ole2 = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    assert.throws(() => parseFile(ole2, 'vieux.xls'), (e: Error) => {
      assert.ok(e instanceof UnsupportedFile);
      assert.match(e.message, /Excel 97-2003/);
      assert.match(e.message, /CSV/);
      return true;
    });
  });
});

describe('fichiers inutilisables', () => {
  it('refuse un fichier vide', () => {
    assert.throws(() => parseFile(Buffer.alloc(0), 'vide.csv'), /vide/i);
  });

  it('refuse un XML qui n’est ni OFX ni CAMT, en nommant les formats acceptés', () => {
    assert.throws(
      () => parseFile(utf8('<?xml version="1.0"?><catalogue><item/></catalogue>'), 'autre.xml'),
      /CSV, OFX, CAMT.053/,
    );
  });
});
