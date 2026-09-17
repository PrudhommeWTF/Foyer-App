// L'ordre manuel des tâches, en indexation fractionnaire.
//
// Chaque tâche porte une clé textuelle `ord` (base 62, bibliothèque
// `fractional-indexing`). Insérer entre deux tâches, c'est fabriquer une clé
// située entre leurs deux clés : une seule tâche est touchée, jamais ses
// voisines. C'est ce qui rend le rangement sûr quand deux appareils réorganisent
// en même temps, là où une colonne d'entiers aurait forcé à tout réécrire.
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

/** La clé réelle d'une tâche, ou null (sans clé, ou sentinelle) : ce que la bibliothèque attend. */
const realKey = (t: TaskItem | undefined): string | null => {
  const k = t?.ord;
  return typeof k === 'string' && k && k !== TAIL ? k : null;
};

/** Une clé de fin de liste : après la dernière tâche classée. */
export function endKey(all: TaskItem[], listId: string): string {
  const ordered = orderedOf(all, listId).filter((t) => realKey(t) !== null);
  return generateKeyBetween(ordered.length ? realKey(ordered[ordered.length - 1]) : null, null);
}

/** Une clé de tête de liste : avant la première tâche classée. */
export function startKey(all: TaskItem[], listId: string): string {
  const ordered = orderedOf(all, listId).filter((t) => realKey(t) !== null);
  return generateKeyBetween(null, ordered.length ? realKey(ordered[0]) : null);
}

/** La cible d'un déplacement, exprimée en relatif : jamais un index absolu, jamais une clé. */
export interface MoveTarget { avant?: string | null; apres?: string | null; position?: 'debut' | 'fin' | null; }

/** Le résultat d'un calcul de déplacement : une clé, un refus motivé, ou une opération neutre. */
export type MoveResult = { key: string } | { reason: string } | { noop: true };

/**
 * Calcule la clé d'ordre d'un déplacement relatif, en relisant les voisins
 * réels de la liste. Le client ne fournit jamais de clé : c'est cette relecture
 * au moment du traitement qui rend l'opération sûre à deux appareils.
 */
export function keyForMove(all: TaskItem[], movedId: string, target: MoveTarget): MoveResult {
  const moved = all.find((t) => t.id === movedId);
  if (!moved) return { reason: 'Tâche à déplacer introuvable.' };
  if (moved.done) return { reason: 'Une tâche terminée ne se range pas.' };

  const ordered = orderedOf(all, moved.listId);
  const others = ordered.filter((t) => t.id !== movedId);
  const currentIdx = ordered.findIndex((t) => t.id === movedId);

  let to: number;
  if (target.position === 'debut') to = 0;
  else if (target.position === 'fin') to = others.length;
  else {
    const refId = (target.avant ?? target.apres) || '';
    if (!refId) return { reason: 'Précisez « avant », « après », ou une position (« début » ou « fin »).' };
    const ref = all.find((t) => t.id === refId);
    if (!ref) return { reason: 'Tâche de référence introuvable.' };
    if (ref.id === movedId) return { noop: true };
    if (ref.listId !== moved.listId) return { reason: 'La tâche de référence est dans une autre liste.' };
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
