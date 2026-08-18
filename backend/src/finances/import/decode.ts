// Byte-level decoding of an uploaded export.
//
// Bankin' currently exports UTF-8, but has shipped Windows-1252 in the past and
// the difference is invisible in a 2 000-line file until an accented label lands
// in the wrong place. We sniff rather than assume, and report what we used.

/** Windows-1252 only differs from Latin-1 in 0x80-0x9F; these are the ones that matter. */
const CP1252_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function fromCp1252(buf: Buffer): string {
  let out = '';
  for (const b of buf) out += b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b] ?? '�') : String.fromCharCode(b);
  return out;
}

/** Whether the bytes form valid UTF-8 (Node substitutes U+FFFD when they do not). */
function isValidUtf8(buf: Buffer): boolean {
  return !buf.toString('utf-8').includes('�');
}

export interface Decoded { text: string; encoding: string; }

/**
 * Decode an uploaded file to text. BOM wins when present; otherwise valid UTF-8
 * is assumed, and anything else falls back to Windows-1252 (the only other
 * encoding French banks emit in practice).
 */
export function decodeText(buf: Buffer): Decoded {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf-8'), encoding: 'UTF-8 (BOM)' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.subarray(2).toString('utf16le'), encoding: 'UTF-16 LE' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // Node has no utf16be decoder: swap the pairs and reuse utf16le.
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'UTF-16 BE' };
  }
  if (isValidUtf8(buf)) return { text: buf.toString('utf-8'), encoding: 'UTF-8' };
  return { text: fromCp1252(buf), encoding: 'Windows-1252' };
}
