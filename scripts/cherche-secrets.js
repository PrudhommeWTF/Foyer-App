#!/usr/bin/env node
// Recherche de secrets dans les fichiers versionnés.
//
// Le dépôt est propre aujourd'hui : quatre-vingts commits ont été passés au
// crible pendant l'audit, sans une seule clé. Ce script est là pour qu'il le
// reste, et il fait échouer la construction plutôt que de se contenter d'un
// avertissement que personne ne lit.
//
// Il ne remplace pas un outil dédié : il attrape les formes qui traînent
// réellement dans un dépôt de ce genre, un secret JWT collé dans un fichier de
// configuration, une clé privée oubliée, un jeton d'API copié depuis une
// interface web. C'est le filet qui manquait, pas une garantie.
const { execSync } = require('node:child_process');
const fs = require('node:fs');

/** Ce qu'on cherche, et ce que ça voudrait dire de le trouver. */
const MOTIFS = [
  { nom: 'clé privée', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { nom: 'jeton GitHub', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/ },
  { nom: 'clé AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nom: 'jeton Slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { nom: 'clé Google', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { nom: 'secret JWT posé en clair', re: /FOYER_JWT_SECRET\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}["']?/ },
  { nom: 'clé VAPID privée posée en clair', re: /FOYER_VAPID_PRIVATE\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{20,}["']?/ },
  { nom: 'URL portant un mot de passe', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]{6,}@/ },
];

/**
 * Ce qu'on ne fouille pas. Les fichiers de verrouillage portent des empreintes
 * d'intégrité qui ressemblent à tout, et les tests posent délibérément des
 * valeurs de la bonne forme pour éprouver le code qui les refuse.
 */
const IGNORES = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)test\//,
  /\.test\.ts$/,
  /^docs\/audit-securite\.md$/,
  /^scripts\/cherche-secrets\.js$/,
];

/**
 * Ce qui ressemble à un secret sans en être un : un espace réservé dans la
 * documentation, une valeur engendrée à la volée par la commande d'exemple. Les
 * laisser déclencher ferait de ce script un bruit qu'on finit par désactiver, ce
 * qui est pire que de ne pas l'avoir.
 */
const RESERVE = /\$\(|\$\{|<[a-z-]+>|votre|changez|remplacez|exemple|example|aleatoire|aléatoire|xxx|\.\.\./i;

/** Un fichier binaire n'a rien à dire ici, et le lire en texte n'a pas de sens. */
const BINAIRE = /\.(png|jpe?g|gif|webp|heic|ico|woff2?|ttf|otf|pdf|zip|db|sqlite3?)$/i;

const fichiers = execSync('git ls-files', { encoding: 'utf-8' })
  .split('\n').filter(Boolean)
  .filter((f) => !IGNORES.some((re) => re.test(f)) && !BINAIRE.test(f));

const trouves = [];
for (const f of fichiers) {
  let contenu;
  try { contenu = fs.readFileSync(f, 'utf-8'); } catch { continue; }
  if (contenu.includes('\0')) continue;
  contenu.split('\n').forEach((ligne, i) => {
    if (RESERVE.test(ligne)) return;
    for (const m of MOTIFS) {
      if (m.re.test(ligne)) trouves.push({ f, ligne: i + 1, quoi: m.nom });
    }
  });
}

if (trouves.length) {
  console.error('[foyer] ERREUR : des secrets semblent versionnés.\n');
  for (const t of trouves) console.error(`  ${t.f}:${t.ligne} — ${t.quoi}`);
  console.error(
    '\n        Un secret arrivé dans un dépôt Git doit être considéré comme compromis,'
    + '\n        même retiré ensuite : l’historique le garde. Faites-le tourner, puis retirez-le.'
    + '\n        La procédure de rotation du secret JWT est dans docs/exploitation-securite.md.',
  );
  process.exit(1);
}
console.log(`[foyer] ${fichiers.length} fichier(s) inspecté(s), aucun secret repéré.`);
