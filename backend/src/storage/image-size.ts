// Les dimensions d'une image, lues dans son en-tête, sans la décoder et sans
// dépendance. Sert à refuser une photo qui n'a pas été redimensionnée avant
// l'envoi : l'application la ramène à 2 000 px de côté au plus, et le serveur le
// vérifie plutôt que de le croire.
//
// JPEG, PNG et WEBP seulement : ce sont les formats qu'un module qui exige des
// photos réduites accepte. Rendre null veut dire « je ne sais pas lire », et
// l'appelant refuse.

export interface ImageSize { width: number; height: number; }

/** Les marqueurs SOF d'un JPEG (début d'image), qui portent la taille. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpeg(b: Buffer): ImageSize | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    // Remplissage (0xFF répétés) et marqueurs sans longueur.
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (SOF.has(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function png(b: Buffer): ImageSize | null {
  if (b.length < 24 || b.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function webp(b: Buffer): ImageSize | null {
  if (b.length < 30) return null;
  const chunk = b.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  return null;
}

export function imageSize(buf: Buffer, mime: string): ImageSize | null {
  try {
    const s = mime === 'image/jpeg' ? jpeg(buf) : mime === 'image/png' ? png(buf) : mime === 'image/webp' ? webp(buf) : null;
    return s && s.width > 0 && s.height > 0 ? s : null;
  } catch { return null; }
}
