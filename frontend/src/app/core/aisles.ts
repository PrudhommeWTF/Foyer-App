// Ordre des rayons du magasin. Le glisser-déposer de la modale « Ordre des
// rayons » n'envoie que l'ordre des rayons déplaçables ; cette fonction pure en
// déduit l'ordre complet, pour que le store le transforme en positions.

/**
 * Déduit l'ordre complet des rayons après un glisser-déposer.
 *
 * - Le **repli** (« À trier ») est épinglé **en tête** et ne se déplace jamais :
 *   c'est sa place logique (première allée), il reçoit les articles sans rayon.
 * - Les autres rayons suivent l'ordre `dragged`. Les identifiants inconnus ou en
 *   double y sont ignorés ; un rayon déplaçable absent de `dragged` est conservé,
 *   à la fin, dans son ordre courant.
 *
 * Le résultat couvre exactement les rayons de `current` : son index donne la
 * position, donc des positions **contiguës** 0..n-1 une fois appliqué.
 */
export function reorderAisleIds(current: readonly string[], fallbackId: string, dragged: readonly string[]): string[] {
  const others = current.filter((id) => id !== fallbackId);
  const movable = new Set(others);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of dragged) if (movable.has(id) && !seen.has(id)) { seen.add(id); ordered.push(id); }
  for (const id of others) if (!seen.has(id)) ordered.push(id);
  return current.includes(fallbackId) ? [fallbackId, ...ordered] : ordered;
}
