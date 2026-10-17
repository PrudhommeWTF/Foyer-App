// Écrire une archive ZIP, sans dépendance et sans compression.
//
// Le pendant du lecteur de finances/import/zip.ts. Pas de compression : ce
// qu'on archive ici (factures en PDF, photos en JPEG) l'est déjà, et la
// méthode « stockée » se lit partout (Finder, Fichiers sur iPhone, Windows).
//
// Les entrées partent l'une après l'autre dans le flux de sortie : seule une
// entrée à la fois est en mémoire, si bien que 100 Mo de factures ne font
// jamais 100 Mo dans le processus. Le répertoire central, quelques dizaines
// d'octets par entrée, est gardé jusqu'à la fin. Pas de ZIP64 : l'archive
// reste sous 4 Go, ce qui laisse de la marge pour les factures d'une maison.

/** Où vont les octets : une réponse HTTP, ou un tampon pour les tests. */
export interface ZipSink { write(chunk: Buffer): unknown; }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date et heure au format MS-DOS, en heure locale du serveur (ce que les outils affichent). */
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  private offset = 0;
  private central: Buffer[] = [];
  private count = 0;
  private names = new Set<string>();
  constructor(private sink: ZipSink, private now = new Date()) {}

  private out(b: Buffer): void { this.sink.write(b); this.offset += b.length; }

  /**
   * Un nom unique dans l'archive : un second « facture.pdf » devient
   * « facture (2).pdf ». Les séparateurs et caractères refusés par Windows
   * sont remplacés, le chemin reste celui qu'on a choisi.
   */
  uniqueName(path: string): string {
    const clean = path.split('/').map((p) => p.replace(/[\\:*?"<>|\x00-\x1f]/g, '_').trim() || '_').join('/');
    if (!this.names.has(clean)) return clean;
    const m = /^(.*?)(\.[^./]*)?$/.exec(clean)!;
    for (let i = 2; ; i++) { const n = `${m[1]} (${i})${m[2] || ''}`; if (!this.names.has(n)) return n; }
  }

  /** Ajoute une entrée. Rend le nom retenu (dédoublonné). */
  add(path: string, data: Buffer): string {
    const name = this.uniqueName(path);
    this.names.add(name);
    const nameBuf = Buffer.from(name, 'utf-8');
    const crc = crc32(data);
    const { time, date } = dosTime(this.now);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version requise
    local.writeUInt16LE(0x0800, 6);      // noms en UTF-8
    local.writeUInt16LE(0, 8);           // stockée, sans compression
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const at = this.offset;
    this.out(local); this.out(nameBuf); this.out(data);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(at, 42);
    this.central.push(c, nameBuf);
    this.count++;
    return name;
  }

  /** Écrit le répertoire central et la fin d'archive. */
  finish(): void {
    const start = this.offset;
    for (const b of this.central) this.out(b);
    const size = this.offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.count, 8); end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(size, 12); end.writeUInt32LE(start, 16);
    this.out(end);
  }
}
