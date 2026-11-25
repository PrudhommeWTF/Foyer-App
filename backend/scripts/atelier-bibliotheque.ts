// Récupère la bibliothèque de l'Atelier code (personnages, décors, sons) auprès
// des serveurs de Scratch, pour ses deux niveaux. Commande d'administration, lancée à la main quand on
// veut refaire la sélection : **jamais** au build ni à l'exécution. En
// fonctionnement, l'Atelier ne contacte aucun domaine tiers.
//
//   cd backend && npx tsx scripts/atelier-bibliotheque.ts --scratch <dossier>
//
// <dossier> est `packages/scratch-gui/src/lib/libraries` d'un clone de
// https://github.com/scratchfoundation/scratch-editor : il contient les listes
// (sprites.json, backdrops.json, sounds.json) qui nomment les fichiers par leur
// empreinte.
// `--cache <dossier>` réutilise des fichiers déjà téléchargés.
//
// Ce que fait le script, dans l'ordre : il écarte ce que exclusions.json nomme
// (marques, doutes, photographies de personnes), télécharge, **vérifie
// l'empreinte MD5**, nettoie chaque SVG avec le même nettoyeur que les dessins
// des enfants, et écrit les fichiers et les listes. Un élément sans nom français
// dans noms.json fait échouer la commande : rien n'entre dans la bibliothèque
// sans avoir été regardé.
//
// Deux sorties, un seul dossier de fichiers (fichiers/) :
//   - catalogue.json, pour les Petits codeurs : le premier costume de chaque
//     personnage, en vectoriel seulement, sans les lettres ni les chiffres ;
//   - grands/*.json, pour les Grands codeurs, au format de leur éditeur : tous
//     les costumes, les images bitmap, les décors et les sons, précédés de ce
//     que Foyer fournit lui-même (Boulon, le décor blanc).
//
// Les fichiers obtenus sont sous licence Creative Commons BY-SA 2.0 (voir le
// dossier de sortie). Ce script, lui, n'en contient aucun.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSvg, svgSize } from '../src/atelier/svg';

const HOST = 'https://cdn.assets.scratch.mit.edu/internalapi/asset';
const OUT = path.join(__dirname, '..', '..', 'frontend', 'vendor', 'atelier', 'bibliotheque');

interface Costume { name: string; md5ext: string; dataFormat: string; }
interface Sound { name: string; md5ext: string; dataFormat: string; }
interface ScratchSprite { name: string; tags: string[]; costumes: Costume[]; sounds: Sound[]; }
interface ScratchBackdrop { name: string; tags: string[]; md5ext: string; dataFormat: string; }
/** Ce que Foyer fournit lui-même au niveau des grands, en tête de chaque liste. */
const OURS = path.join(__dirname, '..', '..', 'frontend', 'vendor', 'atelier', 'grands', 'surcouche', 'packages', 'scratch-gui', 'src', 'lib', 'libraries');
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
  const exclusions = readJson<{ personnages: Record<string, string>; photographies: Record<string, string>; decors: Record<string, string>; sons: Record<string, string>; familles: Record<string, string> }>(path.join(OUT, 'exclusions.json'));
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
  /** Un fichier du niveau des grands : un SVG est nettoyé, une image ou un son est gardé tel quel une fois son empreinte vérifiée. */
  const written = new Set<string>();
  const putAny = async (md5ext: string, what: string): Promise<void> => {
    if (written.has(md5ext)) return;
    written.add(md5ext);
    if (md5ext.endsWith('.svg')) {
      const clean = sanitizeSvg((await fetchVerified(md5ext, cache)).toString('utf8'));
      if (!clean.ok) die(`${what} : ${clean.error}`);
      fs.writeFileSync(path.join(files, md5ext), (clean as { svg: string }).svg);
    } else if (/\.(png|wav)$/.test(md5ext)) fs.writeFileSync(path.join(files, md5ext), await fetchVerified(md5ext, cache));
    else die(`${what} : type de fichier inattendu (${md5ext}).`);
  };
  const stats = { marque: 0, famille: 0, bitmap: 0 };
  const allSprites = readJson<ScratchSprite[]>(path.join(src, 'sprites.json'));
  const allBackdrops = readJson<ScratchBackdrop[]>(path.join(src, 'backdrops.json'));

  const sprites: Entry[] = [];
  for (const s of allSprites) {
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
  for (const b of allBackdrops) {
    if (exclusions.decors[b.name]) { stats.marque++; continue; }
    if (b.dataFormat !== 'svg') { stats.bitmap++; continue; }
    const fr = noms[`decor:${b.name}`] ?? die(`le décor « ${b.name} » n'a pas de nom français dans noms.json.`);
    backgrounds.push({ md5: b.md5ext, ...(await put(b.md5ext, b.name)), ext: 'svg', name: fr, source: b.name });
  }
  backgrounds.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  fs.writeFileSync(path.join(OUT, 'catalogue.json'), `${JSON.stringify({ sprites, backgrounds }, null, 1)}\n`);
  console.log(`[bibliothèque] petits : ${sprites.length} personnages, ${backgrounds.length} décors. `
    + `Écartés : ${stats.marque} pour marque ou doute, ${stats.famille} lettres et chiffres, ${stats.bitmap} en bitmap.`);

  // ---- Grands codeurs : les listes au format de l'éditeur, noms en français ----
  const fr = (key: string, what: string): string => noms[key] ?? die(`${what} n'a pas de nom français dans noms.json : regardez-le avant de l'ajouter.`);
  const soundOut = (x: Sound): boolean => !!exclusions.sons[x.name];
  const gSprites: ScratchSprite[] = [], gBackdrops: ScratchBackdrop[] = [], gSounds: Sound[] = [];
  let photos = 0;
  for (const s of allSprites) {
    const name = s.name.trim();
    if (exclusions.personnages[name]) continue;
    if (exclusions.photographies[name]) { photos++; continue; }
    const sounds = (s.sounds ?? []).filter((x) => !soundOut(x)).map((x) => ({ ...x, name: fr(`son:${x.name}`, `le son « ${x.name} »`) }));
    for (const c of s.costumes) await putAny(c.md5ext, `${name}, costume ${c.name}`);
    for (const x of sounds) await putAny(x.md5ext, `${name}, son ${x.name}`);
    gSprites.push({ ...s, name: fr(name, `« ${name} »`), sounds });
  }
  for (const b of allBackdrops) {
    if (exclusions.decors[b.name]) continue;
    await putAny(b.md5ext, `décor ${b.name}`);
    gBackdrops.push({ ...b, name: fr(`decor:${b.name}`, `le décor « ${b.name} »`) });
  }
  for (const x of readJson<Sound[]>(path.join(src, 'sounds.json'))) {
    if (soundOut(x)) continue;
    await putAny(x.md5ext, `son ${x.name}`);
    gSounds.push({ ...x, name: fr(`son:${x.name}`, `le son « ${x.name} »`) });
  }
  const byName = <T extends { name: string }>(list: T[]): T[] => list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const ours = <T>(file: string): T[] => readJson<T[]>(path.join(OURS, file));
  const grands = path.join(OUT, 'grands');
  fs.rmSync(grands, { recursive: true, force: true });
  fs.mkdirSync(grands, { recursive: true });
  const lists: Record<string, unknown[]> = {
    'sprites.json': [...ours<ScratchSprite>('sprites.json'), ...byName(gSprites)],
    'costumes.json': [...ours<Costume>('costumes.json'), ...gSprites.flatMap((s) => s.costumes)],
    'backdrops.json': [...ours<ScratchBackdrop>('backdrops.json'), ...byName(gBackdrops)],
    'sounds.json': [...ours<Sound>('sounds.json').filter((o) => !gSounds.some((x) => x.md5ext === o.md5ext)), ...byName(gSounds)],
  };
  // L'éditeur retrouve l'élément choisi par son nom : deux éléments du même nom dans une liste, et le second ne peut plus être pris.
  for (const [file, list] of Object.entries(lists)) {
    const names = (list as { name: string }[]).map((x) => x.name);
    const twice = names.filter((n, i) => names.indexOf(n) !== i);
    if (twice.length) die(`${file} : nom en double (${[...new Set(twice)].join(', ')}). Donnez-leur des noms différents dans noms.json.`);
  }
  for (const [file, list] of Object.entries(lists)) fs.writeFileSync(path.join(grands, file), `${JSON.stringify(list)}\n`);
  const octets = fs.readdirSync(files).reduce((n, f) => n + fs.statSync(path.join(files, f)).size, 0);
  console.log(`[bibliothèque] grands : ${gSprites.length} personnages (${gSprites.reduce((n, s) => n + s.costumes.length, 0)} costumes), ${gBackdrops.length} décors, ${gSounds.length} sons. `
    + `Écartés : ${photos} photographies de personnes. ${fs.readdirSync(files).length} fichiers, ${(octets / 1048576).toFixed(1)} Mo.`);
}

main().catch((e) => die((e as Error).message));
