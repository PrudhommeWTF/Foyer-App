// Just enough ZIP reading to open an .xlsx, which is a ZIP of XML parts.
//
// Node ships the inflate codec (zlib), so this is a header walk and nothing
// more. Written by hand rather than pulling in a spreadsheet library: the
// grammar is small, and we only ever read two or three known entries.
import zlib from 'zlib';

/**
 * Ce qu'une entrée a le droit de peser une fois décompressée.
 *
 * Sans cette borne, `inflateRawSync` va jusqu'à ce que zlib s'arrête, c'est-à-dire
 * jusqu'à deux gigaoctets. Mesuré : un faux .xlsx de 305 Ko amenait le service à
 * 988 Mo de mémoire résidente et bloquait le processus près de six secondes. Le
 * plafond de téléversement étant de 25 Mo et le taux de compression du zéro
 * d'environ mille pour un, un seul fichier pouvait viser vingt-cinq gigaoctets :
 * le conteneur est tué par le noyau, et le foyer perd son application.
 *
 * Soixante-quatre mégaoctets laissent passer très largement le plus gros relevé
 * qu'une banque produise, et tiennent dans la mémoire du conteneur.
 */
const MAX_INFLATED = 64 * 1024 * 1024;

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;

interface Entry { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number; }

/** Locate the end-of-central-directory record, scanning back over the comment. */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** Map of entry name to raw bytes. Only the requested entries are inflated. */
export function readZip(buf: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("Archive ZIP invalide (fin d'archive introuvable).");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);

  const entries: Entry[] = [];
  for (let i = 0; i < count && at + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(at) !== CDIR_SIG) break;
    const method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20);
    const uncompressedSize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localOffset = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf-8');
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    at += 46 + nameLen + extraLen + commentLen;
  }

  const out = new Map<string, Buffer>();
  for (const e of entries) {
    if (!wanted(e.name)) continue;
    // The local header repeats the name and extra fields, with its own lengths.
    const nameLen = buf.readUInt16LE(e.localOffset + 26);
    const extraLen = buf.readUInt16LE(e.localOffset + 28);
    const start = e.localOffset + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + e.compressedSize);
    // Le répertoire central annonce la taille décompressée : quand elle est déjà
    // hors limite, on refuse sans rien allouer. Un en-tête peut mentir, d'où la
    // seconde borne, celle que zlib fait respecter pendant la décompression.
    if (e.uncompressedSize > MAX_INFLATED) throw new Error(tropGros(e.name, e.uncompressedSize));
    if (e.method === 0) out.set(e.name, Buffer.from(data));
    else if (e.method === 8) {
      try {
        out.set(e.name, zlib.inflateRawSync(data, { maxOutputLength: MAX_INFLATED }));
      } catch (err) {
        // Au-delà de la borne, zlib rend soit ERR_BUFFER_TOO_LARGE, soit une
        // « buffer error » : deux formulations illisibles pour qui les lit dans
        // un journal, et c'est justement le cas qu'on veut nommer.
        const code = (err as { code?: string }).code ?? '';
        const texte = String((err as Error).message ?? '');
        if (/ERR_BUFFER_TOO_LARGE|ERR_ZLIB/.test(code) || /maxOutputLength|buffer error|larger than/i.test(texte)) {
          throw new Error(tropGros(e.name));
        }
        throw err;
      }
    }
    else throw new Error(`Compression ZIP non prise en charge (méthode ${e.method}) pour « ${e.name} ».`);
  }
  return out;
}

/** Le message de refus, le même que la taille soit annoncée ou constatée. */
function tropGros(nom: string, taille?: number): string {
  const poids = taille ? ` (${Math.round(taille / 1048576)} Mo annoncés)` : '';
  return `L'entrée « ${nom} » de cette archive dépasse ${MAX_INFLATED / 1048576} Mo une fois décompressée${poids}. `
    + 'Un relevé bancaire ne pèse pas cela : le fichier est refusé.';
}

/** True when the bytes start with a local file header (PK\3\4). */
export const isZip = (buf: Buffer): boolean =>
  buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

/** True for the OLE2 container used by Excel 97-2003 (.xls binary, BIFF8). */
export const isOle2 = (buf: Buffer): boolean =>
  buf.length > 8 && buf.readUInt32LE(0) === 0xe011cfd0 && buf.readUInt32LE(4) === 0xe11ab1a1;
