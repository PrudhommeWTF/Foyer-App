// Récupère la bibliothèque de personnages et de décors de l'Atelier code auprès
// des serveurs de Scratch. Commande d'administration, lancée à la main quand on
// veut refaire la sélection : **jamais** au build ni à l'exécution. En
// fonctionnement, l'Atelier ne contacte aucun domaine tiers.
//
//   cd backend && npx tsx scripts/atelier-bibliotheque.ts --scratch <dossier>
//
// <dossier> est `packages/scratch-gui/src/lib/libraries` d'un clone de
// https://github.com/scratchfoundation/scratch-editor : il contient les listes
// (sprites.json, backdrops.json) qui nomment les fichiers par leur empreinte.
// `--cache <dossier>` réutilise des fichiers déjà téléchargés.
//
// Ce que fait le script, dans l'ordre : il écarte ce que exclusions.json nomme
// (marques, doutes) et les familles qu'il décrit, ne garde que le premier
// costume de chaque personnage, télécharge, **vérifie l'empreinte MD5**, nettoie
// chaque SVG avec le même nettoyeur que les dessins des enfants, et écrit les
// fichiers et le catalogue. Un personnage sans nom français dans noms.json fait
// échouer la commande : rien n'entre dans la bibliothèque sans avoir été regardé.
//
// Les fichiers obtenus sont sous licence Creative Commons BY-SA 2.0 (voir le
// dossier de sortie). Ce script, lui, n'en contient aucun.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSvg, svgSize } from '../src/atelier/svg';

const HOST = 'https://cdn.assets.scratch.mit.edu/internalapi/asset';
const OUT = path.join(__dirname, '..', '..', 'frontend', 'vendor', 'atelier', 'bibliotheque');

interface Costume { md5ext: string; dataFormat: string; }
interface ScratchSprite { name: string; tags: string[]; costumes: Costume[]; }
interface ScratchBackdrop { name: string; tags: string[]; md5ext: string; dataFormat: string; }
interface Entry { md5: string; width: number; height: number; ext: 'svg'; name: string; order: string; tags: string[]; source: string; }

/** Les rangées de la bibliothèque, dans l'ordre d'affichage, et les étiquettes de Scratch qui y mènent. */
const CATEGORIES: [string, string[]][] = [
  ['animaux', ['animals', 'insect', 'bug', 'dinosaur']],
  ['personnes', ['people', 'person']],
  ['fantastique', ['fantasy', 'space', 'spooky', 'halloween']],
  ['nourriture', ['food']],
  ['musique', ['music']],
  ['sport', ['sports']],
  ['objets', []],
];

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const die = (msg: string): never => { console.error(`[bibliothèque] ERREUR : ${msg}`); process.exit(1); };
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

async function fetchVerified(md5ext: string, cache?: string): Promise<Buffer> {
  const expected = md5ext.split('.')[0];
  const ok = (b: Buffer): boolean => crypto.createHash('md5').update(b).digest('hex') === expected;
  if (cache && fs.existsSync(path.join(cache, md5ext))) {
    const b = fs.readFileSync(path.join(cache, md5ext));
    if (ok(b)) return b;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${HOST}/${md5ext}/get/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const b = Buffer.from(await res.arrayBuffer());
      if (!ok(b)) throw new Error('empreinte MD5 différente de celle annoncée');
      return b;
    } catch (e) {
      if (attempt === 3) die(`${md5ext} : ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function main(): Promise<void> {
  const src = arg('scratch') ?? die('indiquez --scratch <dossier des listes de Scratch>.');
  const cache = arg('cache');
  const exclusions = readJson<{ personnages: Record<string, string>; decors: Record<string, string>; familles: Record<string, string> }>(path.join(OUT, 'exclusions.json'));
  const noms = readJson<Record<string, string>>(path.join(OUT, 'noms.json'));
  const family = new RegExp(Object.keys(exclusions.familles).find((k) => k.startsWith('^'))!);
  const files = path.join(OUT, 'fichiers');
  fs.rmSync(files, { recursive: true, force: true });
  fs.mkdirSync(files, { recursive: true });

  const put = async (md5ext: string, what: string): Promise<{ width: number; height: number }> => {
    const clean = sanitizeSvg((await fetchVerified(md5ext, cache)).toString('utf8'));
    if (!clean.ok) die(`${what} : ${clean.error}`);
    const svg = (clean as { svg: string }).svg;
    fs.writeFileSync(path.join(files, md5ext), svg);
    return svgSize(svg) ?? die(`${what} : dimensions introuvables.`);
  };
  const stats = { marque: 0, famille: 0, bitmap: 0 };

  const sprites: Entry[] = [];
  for (const s of readJson<ScratchSprite[]>(path.join(src, 'sprites.json'))) {
    const name = s.name.trim(), first = s.costumes[0]!;
    if (exclusions.personnages[name]) { stats.marque++; continue; }
    if (family.test(name)) { stats.famille++; continue; }
    if (first.dataFormat !== 'svg') { stats.bitmap++; continue; }
    const fr = noms[name] ?? die(`« ${name} » n'a pas de nom français dans noms.json : regardez-le avant de l'ajouter.`);
    const rank = CATEGORIES.findIndex(([, tags]) => !tags.length || tags.some((t) => s.tags.includes(t)));
    sprites.push({ md5: first.md5ext, ...(await put(first.md5ext, name)), ext: 'svg', name: fr, order: `characters,${String(rank + 1).padStart(2, '0')} ${CATEGORIES[rank]![0]}`, tags: ['characters', CATEGORIES[rank]![0]], source: name });
  }
  sprites.sort((a, b) => a.order.localeCompare(b.order) || a.name.localeCompare(b.name, 'fr'));

  const backgrounds: Omit<Entry, 'order' | 'tags'>[] = [];
  for (const b of readJson<ScratchBackdrop[]>(path.join(src, 'backdrops.json'))) {
    if (exclusions.decors[b.name]) { stats.marque++; continue; }
    if (b.dataFormat !== 'svg') { stats.bitmap++; continue; }
    const fr = noms[`decor:${b.name}`] ?? die(`le décor « ${b.name} » n'a pas de nom français dans noms.json.`);
    backgrounds.push({ md5: b.md5ext, ...(await put(b.md5ext, b.name)), ext: 'svg', name: fr, source: b.name });
  }
  backgrounds.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  fs.writeFileSync(path.join(OUT, 'catalogue.json'), `${JSON.stringify({ sprites, backgrounds }, null, 1)}\n`);
  const octets = fs.readdirSync(files).reduce((n, f) => n + fs.statSync(path.join(files, f)).size, 0);
  console.log(`[bibliothèque] ${sprites.length} personnages, ${backgrounds.length} décors, ${(octets / 1048576).toFixed(1)} Mo. `
    + `Écartés : ${stats.marque} pour marque ou doute, ${stats.famille} lettres et chiffres, ${stats.bitmap} en bitmap.`);
}

main().catch((e) => die((e as Error).message));
