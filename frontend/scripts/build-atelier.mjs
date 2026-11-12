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
const bibliotheque = join(racine, 'vendor', 'atelier', 'bibliotheque');
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

/**
 * Le niveau « Grands codeurs » embarque des dizaines de bibliothèques, dont le
 * code cite des adresses dans ses messages d'erreur, ses commentaires de licence
 * et ses espaces de noms XML. Aucune n'est contactée, mais « aucune » ne se
 * décrète pas : chaque hôte présent doit figurer ici, avec ce qu'il est. Un hôte
 * absent de cette liste fait échouer le build. Les serveurs de Scratch, de
 * statistiques ou de vidéo n'y sont pas et ne doivent jamais y entrer.
 */
export const HOTES_INERTES = {
  'www.w3.org': 'espaces de noms XML (SVG, XLink, XHTML)',
  'ns.adobe.com': 'espaces de noms XML des fichiers Illustrator',
  'www.inkscape.org': 'espace de noms XML', 'inkscape.sourceforge.net': 'espace de noms XML', 'sodipodi.sourceforge.net': 'espace de noms XML',
  'purl.org': 'espace de noms XML', 'creativecommons.org': 'espace de noms XML', 'schemas.microsoft.com': 'espace de noms XML',
  'www.bohemiancoding.com': 'espace de noms XML (Sketch)', 'www.figma.com': 'espace de noms XML', 'www.serif.com': 'espace de noms XML',
  'www.vector.evaxdesign.sk': 'espace de noms XML', 'krita.org': 'espace de noms XML', 'boxy-svg.com': 'espace de noms XML',
  'taptrix.com': 'espace de noms XML', 'dummy.namespace': 'espace de noms XML factice',
  'developers.google.com': 'espace de noms XML de Blockly, et renvoi à sa documentation dans un message d’erreur',
  'blockly-demo.appspot.com': 'dossier d’images par défaut de Blockly, jamais utilisé : l’éditeur lui donne le sien (static/blocks-media)',
  'github.com': 'renvois à la documentation dans des messages d’erreur et des commentaires',
  'formatjs.io': 'renvois à la documentation dans des messages d’erreur', 'fb.me': 'renvois à la documentation de React dans des messages d’erreur',
  'reactjs.org': 'renvoi à la documentation', 'redux.js.org': 'renvoi à la documentation', 'stuk.github.io': 'renvoi à la documentation de JSZip',
  'en.wikipedia.org': 'références dans des commentaires', 'css-tricks.com': 'références dans des commentaires',
  'bugzilla.mozilla.org': 'références dans des commentaires', 'lua-users.org': 'référence dans un commentaire',
  'www.youtube.com': 'référence dans un commentaire du code de Paper.js', 'www.chilliant.com': 'référence dans un commentaire',
  'asawicki.info': 'référence dans un commentaire', 'marijnhaverbeke.nl': 'mention d’auteur', 'juerglehni.com': 'mention d’auteur de Paper.js',
  'puckey.studio': 'mention d’auteur de Paper.js', 'paperjs.org': 'mention d’origine de Paper.js',
};

/** Les hôtes cités par un texte et qui ne sont pas dans la liste. */
export function hotesInconnus(texte) {
  const hotes = new Set();
  for (const m of texte.matchAll(/(?:[a-z][a-z0-9+.-]*:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?=[/:"'`\s)<>,;]|$)/gi)) hotes.add(m[1].toLowerCase());
  return [...hotes].filter((h) => !(h in HOTES_INERTES)).sort();
}

/** Recopie le niveau « Grands codeurs », construit ailleurs (vendor/atelier/grands/construire.sh), et le contrôle. */
function grandsCodeurs() {
  const construit = join(racine, 'vendor', 'atelier', 'grands', 'dist');
  const cible = join(racine, 'dist', 'frontend', 'browser', 'atelier', 'grands');
  rmSync(cible, { recursive: true, force: true });
  cpSync(construit, cible, { recursive: true });
  const tous = fichiers(cible);
  const fautes = [];
  for (const f of tous.filter((x) => TEXTE.has(extname(x)))) {
    const texte = readFileSync(f, 'utf8');
    for (const h of hotesInconnus(texte)) fautes.push(`${relative(cible, f)} : hôte inconnu ${h}`);
    if (/firebase|google-analytics|googletagmanager|wistia/i.test(texte)) fautes.push(`${relative(cible, f)} : statistiques ou vidéo en ligne`);
    if (extname(f) === '.svg' && /<script|<foreignObject|\son[a-z]+\s*=/i.test(texte)) fautes.push(`${relative(cible, f)} : SVG actif`);
  }
  if (fautes.length) throw new Error(`Le niveau Grands codeurs contient ce que l’Atelier s’interdit :\n  ${fautes.join('\n  ')}`);
  const liste = tous.map((f) => relative(cible, f).split('\\').join('/')).sort();
  const octets = tous.reduce((n, f) => n + statSync(f).size, 0);
  writeFileSync(join(cible, 'fichiers.json'), `${JSON.stringify({ fichiers: liste, octets }, null, 1)}\n`);
  console.log(`[atelier] grands : ${liste.length} fichiers, ${(octets / 1048576).toFixed(1)} Mo`);
}

async function construire() {
  if (!existsSync(join(racine, 'dist', 'frontend', 'browser'))) {
    throw new Error('dist/frontend/browser est absent : lancer « ng build » d’abord (npm run build le fait).');
  }
  rmSync(sortie, { recursive: true, force: true });
  mkdirSync(sortie, { recursive: true });
  cpSync(join(source, 'www'), sortie, { recursive: true });
  cpSync(join(source, 'LICENSE'), join(sortie, 'LICENSE.txt'));

  // La bibliothèque de personnages et de décors (vendor/atelier/bibliotheque,
  // issue de Scratch, licence CC BY-SA 2.0) rejoint les quelques éléments de
  // départ : ses fichiers à côté des leurs, son catalogue à la suite du leur.
  cpSync(join(bibliotheque, 'fichiers'), join(sortie, 'svglibrary'), { recursive: true });
  cpSync(join(bibliotheque, 'LICENCE.md'), join(sortie, 'svglibrary', 'LICENCE.md'));
  const media = JSON.parse(readFileSync(join(sortie, 'media.json'), 'utf8'));
  const catalogue = JSON.parse(readFileSync(join(bibliotheque, 'catalogue.json'), 'utf8'));
  const sansSource = ({ source: _source, ...entree }) => entree;
  media.sprites.push(...catalogue.sprites.map(sansSource));
  media.backgrounds.push(...catalogue.backgrounds.map(sansSource));
  writeFileSync(join(sortie, 'media.json'), JSON.stringify(media));
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
  console.log(`[atelier] petits : ${liste.length} fichiers, ${(octets / 1048576).toFixed(1)} Mo, bundle ${(statSync(join(sortie, 'app.bundle.js')).size / 1024).toFixed(0)} Ko`);
  grandsCodeurs();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  construire().catch((e) => { console.error(`[atelier] ERREUR : ${e.message}`); process.exit(1); });
}
