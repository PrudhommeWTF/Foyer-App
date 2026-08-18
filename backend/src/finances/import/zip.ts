// Just enough ZIP reading to open an .xlsx, which is a ZIP of XML parts.
//
// Node ships the inflate codec (zlib), so this is a header walk and nothing
// more. Written by hand rather than pulling in a spreadsheet library: the
// grammar is small, and we only ever read two or three known entries.
import zlib from 'zlib';

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;

interface Entry { name: string; method: number; compressedSize: number; localOffset: number; }

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
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localOffset = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf-8');
    entries.push({ name, method, compressedSize, localOffset });
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
    if (e.method === 0) out.set(e.name, Buffer.from(data));
    else if (e.method === 8) out.set(e.name, zlib.inflateRawSync(data));
    else throw new Error(`Compression ZIP non prise en charge (méthode ${e.method}) pour « ${e.name} ».`);
  }
  return out;
}

/** True when the bytes start with a local file header (PK\3\4). */
export const isZip = (buf: Buffer): boolean =>
  buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

/** True for the OLE2 container used by Excel 97-2003 (.xls binary, BIFF8). */
export const isOle2 = (buf: Buffer): boolean =>
  buf.length > 8 && buf.readUInt32LE(0) === 0xe011cfd0 && buf.readUInt32LE(4) === 0xe11ab1a1;
