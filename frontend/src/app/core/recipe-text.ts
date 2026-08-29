/**
 * Lire une recette **collée en texte**, pour remplir le formulaire.
 *
 * Ce lecteur remplace l'import depuis une photo, qui demandait de la
 * reconnaissance de caractères : lourde à embarquer en local pour un usage
 * rare, et interdite à distance par la règle « aucune donnée sortante ». iOS et
 * Android savent déjà extraire le texte d'une image ; le collage couvre le même
 * besoin en deux gestes, sans rien installer ni rien envoyer.
 *
 * Le lecteur ne remplace jamais le jugement : il remplit le formulaire, que
 * l'utilisateur relit avant d'enregistrer, et il **dit ce qu'il n'a pas su
 * faire** plutôt que d'inventer. Une recette collée de travers doit se voir tout
 * de suite, pas se découvrir devant les fourneaux.
 */
import { ArticleIndex, parseIngredient } from './ingredients';

export interface ReadRecipe {
  name: string;
  portions: number | null;
  prepMin: number | null;
  cookMin: number | null;
  ingr: string[];
  steps: string[];
  /** Ce que le lecteur n'a pas su faire, à afficher tel quel. */
  warnings: string[];
}

const TITRES_ING = /^(?:ingr[ée]dients?|pour la (?:p[âa]te|garniture|sauce|cr[èe]me)|liste des courses)\s*:?\s*$/i;
const TITRES_ETAPES = /^(?:pr[ée]paration|[ée]tapes?|instructions?|r[ée]alisation|recette|marche [àa] suivre)\s*:?\s*$/i;
const PORTIONS = /pour\s+(\d{1,2})\s*(?:personnes?|parts?|convives?)/i;
const PREP = /(?:temps de )?pr[ée]paration\s*:?\s*([^\n,;.]+)/i;
const CUISSON = /(?:temps de )?cuisson\s*:?\s*([^\n,;.]+)/i;
/** Puces et numéros de liste, que les sites et les carnets manuscrits emploient. */
const PUCE = /^\s*(?:[-–—*•·]|\d{1,2}\s*[).:/]|[ée]tape\s+\d+\s*:?)\s*/i;
/** Une ligne qui commence par une quantité n'est jamais un titre. */
const QUANTIFIE = /^\s*(?:[-–—*•·]\s*)?(?:\d|½|¼|¾|une?\s|deux\s|trois\s|quelques\s|un peu\s)/i;

/**
 * Durée écrite à la française vers minutes. Même lecture que la migration du
 * document d'état, redite ici parce que le frontend ne partage pas ce code.
 */
export function readDuration(value: string): number | null {
  const s = String(value ?? '').toLowerCase().replace(',', '.').trim();
  if (!s) return null;
  const hm = /^(\d+(?:\.\d+)?)\s*(?:h|heures?)\s*(\d{1,2})?\s*(?:min|mn|minutes?)?$/.exec(s);
  if (hm) return Math.round(parseFloat(hm[1]) * 60 + (hm[2] ? parseInt(hm[2], 10) : 0));
  const m = /^(\d+(?:\.\d+)?)\s*(?:min|mn|minutes?)?$/.exec(s);
  if (m) { const n = Math.round(parseFloat(m[1])); return n > 0 ? n : null; }
  return null;
}

/**
 * Une ligne ressemble-t-elle à un ingrédient ? Le lecteur d'ingrédients tranche
 * quand il reconnaît un article ; sinon on se rabat sur la forme, une ligne
 * courte commençant par une quantité. Une phrase longue est une étape.
 */
function looksIngredient(line: string, index: ArticleIndex): boolean {
  if (line.length > 90) return false;
  if (/^\d+[.)]/.test(line)) return false;  // « 1. Faire bouillir » : une étape numérotée
  const parsed = parseIngredient(line, index);
  if (parsed.some((p) => p.status === 'article')) return true;
  return line.length <= 60 && /^\s*(?:\d|une?\s|deux\s|trois\s|quelques\s|un peu\s)/i.test(line);
}

export function readRecipeText(raw: string, index: ArticleIndex): ReadRecipe {
  const out: ReadRecipe = { name: '', portions: null, prepMin: null, cookMin: null, ingr: [], steps: [], warnings: [] };
  const entier = String(raw ?? '').replace(/\r\n?/g, '\n');
  const lignes = entier.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lignes.length) { out.warnings.push('Le texte collé est vide.'); return out; }

  const p = PORTIONS.exec(entier);
  if (p) out.portions = parseInt(p[1], 10);
  const pr = PREP.exec(entier);
  if (pr) out.prepMin = readDuration(pr[1]);
  const cu = CUISSON.exec(entier);
  if (cu) out.cookMin = readDuration(cu[1]);

  // Deux lectures possibles. Avec des intertitres, on leur fait confiance :
  // l'auteur a dit lui-même où commencent les ingrédients. Sans eux, il faut
  // deviner ligne à ligne, ce qui se trompe davantage et se dit.
  const iIng = lignes.findIndex((l) => TITRES_ING.test(l));
  const iEtapes = lignes.findIndex((l) => TITRES_ETAPES.test(l));

  let corps = lignes;
  if (iIng >= 0 || iEtapes >= 0) {
    const debut = Math.min(...[iIng, iEtapes].filter((i) => i >= 0));
    out.name = titre(lignes.slice(0, debut));
    for (const [i, l] of lignes.entries()) {
      if (i < debut || TITRES_ING.test(l) || TITRES_ETAPES.test(l)) continue;
      const dansEtapes = iEtapes >= 0 && i > iEtapes && (iIng < 0 || iEtapes > iIng);
      (dansEtapes ? out.steps : out.ingr).push(nettoie(l));
    }
  } else {
    out.warnings.push('Aucun intertitre « Ingrédients » ou « Préparation » : le partage entre les deux a été deviné, relisez-le.');
    out.name = titre(lignes.slice(0, 1));
    corps = lignes.slice(out.name ? 1 : 0);
    for (const l of corps) {
      if (estEntete(l)) continue;
      (looksIngredient(l, index) ? out.ingr : out.steps).push(nettoie(l));
    }
  }

  out.ingr = out.ingr.filter(Boolean);
  out.steps = out.steps.filter(Boolean);
  if (!out.name) out.warnings.push('Aucun titre trouvé : donnez-en un avant d’enregistrer.');
  if (!out.ingr.length) out.warnings.push('Aucun ingrédient reconnu.');
  if (!out.steps.length) out.warnings.push('Aucune étape reconnue.');
  return out;
}

/** Enlève puces et numéros, qui ne font pas partie du texte de la ligne. */
const nettoie = (l: string): string => l.replace(PUCE, '').trim();

/** Les lignes de métadonnées ne sont ni un ingrédient ni une étape. */
const estEntete = (l: string): boolean =>
  PORTIONS.test(l) || /^(?:temps de )?(?:pr[ée]paration|cuisson|repos|difficult[ée]|co[ûu]t)\s*:/i.test(l);

/**
 * Premier candidat crédible. Le critère est plus large que pour le corps : un
 * nom de produit seul en tête de collage (« Pâtes », « Crêpes ») est bien plus
 * souvent le titre de la recette qu'un ingrédient, alors qu'une ligne
 * quantifiée n'est jamais un titre.
 */
function titre(lignes: string[]): string {
  for (const l of lignes) {
    if (estEntete(l) || TITRES_ING.test(l) || TITRES_ETAPES.test(l)) continue;
    if (QUANTIFIE.test(l)) continue;
    return nettoie(l).slice(0, 120);
  }
  return '';
}
