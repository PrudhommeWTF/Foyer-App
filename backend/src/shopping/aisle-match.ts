// Résolution tolérante d'un rayon désigné par un texte libre (voix, assistant).
//
// Les outils MCP reçoivent un rayon sous forme de nom, pas d'identifiant : on ne
// dicte jamais « a-frais » ni l'emoji « 🥛 Frais ». La comparaison stricte sur le
// libellé renvoyé par l'outil `rayons` ratait donc « Frais », « frais » ou
// « Fruits & legumes », l'article tombait au repli, et la réponse disait quand
// même « ajouté ». Ce module normalise des deux côtés (sans emoji, sans accent,
// sans casse, séparateurs « & » / « et » et espaces tolérés) et refuse de deviner
// quand plusieurs rayons correspondent.
import type { Aisle } from '../models';

/**
 * Normalise un texte de rayon pour une comparaison tolérante : sans emoji, sans
 * accent, sans casse, les séparateurs (« & », « et », ponctuation, espaces
 * multiples) ramenés à une simple espace. « 🥛 Frais » et « FRAIS » donnent
 * « frais » ; « Fruits & légumes », « fruits et legumes » et « Fruits  Légumes »
 * donnent tous « fruits legumes ».
 */
export function normRayonText(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && w !== 'et')
    .join(' ')
    .trim();
}

export type AisleMatch =
  | { kind: 'one'; aisle: Aisle }
  | { kind: 'ambiguous'; aisles: Aisle[] }
  | { kind: 'none' };

/**
 * Résout un rayon désigné par texte libre. Compare après `normRayonText` sur le
 * libellé du rayon et, s'il en porte un, sur son type (`kind`, par ex. `frais`).
 * Un rayon est reconnu si un seul correspond ; en cas d'égalité on rend les
 * candidats sans en choisir aucun.
 */
export function matchAisle(aisles: Aisle[], text: string): AisleMatch {
  const nt = normRayonText(text);
  if (!nt) return { kind: 'none' };
  const hits = (aisles || []).filter((a) =>
    normRayonText(a.name) === nt || (a.kind ? normRayonText(a.kind) === nt : false));
  if (hits.length === 1) return { kind: 'one', aisle: hits[0] };
  if (hits.length > 1) return { kind: 'ambiguous', aisles: hits };
  return { kind: 'none' };
}

/** Distance de Levenshtein entre deux chaînes (pour classer les rayons proches). */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/**
 * Les `n` rayons dont le libellé est le plus proche du texte (distance de
 * Levenshtein sur la forme normalisée), le repli exclu via `exclude`. Sert à
 * aiguiller l'assistant quand le rayon demandé n'est pas reconnu.
 */
export function nearestAisleNames(aisles: Aisle[], text: string, n: number, exclude: (a: Aisle) => boolean = () => false): string[] {
  const nt = normRayonText(text);
  return (aisles || [])
    .filter((a) => !exclude(a))
    .map((a) => ({ name: a.name, d: lev(nt, normRayonText(a.name)), pos: a.position ?? 999 }))
    .sort((x, y) => x.d - y.d || x.pos - y.pos)
    .slice(0, Math.max(0, n))
    .map((x) => x.name);
}

/**
 * La phrase ajoutée à la réponse d'un outil quand le rayon demandé n'a pas pu
 * être appliqué. L'article est rangé au repli (`fallbackName`), jamais dans le
 * rayon demandé : la réponse le dit noir sur blanc. `articles` nomme les articles
 * concernés (ajout groupé) ; absent, on parle de « l'article ».
 */
export function rayonFailureNote(
  rayonText: string,
  reason: 'inconnu' | 'ambigu',
  fallbackName: string,
  suggestions: string[],
  articles?: string[],
): string {
  const tete = reason === 'inconnu'
    ? `Rayon « ${rayonText} » inconnu`
    : `Rayon « ${rayonText} » ambigu (plusieurs rayons correspondent)`;
  const cible = articles && articles.length
    ? `${articles.join(', ')} placé${articles.length > 1 ? 's' : ''} dans « ${fallbackName} »`
    : `article placé dans « ${fallbackName} »`;
  const liste = suggestions.length ? ` Rayons possibles : ${suggestions.join(', ')}.` : '';
  return `${tete}, ${cible}.${liste}`;
}
