// Les files d'opérations hors ligne (courses, tâches, lieux), rangées par membre.
//
// Une file vit dans le stockage local du navigateur, et c'est tout son intérêt :
// les coches faites sans réseau survivent à un onglet recyclé. Mais un appareil
// change de mains. Un parent ouvre la session d'un enfant, quelqu'un d'autre se
// connecte sur la tablette : une file restée d'avant partirait sous l'identité
// d'après, et le serveur l'écrirait avec les droits de la mauvaise personne.
//
// Chaque file est donc rangée **sous le membre qui l'a remplie**
// (`foyer.taskQueue.<membre>`). Celle d'un autre dort sous son nom et ne repart
// que quand ce membre redevient la session de l'appareil. Le serveur ferme la
// porte de son côté : un lot porte `as` (son propriétaire), et un lot d'un autre
// membre que la session est refusé en bloc (voir backend/src/ops-router.ts).
//
// Module pur : le stockage est passé en argument, pour que les tests n'aient pas
// besoin d'un navigateur.

/** Le strict nécessaire de `localStorage`. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Le membre sous la session duquel cet appareil remplit ses files, retenu pour un démarrage hors ligne. */
export const QUEUE_OWNER_KEY = 'foyer.queueOwner';

/** La clé d'une file : celle du membre, ou l'ancienne clé sans membre tant qu'on ne sait pas qui c'est. */
export const queueKey = (base: string, owner: string | null): string => (owner ? `${base}.${owner}` : base);

export function readQueue<T>(store: KeyStore | null, base: string, owner: string | null): T[] {
  try { const v = JSON.parse(store?.getItem(queueKey(base, owner)) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Écrit une file ; vide, la clé disparaît plutôt que de traîner un « [] » par membre. */
export function writeQueue<T>(store: KeyStore | null, base: string, owner: string | null, q: T[]): void {
  try {
    if (q.length) store?.setItem(queueKey(base, owner), JSON.stringify(q));
    else store?.removeItem(queueKey(base, owner));
  } catch { /* quota ou mode privé : la file reste en mémoire */ }
}

export function readOwner(store: KeyStore | null): string | null {
  try { return store?.getItem(QUEUE_OWNER_KEY) || null; } catch { return null; }
}

export function writeOwner(store: KeyStore | null, owner: string): void {
  try { store?.setItem(QUEUE_OWNER_KEY, owner); } catch { /* mode privé : vaut pour la session */ }
}

/**
 * La file de `owner`, après reprise de l'ancienne file sans membre (celle des
 * versions d'avant ce rangement). Elle a été remplie par la session de l'époque,
 * qui est presque toujours celle qui se présente au premier démarrage : elle
 * rejoint la file de ce membre, sans doublon, et l'ancienne clé disparaît.
 */
export function adoptQueue<T extends { opId: string }>(store: KeyStore | null, base: string, owner: string): T[] {
  const mine = readQueue<T>(store, base, owner);
  const legacy = readQueue<T>(store, base, null);
  if (!legacy.length) return mine;
  const seen = new Set(mine.map((o) => o.opId));
  const merged = [...legacy.filter((o) => !seen.has(o.opId)), ...mine];
  writeQueue(store, base, owner, merged);
  try { store?.removeItem(base); } catch { /* ignore */ }
  return merged;
}
