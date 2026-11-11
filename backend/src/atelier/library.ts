// La bibliothèque ajoutée par la famille : des SVG déposés à la main dans
// FOYER_DATA_DIR/atelier/bibliotheque/personnages et …/decors, pris en compte au
// démarrage, sans reconstruire l'application. Ils s'ajoutent à la bibliothèque
// livrée avec l'éditeur (frontend/vendor/atelier/bibliotheque).
//
// Un fichier déposé n'est jamais servi tel quel : il passe par le même nettoyage
// que le dessin d'un enfant, et c'est le résultat qui est gardé en mémoire et
// servi. Un fichier refusé est nommé dans le journal, il ne bloque rien.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../log';
import { sanitizeSvg, svgSize } from './svg';

export interface LibraryEntry { md5: string; width: number; height: number; ext: 'svg'; name: string; order?: string; tags?: string[]; }

const NOTICE = `# Licences des dessins ajoutés à la bibliothèque de l'Atelier

Notez ici, pour chaque fichier déposé dans personnages/ ou decors/, d'où il vient
et sous quelle licence. N'y déposez que des dessins que vous avez le droit
d'utiliser : les vôtres, ou des dessins libres de droits.

| Fichier | Source | Licence |
|---|---|---|
`;

let sprites: LibraryEntry[] = [];
let backgrounds: LibraryEntry[] = [];
const content = new Map<string, Buffer>();

function scan(dir: string, what: string): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.svg')).sort((a, b) => a.localeCompare(b, 'fr'))) {
    let raw: string;
    try { raw = fs.readFileSync(path.join(dir, file), 'utf8'); } catch (e) { log.erreur(`Atelier : ${what} « ${file} » illisible`, e); continue; }
    const clean = sanitizeSvg(raw);
    const size = clean.ok ? svgSize(clean.svg) : null;
    if (!clean.ok || !size) { log.info(`Atelier : ${what} « ${file} » écarté de la bibliothèque (${clean.ok ? 'dimensions introuvables : ajoutez width et height, ou une viewBox' : clean.error}).`); continue; }
    const buf = Buffer.from(clean.svg, 'utf8');
    const md5 = crypto.createHash('md5').update(buf).digest('hex') + '.svg';
    content.set(md5, buf);
    out.push({ md5, ...size, ext: 'svg', name: path.basename(file, path.extname(file)).slice(0, 40) });
  }
  return out;
}

/** Relit les deux dossiers. Appelé au démarrage ; les crée, avec le fichier de licences, s'ils manquent. */
export function loadFamilyLibrary(dataDir: string): { personnages: number; decors: number } {
  const root = path.join(dataDir, 'atelier', 'bibliotheque');
  content.clear();
  try {
    for (const d of ['personnages', 'decors']) fs.mkdirSync(path.join(root, d), { recursive: true });
    if (!fs.existsSync(path.join(root, 'LICENCES.md'))) fs.writeFileSync(path.join(root, 'LICENCES.md'), NOTICE);
    sprites = scan(path.join(root, 'personnages'), 'personnage').map((e) => ({ ...e, order: 'characters,00 famille', tags: ['characters', 'famille'] }));
    backgrounds = scan(path.join(root, 'decors'), 'décor');
  } catch (e) {
    log.erreur('Atelier : bibliothèque de la famille illisible', e);
    sprites = []; backgrounds = [];
  }
  if (sprites.length || backgrounds.length) log.info(`Atelier : bibliothèque de la famille, ${sprites.length} personnage(s) et ${backgrounds.length} décor(s).`);
  return { personnages: sprites.length, decors: backgrounds.length };
}

export const familyLibrary = (): { sprites: LibraryEntry[]; backgrounds: LibraryEntry[] } => ({ sprites, backgrounds });
export const familyFile = (name: string): Buffer | null => content.get(name) ?? null;
