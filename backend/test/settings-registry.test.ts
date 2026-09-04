// Le garde-fou du registre des paramètres.
//
// Il ne vérifie pas une fois, il vérifie à chaque passage de la CI. C'est ce
// qui empêche la page Paramètres de redevenir ce qu'elle était : des réglages
// affichés que personne ne lit, et des valeurs lues que personne n'affiche.
//
// Cinq règles, et une seule raison à chacune :
//
//   1. Un paramètre déclaré que personne ne lit est un **réglage mort** : on le
//      modifie, rien ne change, et on cesse de croire toute la page.
//   2. Une clé lue qui n'est pas déclarée est un **réglage fantôme** : il agit
//      sans que rien ne le signale.
//   3. Un accès direct à `settings` hors des fichiers autorisés contourne le
//      registre, donc les deux règles précédentes.
//   4. Les deux copies du registre doivent être identiques, sinon le serveur et
//      l'application ne parlent plus du même réglage.
//   5. `docs/parametres.md` doit correspondre au registre, sinon la seule
//      documentation qui existe devient fausse en silence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { REGISTRY, SECTIONS, SettingDecl, checkValue, householdDefaults, setting, validate } from '../src/settings/registry';
import { render } from '../scripts/settings-doc';

const ROOT = path.join(__dirname, '..', '..');
const BACK_REGISTRY = path.join(ROOT, 'backend', 'src', 'settings', 'registry.ts');
const FRONT_REGISTRY = path.join(ROOT, 'frontend', 'src', 'app', 'core', 'settings', 'registry.ts');

/**
 * Les fichiers qui ont le droit de toucher `settings` sans passer par le
 * registre : le registre lui-même, et les deux endroits qui **fabriquent** un
 * document neuf plutôt que d'en lire un.
 */
const DIRECT_ACCESS_ALLOWED = new Set([
  'backend/src/settings/registry.ts',
  'frontend/src/app/core/settings/registry.ts',
]);

/** Tous les fichiers TypeScript de production des deux arbres. Les tests sont hors sujet. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
      out.push(full);
    }
  };
  walk(path.join(ROOT, 'backend', 'src'));
  walk(path.join(ROOT, 'frontend', 'src'));
  return out;
}

const rel = (file: string): string => path.relative(ROOT, file).split(path.sep).join('/');

/**
 * Le code sans ses commentaires.
 *
 * Sans cela, un exemple écrit dans une explication (« se lit avec
 * `setting('cle', doc)` ») compterait pour un usage réel et ferait échouer le
 * garde-fou sur une clé qui n'existe pas.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? '' : line.includes('://') ? line : line.replace(/\/\/.*$/, '')))
    .join('\n');
}

interface Usage { key: string; where: string; }

/**
 * Les appels dont la clé est écrite en toutes lettres. Une clé calculée n'est
 * pas comptée : elle ne prouve rien sur la clé qu'elle porte.
 *
 * `reads` seul atteste qu'un réglage sert vraiment. Afficher son libellé
 * (`declOf`) ou l'écrire (`setSetting`) ne suffit pas : un réglage qu'on peut
 * changer sans que rien ne le lise est exactement le mensonge à empêcher.
 */
function scan(): { reads: Usage[]; writes: Usage[]; refs: Usage[]; direct: string[] } {
  const reads: Usage[] = [];
  const writes: Usage[] = [];
  const refs: Usage[] = [];
  const direct: string[] = [];
  for (const file of sourceFiles()) {
    const where = rel(file);
    const src = stripComments(fs.readFileSync(file, 'utf-8'));
    for (const m of src.matchAll(/\bsetting\(\s*'([\w.]+)'/g)) reads.push({ key: m[1], where });
    for (const m of src.matchAll(/\bsetSetting\(\s*'([\w.]+)'/g)) writes.push({ key: m[1], where });
    for (const m of src.matchAll(/\bdeclOf\(\s*'([\w.]+)'/g)) refs.push({ key: m[1], where });
    if (DIRECT_ACCESS_ALLOWED.has(where)) continue;
    if (/\.settings\s*[?!]?\s*(\.\w|\[)/.test(src)) direct.push(where);
  }
  return { reads, writes, refs, direct };
}

const usage = scan();
const declared = new Set<string>(REGISTRY.map((d) => d.key));

test('registre : les deux copies sont identiques', () => {
  const back = fs.readFileSync(BACK_REGISTRY, 'utf-8');
  const front = fs.readFileSync(FRONT_REGISTRY, 'utf-8');
  assert.equal(back, front,
    'backend/src/settings/registry.ts et frontend/src/app/core/settings/registry.ts doivent être identiques.\n' +
    'Recopiez le fichier modifié par-dessus l’autre.');
});

test('registre : chaque paramètre déclaré est lu quelque part (pas de réglage mort)', () => {
  const lus = new Set(usage.reads.map((u) => u.key));
  const morts = REGISTRY.filter((d) => !lus.has(d.key)).map((d) => d.key);
  assert.deepEqual(morts, [],
    'Réglage(s) déclaré(s) que personne ne lit : ' + morts.join(', ') + '.\n' +
    'Un réglage sans consommateur est un mensonge : câblez-le avec setting(\'clé\', doc), ou retirez-le du registre.');
});

test('registre : aucune clé lue ou écrite n’échappe au registre (pas de réglage fantôme)', () => {
  const inconnues = [...usage.reads, ...usage.writes, ...usage.refs]
    .filter((u) => !declared.has(u.key))
    .map((u) => `${u.key} (${u.where})`);
  assert.deepEqual(inconnues, [],
    'Clé(s) utilisée(s) sans être déclarée(s) : ' + inconnues.join(', ') + '.\n' +
    'Déclarez-les dans settings/registry.ts, avec leur libellé et leur description.');
});

test('registre : personne ne lit settings sans passer par le registre', () => {
  assert.deepEqual(usage.direct, [],
    'Accès direct à `settings` dans : ' + usage.direct.join(', ') + '.\n' +
    'Utilisez setting(\'clé\', doc) côté serveur, store.setting(\'clé\') côté application.');
});

test('registre : chaque déclaration est complète et cohérente', () => {
  const sections = new Set(SECTIONS.map((s) => s.id));
  const vues = new Set<string>();
  for (const d of REGISTRY) {
    assert.ok(!vues.has(d.key), `Clé en double dans le registre : ${d.key}`);
    vues.add(d.key);
    assert.ok(d.label.trim(), `${d.key} : libellé manquant`);
    assert.ok(d.desc.trim().length > 20, `${d.key} : description absente ou trop courte pour dire ce que le réglage change`);
    assert.notEqual(d.desc.trim(), d.label.trim(), `${d.key} : la description ne doit pas répéter le libellé`);
    assert.ok(d.module.trim(), `${d.key} : module propriétaire manquant`);
    assert.ok(sections.has(d.section), `${d.key} : section « ${d.section} » inconnue de SECTIONS`);
    assert.ok(!/—/.test(d.label + d.desc), `${d.key} : pas de tiret cadratin dans les textes de l’interface`);
    const check = validate(d.key, d.default);
    assert.ok(check.ok, `${d.key} : la valeur par défaut est refusée par son propre contrôle`);
    if (d.type === 'enum') assert.ok((d.options || []).length >= 2, `${d.key} : un réglage « liste » a besoin d’au moins deux valeurs`);
  }
});

test('registre : un document neuf porte exactement les réglages du foyer', () => {
  const attendu = REGISTRY.filter((d) => d.scope === 'foyer').map((d) => d.key).sort();
  assert.deepEqual(Object.keys(householdDefaults()).sort(), attendu);
});

// ---- lecture : ce qui protège d'un document ancien, tronqué ou bricolé ------

test('lecture : un document sans réglages rend les valeurs par défaut', () => {
  assert.equal(setting('academie', null), '');
  assert.equal(setting('dark', {}), false);
  assert.equal(setting('prefNotifs', { settings: {} }), true);
});

test('lecture : une valeur d’un type inattendu rend le défaut plutôt que de casser l’écran', () => {
  assert.equal(setting('dark', { settings: { dark: 'oui' } }), false);
  assert.equal(setting('academie', { settings: { academie: 'Marseille' } }), '', 'une académie qui n’existe pas ne fige pas le calendrier');
  assert.equal(setting('showBreakfast', { settings: { showBreakfast: null } }), false);
});

test('lecture : une valeur valide est rendue telle quelle', () => {
  assert.equal(setting('academie', { settings: { academie: 'Rennes' } }), 'Rennes');
  assert.equal(setting('icsTasks', { settings: { icsTasks: true } }), true);
  assert.equal(setting('prefNotifs', { settings: { prefNotifs: false } }), false);
});

// ---- contrôle de saisie : un test par type, sur les bornes ------------------

test('contrôle : type « oui / non »', () => {
  assert.ok(validate('dark', true).ok);
  assert.ok(validate('dark', false).ok);
  assert.equal(validate('dark', 'true').ok, false);
  assert.equal(validate('dark', 1).ok, false);
});

test('contrôle : type « liste »', () => {
  assert.ok(validate('academie', '').ok, 'la valeur vide est proposée, donc admise');
  assert.ok(validate('academie', 'Versailles').ok);
  assert.equal(validate('academie', 'Marseille').ok, false, 'une académie qui n’existe pas est refusée');
  assert.equal(validate('academie', 42).ok, false);
});

/**
 * Les types que le registre sait contrôler mais qu'aucun réglage n'utilise
 * encore. Le contrôle réel (`checkValue`) est éprouvé sur une déclaration
 * d'essai : c'est bien le code de production qui est testé, pas une copie.
 */
const essai = (over: Partial<SettingDecl> & { type: SettingDecl['type']; default: SettingDecl['default'] }): SettingDecl =>
  ({ key: 'essai', scope: 'foyer', section: 'affichage', module: 'Essai', label: 'Essai', desc: 'Déclaration d’essai, pour éprouver le contrôle de saisie.', ...over });

test('contrôle : type « entier », bornes incluses', () => {
  const d = essai({ type: 'int', default: 5, min: 1, max: 10 });
  assert.ok(checkValue(d, 1).ok, 'la borne basse est admise');
  assert.ok(checkValue(d, 10).ok, 'la borne haute est admise');
  assert.equal(checkValue(d, 0).ok, false);
  assert.equal(checkValue(d, 11).ok, false);
  assert.equal(checkValue(d, 5.5).ok, false, 'un entier n’est pas un décimal');
  assert.equal(checkValue(d, 'sept').ok, false);
  assert.equal(checkValue(d, '').ok, false, 'un champ vidé ne vaut pas zéro');
  const converti = checkValue(d, '7');
  assert.ok(converti.ok && converti.value === 7, 'un nombre saisi dans un champ texte est converti');
});

test('contrôle : type « heure »', () => {
  const d = essai({ type: 'time', default: '08:00' });
  assert.ok(checkValue(d, '00:00').ok);
  assert.ok(checkValue(d, '23:59').ok);
  assert.equal(checkValue(d, '24:00').ok, false);
  assert.equal(checkValue(d, '7:30').ok, false, 'HH:MM sur deux chiffres');
  assert.equal(checkValue(d, '08h30').ok, false);
});

test('contrôle : type « texte », longueur maximale', () => {
  const d = essai({ type: 'text', default: '', maxLength: 4 });
  assert.ok(checkValue(d, '').ok);
  assert.ok(checkValue(d, 'abcd').ok);
  assert.equal(checkValue(d, 'abcde').ok, false);
  assert.equal(checkValue(d, 12).ok, false);
});

test('contrôle : une clé inconnue est refusée, avec son nom dans le message', () => {
  const r = validate('nImporteQuoi', true);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.error.includes('nImporteQuoi'));
});

// ---- documentation ---------------------------------------------------------

test('docs/parametres.md est à jour avec le registre', () => {
  const file = path.join(ROOT, 'docs', 'parametres.md');
  assert.ok(fs.existsSync(file), 'docs/parametres.md manque. Lancez : cd backend && npm run docs:settings');
  assert.equal(fs.readFileSync(file, 'utf-8'), render(),
    'docs/parametres.md ne correspond plus au registre.\nRegénérez-le : cd backend && npm run docs:settings');
});
