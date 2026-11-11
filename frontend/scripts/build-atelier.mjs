// Construit l'Atelier code (niveau « Petits codeurs ») : une page à part, servie
// par Foyer sous la même origine, jamais dans le bundle de l'application.
//
// Le code vient de ScratchJr (vendor/atelier/petits, licence BSD 3 clauses, voir
// MODIFICATIONS.md). esbuild l'assemble tel quel : ni Babel ni webpack.
//
// Le build ÉCHOUE si le résultat contient ce que l'Atelier s'interdit : une
// adresse extérieure, un eval, du SQL, un reste de statistiques. C'est le
// garde-fou de « rien ne sort de la maison », il ne dépend pas d'une relecture.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(racine, 'vendor', 'atelier', 'petits');
const sortie = join(racine, 'dist', 'frontend', 'browser', 'atelier', 'petits');

const NOTICE = `/*! Atelier code, niveau Petits codeurs. Construit à partir du code source de ScratchJr.
 * Copyright (c) 2016, Massachusetts Institute of Technology. Licence BSD 3 clauses : voir LICENSE.txt.
 * Sans lien avec la Scratch Foundation ni approbation de sa part. */`;

/** Les fichiers d'un dossier, récursivement. */
const fichiers = (dossier) => readdirSync(dossier, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? fichiers(join(dossier, e.name)) : [join(dossier, e.name)]));

/** Ce qui est du texte, donc relu par les contrôles. */
const TEXTE = new Set(['.js', '.css', '.html', '.json', '.svg']);

/**
 * Ce que le résultat ne doit pas contenir. Les espaces de noms XML des SVG
 * (w3.org, et ceux des logiciels de dessin) sont des identifiants, pas des
 * adresses contactées : seuls eux sont tolérés.
 */
export function infractions(nom, texte) {
  const trouvees = [];
  const urls = texte.match(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'<>)]*/gi) ?? [];
  for (const url of urls) {
    if (extname(nom) === '.svg' && /^https?:\/\/(www\.w3\.org|ns\.adobe\.com|www\.inkscape\.org|sodipodi\.sourceforge\.net|purl\.org|creativecommons\.org|web\.resource\.org)\//.test(url)) continue;
    if (/^https?:\/\/www\.w3\.org\/(1999|2000)\//.test(url)) continue;
    trouvees.push(`adresse extérieure : ${url}`);
  }
  if (extname(nom) === '.js') {
    if (/\beval\s*\(|\bnew Function\s*\(/.test(texte)) trouvees.push('eval ou new Function');
    // Une instruction entière, ou le début d'une instruction assemblée par
    // morceaux ('update ' + table + ' set '), qui est la forme du code d'origine.
    if (/\b(select\s+[\w*, ]+\s+from|insert\s+into|delete\s+from|update\s+\w+\s+set)\b/i.test(texte)
      || /["'`](select|insert\s+into|delete\s+from|update)\s/i.test(texte)) trouvees.push('instruction SQL');
  }
  if (/firebase|analytics|gtag|googletagmanager/i.test(texte)) trouvees.push('statistiques d’usage');
  if (extname(nom) === '.svg' && /<script|<foreignObject|\son[a-z]+\s*=/i.test(texte)) trouvees.push('SVG actif (script, foreignObject ou gestionnaire)');
  return trouvees;
}

async function construire() {
  if (!existsSync(join(racine, 'dist', 'frontend', 'browser'))) {
    throw new Error('dist/frontend/browser est absent : lancer « ng build » d’abord (npm run build le fait).');
  }
  rmSync(sortie, { recursive: true, force: true });
  mkdirSync(sortie, { recursive: true });
  cpSync(join(source, 'www'), sortie, { recursive: true });
  cpSync(join(source, 'LICENSE'), join(sortie, 'LICENSE.txt'));
  await build({
    entryPoints: [join(source, 'src', 'entry', 'app.js')],
    outfile: join(sortie, 'app.bundle.js'),
    bundle: true,
    minify: true,
    legalComments: 'none',
    banner: { js: NOTICE },
    target: ['es2020', 'safari15'],
    logLevel: 'warning',
  });

  const tous = fichiers(sortie);
  const fautes = tous
    .filter((f) => TEXTE.has(extname(f)))
    .flatMap((f) => infractions(f, readFileSync(f, 'utf8').replace(NOTICE, '')).map((i) => `${relative(sortie, f)} : ${i}`));
  if (fautes.length) {
    throw new Error(`L’Atelier contient ce qu’il s’interdit :\n  ${fautes.join('\n  ')}`);
  }

  // La liste des fichiers, pour le cache hors ligne (lu par le service worker
  // dans une étape ultérieure) et pour mesurer ce que pèse l'Atelier.
  const liste = tous.map((f) => relative(sortie, f).split('\\').join('/')).sort();
  const octets = tous.reduce((n, f) => n + statSync(f).size, 0);
  writeFileSync(join(sortie, 'fichiers.json'), `${JSON.stringify({ fichiers: liste, octets }, null, 1)}\n`);
  console.log(`[atelier] ${liste.length} fichiers, ${(octets / 1048576).toFixed(1)} Mo, bundle ${(statSync(join(sortie, 'app.bundle.js')).size / 1024).toFixed(0)} Ko`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  construire().catch((e) => { console.error(`[atelier] ERREUR : ${e.message}`); process.exit(1); });
}
