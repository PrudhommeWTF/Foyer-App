// Sortir les données du foyer, et les y faire revenir.
//
// Trois formats, trois usages qui n'ont rien à voir :
//
//   - **Le carnet en JSON**, pour sauvegarder hors de l'application et passer
//     d'une instance à l'autre. Il doit pouvoir revenir : un export qu'on ne sait
//     pas relire n'est pas une sauvegarde, c'est un souvenir.
//   - **Une recette en texte**, pour l'envoyer par message à quelqu'un qui n'a
//     pas Foyer. Lisible tel quel, sans balise ni ponctuation de machine.
//   - **La liste de courses en tableur**, pour qui fait les courses sans compte.
//
// Tout ici est pur : ces fonctions ne téléchargent rien et ne touchent à rien.
// C'est ce qui permet de les éprouver sur les cas qui font mal, les guillemets
// dans un nom d'article et les fichiers d'import trafiqués.

import { Aisle, Recipe, ShopItem } from './models';

// ---- carnet de recettes ----------------------------------------------------

/** Photo transportée avec sa recette, en base64 : un export sans photo n'est pas une sauvegarde. */
export interface ExportedPhoto { name: string; type: string; data: string; }

export interface ExportedRecipe {
  id: string; name: string; level: string; color: string;
  portions?: number | null; prepMin?: number | null; cookMin?: number | null;
  source?: string | null;
  ingr: string[]; steps: string[];
  photo?: ExportedPhoto;
}

/**
 * Enveloppe du fichier d'export. `format` et `version` existent pour qu'un
 * fichier étranger soit refusé avec une phrase claire plutôt qu'importé de
 * travers, et pour qu'une version future sache reconnaître celle-ci.
 */
export interface RecipeBundle {
  format: 'foyer.recettes';
  version: 1;
  exportedAt: string;
  recipes: ExportedRecipe[];
}

// Typées littéralement : sans cela, `format` vaut `string` et n'apporte plus
// aucune garantie à la construction du fichier, ce que seul le typage des tests
// a fini par montrer.
export const BUNDLE_FORMAT = 'foyer.recettes' as const;
export const BUNDLE_VERSION = 1 as const;

export function buildBundle(recipes: Recipe[], photos: Record<number, ExportedPhoto | undefined>, now = new Date()): RecipeBundle {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: now.toISOString(),
    recipes: recipes.map((r) => {
      const photo = r.photoId ? photos[r.photoId] : undefined;
      return {
        id: r.id, name: r.name, level: r.level, color: r.color,
        ...(r.portions ? { portions: r.portions } : {}),
        ...(r.prepMin ? { prepMin: r.prepMin } : {}),
        ...(r.cookMin ? { cookMin: r.cookMin } : {}),
        ...(r.source ? { source: r.source } : {}),
        ingr: [...r.ingr], steps: [...r.steps],
        ...(photo ? { photo } : {}),
      };
    }),
  };
}

export interface ImportReport {
  /** Recettes qui seront créées. */
  nouvelles: ExportedRecipe[];
  /** Recettes déjà présentes, reconnues à leur identifiant : réimporter est sans effet. */
  deja: string[];
  /** Entrées inutilisables, avec la raison. Le reste du fichier est importé quand même. */
  ignorees: { nom: string; raison: string }[];
  /** Nombre de photos transportées par les recettes à créer. */
  photos: number;
}

/** Erreur d'import destinée à l'écran : elle dit quoi faire, pas ce qui a planté. */
export class ImportError extends Error {}

const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const lignes = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => texte(x)).filter(Boolean) : [];
const nombre = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Lit un fichier d'export. Lève une ImportError dont le message s'affiche tel
 * quel : à ce stade, l'utilisateur a choisi un fichier dans son téléphone et n'a
 * aucun moyen de savoir ce qu'il contient.
 */
export function parseBundle(raw: string): RecipeBundle {
  let data: unknown;
  try { data = JSON.parse(raw); }
  catch { throw new ImportError('Ce fichier n’est pas lisible : ce n’est pas du JSON. Choisissez le fichier produit par « Exporter le carnet ».'); }

  const o = data as Partial<RecipeBundle>;
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new ImportError('Ce fichier ne contient pas un carnet de recettes.');
  if (o.format !== BUNDLE_FORMAT) {
    throw new ImportError('Ce fichier n’est pas un export de recettes Foyer. L’export complet du foyer (Paramètres) ne s’importe pas ici.');
  }
  if (typeof o.version !== 'number' || o.version > BUNDLE_VERSION) {
    throw new ImportError('Ce fichier vient d’une version plus récente de Foyer. Mettez à jour avant de l’importer.');
  }
  if (!Array.isArray(o.recipes)) throw new ImportError('Ce fichier ne contient aucune recette.');
  return o as RecipeBundle;
}

/**
 * Compare le fichier au carnet et dit ce qui serait fait, sans rien écrire.
 *
 * Une recette déjà présente est reconnue à son identifiant et laissée
 * tranquille : réimporter deux fois la même sauvegarde ne doit pas dupliquer le
 * carnet, sinon la sauvegarde devient un piège.
 */
export function planImport(bundle: RecipeBundle, existants: Recipe[]): ImportReport {
  const ids = new Set(existants.map((r) => r.id));
  const rep: ImportReport = { nouvelles: [], deja: [], ignorees: [], photos: 0 };
  const vus = new Set<string>();

  for (const brut of bundle.recipes) {
    const e = (brut || {}) as Partial<ExportedRecipe>;
    const nom = texte(e.name);
    if (!nom) { rep.ignorees.push({ nom: '(sans nom)', raison: 'aucun nom' }); continue; }
    const id = texte(e.id);
    if (!id) { rep.ignorees.push({ nom, raison: 'aucun identifiant' }); continue; }
    if (vus.has(id)) { rep.ignorees.push({ nom, raison: 'identifiant en double dans le fichier' }); continue; }
    vus.add(id);
    if (ids.has(id)) { rep.deja.push(nom); continue; }

    const ingr = lignes(e.ingr);
    const steps = lignes(e.steps);
    if (!ingr.length && !steps.length) { rep.ignorees.push({ nom, raison: 'ni ingrédient ni étape' }); continue; }

    const photo = e.photo && texte(e.photo.data) ? { name: texte(e.photo.name) || 'photo', type: texte(e.photo.type) || 'image/jpeg', data: e.photo.data } : undefined;
    if (photo) rep.photos++;

    rep.nouvelles.push({
      id, name: nom,
      level: texte(e.level) || 'Facile',
      color: /^#[0-9a-f]{6}$/i.test(texte(e.color)) ? texte(e.color) : '#7A9B76',
      ...(nombre(e.portions) ? { portions: nombre(e.portions) } : {}),
      ...(nombre(e.prepMin) ? { prepMin: nombre(e.prepMin) } : {}),
      ...(nombre(e.cookMin) ? { cookMin: nombre(e.cookMin) } : {}),
      ...(texte(e.source) ? { source: texte(e.source) } : {}),
      ingr, steps,
      ...(photo ? { photo } : {}),
    });
  }
  return rep;
}

// ---- une recette en texte --------------------------------------------------

/**
 * Une recette telle qu'on la collerait dans un message. Pas de balise, pas de
 * tiret décoratif : ce texte est lu par quelqu'un, pas par un programme.
 */
export function recipeToText(r: Recipe): string {
  const out: string[] = [r.name.trim()];

  const entete = [
    r.portions ? r.portions + (r.portions > 1 ? ' personnes' : ' personne') : '',
    r.prepMin ? 'préparation ' + r.prepMin + ' min' : '',
    r.cookMin ? 'cuisson ' + r.cookMin + ' min' : '',
  ].filter(Boolean);
  if (entete.length) out.push(entete.join(' · '));

  if (r.ingr.length) {
    out.push('', 'Ingrédients', ...r.ingr.map((i) => '- ' + i.trim()));
  }
  if (r.steps.length) {
    out.push('', 'Préparation', ...r.steps.map((s, i) => (i + 1) + '. ' + s.trim()));
  }
  if (r.source) out.push('', 'Source : ' + r.source);
  return out.join('\n');
}

// ---- liste de courses en tableur -------------------------------------------

const ETATS: Record<string, string> = {
  'a-prendre': 'À prendre',
  panier: 'Pris',
  indisponible: 'Introuvable',
};

/**
 * Une valeur de cellule CSV. Le point-virgule sépare les colonnes, parce que
 * c'est ce qu'attend un tableur configuré en français ; la virgule y séparerait
 * les décimales et casserait chaque ligne.
 */
export function csvCell(v: string): string {
  const s = String(v ?? '');
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * La liste, dans l'ordre des allées du magasin : c'est l'ordre dans lequel on la
 * lit sur place, et le seul qui serve une fois le fichier ouvert.
 */
export function shopToCsv(items: ShopItem[], aisles: Aisle[]): string {
  const rang = new Map(aisles.map((a, i) => [a.id, i]));
  const nom = new Map(aisles.map((a) => [a.id, a.name]));
  const tries = [...items].sort((a, b) =>
    (rang.get(a.aisleId) ?? 999) - (rang.get(b.aisleId) ?? 999) || a.name.localeCompare(b.name, 'fr'));

  const lignes = [['Rayon', 'Article', 'Quantité', 'État'].join(';')];
  for (const i of tries) {
    lignes.push([
      csvCell(nom.get(i.aisleId) || 'À trier'),
      csvCell(i.name),
      csvCell(i.qty || ''),
      csvCell(ETATS[i.state] || i.state),
    ].join(';'));
  }
  // Fin de ligne CRLF : c'est ce que la RFC 4180 demande, et ce qu'attendent les
  // tableurs qui liraient tout sur une seule ligne sans elle.
  return lignes.join('\r\n');
}

/** Nom de fichier sans surprise : pas d'accent, pas d'espace, une date qui trie. */
export function fileName(base: string, ext: string, now = new Date()): string {
  const jour = now.toISOString().slice(0, 10);
  const propre = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'foyer';
  return `${propre}-${jour}.${ext}`;
}
