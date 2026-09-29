// L'ordre manuel des tâches, en indexation fractionnaire.
//
// Chaque tâche porte une clé textuelle `ord` (base 62, bibliothèque
// `fractional-indexing`). Insérer entre deux tâches, c'est fabriquer une clé
// située entre leurs deux clés : une seule tâche est touchée, jamais ses
// voisines. C'est ce qui rend le rangement sûr quand deux appareils réorganisent
// en même temps, là où une colonne d'entiers aurait forcé à tout réécrire.
//
// **Les clés sont globales, pas propres à une liste.** Un même espace de clés
// couvre toutes les tâches du foyer : on peut donc ranger à la main dans une
// vue qui mélange plusieurs listes (« Toutes les tâches », « À moi »), pas
// seulement dans une liste isolée. La migration 13 a réuni les anciennes clés
// par liste en une seule suite croissante, en gardant l'ordre affiché ; toute
// clé neuve se calcule depuis les voisins globaux, jamais depuis la seule liste.
//
// Deux règles tenues ici :
//
//   - **Tri déterministe** sur le couple (clé, identifiant), jamais sur la clé
//     seule : deux appareils hors ligne peuvent fabriquer la même clé pour la
//     même place, et l'affichage ne doit pas osciller.
//   - **Une tâche sans clé passe en fin de liste**, plutôt que de faire tomber
//     le tri. Le caractère « ~ » sert de sentinelle : il trie après toute clé
//     réelle (base 62, donc au plus « z »).
import { generateKeyBetween } from 'fractional-indexing';
import type { TaskItem } from './ops';

/** La sentinelle de fin : après toute clé base 62 réelle. */
const TAIL = '~';
const key = (t: TaskItem): string => (typeof t.ord === 'string' && t.ord ? t.ord : TAIL);

/**
 * Tri (clé d'ordre, identifiant). Comparaison par point de code, jamais
 * `localeCompare` : les clés de `fractional-indexing` (base 62) et la sentinelle
 * « ~ » ne sont cohérentes qu'en ordre d'octets, pas en collation locale (où la
 * ponctuation et la casse se rangent autrement). L'identifiant départage à clé
 * égale, pour que l'affichage ne vacille pas d'un appareil à l'autre.
 */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const byOrd = (a: TaskItem, b: TaskItem): number => cmp(key(a), key(b)) || cmp(a.id, b.id);

/** Les tâches d'une liste dans l'ordre courant. */
export const orderedOf = (all: TaskItem[], listId: string): TaskItem[] =>
  all.filter((t) => t.listId === listId).sort(byOrd);

/** Toutes les tâches dans l'ordre global : l'ordre qu'affichent les vues agrégées. */
const ordered = (all: TaskItem[]): TaskItem[] => all.slice().sort(byOrd);

/** La clé réelle d'une tâche, ou null (sans clé, ou sentinelle) : ce que la bibliothèque attend. */
const realKey = (t: TaskItem | undefined): string | null => {
  const k = t?.ord;
  return typeof k === 'string' && k && k !== TAIL ? k : null;
};

/** Une clé de fin : après la dernière tâche classée, toutes listes confondues. */
export function endKey(all: TaskItem[]): string {
  const keyed = ordered(all).filter((t) => realKey(t) !== null);
  return generateKeyBetween(keyed.length ? realKey(keyed[keyed.length - 1]) : null, null);
}

/** Une clé de tête : avant la première tâche classée, toutes listes confondues. */
export function startKey(all: TaskItem[]): string {
  const keyed = ordered(all).filter((t) => realKey(t) !== null);
  return generateKeyBetween(null, keyed.length ? realKey(keyed[0]) : null);
}

/** La cible d'un déplacement, exprimée en relatif : jamais un index absolu, jamais une clé. */
export interface MoveTarget { avant?: string | null; apres?: string | null; position?: 'debut' | 'fin' | null; }

/** Le résultat d'un calcul de déplacement : une clé, un refus motivé, ou une opération neutre. */
export type MoveResult = { key: string } | { reason: string } | { noop: true };

/**
 * Calcule la clé d'ordre d'un déplacement relatif, en relisant les voisins
 * réels. Le client ne fournit jamais de clé : c'est cette relecture au moment
 * du traitement qui rend l'opération sûre à deux appareils. Les voisins sont
 * globaux (toutes listes), pour qu'un rangement dans une vue agrégée place la
 * tâche là où on l'a lâchée, même juste à côté d'une tâche d'une autre liste.
 */
export function keyForMove(all: TaskItem[], movedId: string, target: MoveTarget): MoveResult {
  const moved = all.find((t) => t.id === movedId);
  if (!moved) return { reason: 'Tâche à déplacer introuvable.' };
  if (moved.done) return { reason: 'Une tâche terminée ne se range pas.' };

  const all_ = ordered(all);
  const others = all_.filter((t) => t.id !== movedId);
  const currentIdx = all_.findIndex((t) => t.id === movedId);

  let to: number;
  if (target.position === 'debut') to = 0;
  else if (target.position === 'fin') to = others.length;
  else {
    const refId = (target.avant ?? target.apres) || '';
    if (!refId) return { reason: 'Précisez « avant », « après », ou une position (« début » ou « fin »).' };
    const ref = all.find((t) => t.id === refId);
    if (!ref) return { reason: 'Tâche de référence introuvable.' };
    if (ref.id === movedId) return { noop: true };
    const refIdx = others.findIndex((t) => t.id === refId);
    to = target.avant != null && target.avant !== '' ? refIdx : refIdx + 1;
  }

  // Déjà à cette place : neutre, pas une erreur. Dans `others`, le créneau
  // qu'occupe la tâche déplacée est exactement son index courant (la retirer
  // décale la suite d'un cran).
  if (to === currentIdx) return { noop: true };

  try {
    return { key: generateKeyBetween(realKey(others[to - 1]), realKey(others[to])) };
  } catch {
    return { reason: 'Impossible de calculer la position (voisins incohérents).' };
  }
}
