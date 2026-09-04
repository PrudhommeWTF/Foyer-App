// Le dernier document connu du foyer, gardé pour un démarrage hors ligne.
//
// Le service worker garde la coquille de l'application ; sans le document, elle
// s'ouvrirait sur un foyer vide, ce qui serait pire que de ne pas s'ouvrir : on
// croirait avoir tout perdu. Les deux vont donc ensemble.
//
// Ce qui est gardé est le document tel que le serveur l'a rendu, avec **sa
// version** et **la date de lecture**. La version parce que la reprise en ligne
// passe par le rejeu des modifications sur la version du serveur (voir
// state-sync.ts) : repartir de zéro ferait un conflit à chaque fois. La date
// parce que l'écran doit pouvoir dire de quand date ce qu'il montre, au lieu de
// laisser croire que c'est frais.
//
// La mise en forme et la relecture sont **pures** : les cas tordus (contenu
// abîmé, document énorme, demi-écrit) sont vérifiés plutôt que constatés en
// production. L'accès au magasin, lui, est asynchrone et vit en bas de ce
// fichier.
//
// Le magasin est **IndexedDB**, et non le stockage local. Non pas parce qu'il
// résisterait mieux aux purges (sur iOS, l'effacement des données de site après
// sept jours sans visite frappe les deux de la même façon, et c'est l'ajout à
// l'écran d'accueil qui en exempte), mais pour trois raisons concrètes :
//
//   - il **libère tout le budget du stockage local** pour les files de courses
//     et de tâches, qui elles ne sont pas remplaçables : ce qui n'est pas
//     encore parti n'existe nulle part ailleurs ;
//   - son quota se compte en centaines de mégaoctets, contre environ cinq pour
//     le stockage local, partagés avec le reste ;
//   - il n'écrit pas sur le fil principal, donc enregistrer un gros document ne
//     fige pas l'interface.

/** L'ancienne clé, dans le stockage local. Gardée pour reprendre ce qui y traîne. */
export const DOC_CACHE_KEY = 'foyer.doc';

/**
 * Au-delà, on ne garde rien.
 *
 * La borne ne protège plus le quota du stockage local (le document n'y est
 * plus) mais le coût d'écriture : le document est réenregistré à chaque
 * sauvegarde, et au-delà de cet ordre de grandeur c'est le document lui-même
 * qui a un problème, pas le cache. Les pièces jointes n'y sont pas : elles ont
 * quitté le document à la migration 5.
 */
export const MAX_DOC_BYTES = 10_000_000;

export interface CachedDoc<T> {
  state: T;
  /** La version du serveur au moment de la lecture. */
  version: number;
  /** Quand ce document a été lu, en ISO. */
  at: string;
}

/** La taille d'une chaîne en octets, l'accentuation comptée pour ce qu'elle pèse vraiment. */
export function byteSize(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Met le document en forme pour le stockage. Rend null quand il est trop gros :
 * mieux vaut pas de démarrage hors ligne qu'une file de coches évincée.
 */
export function packDoc<T>(state: T, version: number, at: string): string | null {
  let raw: string;
  try { raw = JSON.stringify({ state, version, at }); } catch { return null; }
  return byteSize(raw) > MAX_DOC_BYTES ? null : raw;
}

/**
 * Relit ce qui a été gardé. Rend null sur tout ce qui n'a pas la forme
 * attendue : un contenu abîmé, une version d'une autre époque, un demi-écrit
 * interrompu par une fermeture d'onglet. Dans le doute, on repart du réseau.
 */
export function readDoc<T>(raw: string | null): CachedDoc<T> | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!o['state'] || typeof o['state'] !== 'object') return null;
  if (typeof o['version'] !== 'number' || !Number.isFinite(o['version'])) return null;
  if (typeof o['at'] !== 'string' || !o['at']) return null;
  return { state: o['state'] as T, version: o['version'], at: o['at'] };
}

/**
 * « le 04/09/2026 à 14:12 » : de quand date ce qui est à l'écran. Vide si la
 * date est illisible, auquel cas mieux vaut ne rien dire que dire n'importe quoi.
 */
export function staleLabel(at: string, fmt: (iso: string) => string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `le ${fmt(at.slice(0, 10))} à ${hh}:${mm}`;
}


// ---- le magasin : IndexedDB ---------------------------------------------------
//
// Tout est enveloppé : un navigateur en navigation privée, un quota plein, une
// base bloquée par un autre onglet ne doivent jamais faire tomber l'application.
// L'échec veut dire « pas de démarrage hors ligne », pas « erreur ».

const DB_NAME = 'foyer';
const STORE = 'doc';
const DOC_KEY = 'household';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponible'));
    // Une autre version de l'application, dans un autre onglet, tient la base.
    req.onblocked = () => reject(new Error('IndexedDB occupée par un autre onglet'));
  });
}

/** Une opération sur le magasin, la base refermée dans tous les cas. */
async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null;
  let db: IDBDatabase;
  try { db = await openDb(); } catch { return null; }
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve((req.result ?? null) as T | null);
      req.onerror = () => reject(req.error ?? new Error('écriture refusée'));
      t.onabort = () => reject(t.error ?? new Error('transaction interrompue'));
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Garde le document. Silencieux en cas de refus : le démarrage hors ligne n'aura
 * rien, rien d'autre ne change.
 *
 * Retire au passage ce qu'une version précédente avait laissé dans le stockage
 * local. C'est ici et pas seulement à la relecture, parce qu'un foyer qui
 * démarre **en ligne** ne relit jamais le cache : sans cela, l'ancienne copie
 * resterait pour toujours à occuper le budget dont les files ont besoin, ce qui
 * est précisément ce que ce déplacement cherche à éviter.
 */
export async function saveCachedDoc(raw: string): Promise<void> {
  await withStore('readwrite', (s) => s.put(raw, DOC_KEY));
  try { localStorage.removeItem(DOC_CACHE_KEY); } catch { /* ignore */ }
}

/**
 * Relit le document gardé.
 *
 * Reprend au passage ce qu'une version précédente avait laissé dans le stockage
 * local, puis l'en retire : sans cela, le premier démarrage hors ligne après la
 * mise à jour n'aurait rien, et l'ancienne copie resterait à occuper le budget
 * dont les files ont besoin.
 */
export async function loadCachedDoc(): Promise<string | null> {
  const dansIdb = await withStore<string>('readonly', (s) => s.get(DOC_KEY));
  if (typeof dansIdb === 'string') return dansIdb;
  let ancien: string | null = null;
  try { ancien = localStorage.getItem(DOC_CACHE_KEY); } catch { return null; }
  if (!ancien) return null;
  await saveCachedDoc(ancien);
  return ancien;
}

/** Efface le document gardé, des deux magasins : la déconnexion ne laisse rien derrière. */
export async function clearCachedDoc(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(DOC_KEY));
  try { localStorage.removeItem(DOC_CACHE_KEY); } catch { /* ignore */ }
}

/**
 * Demande au navigateur de ne pas évincer ces données sous la pression du
 * disque. Accordé selon ses propres règles (une application installée y a
 * droit chez la plupart), refusé ailleurs sans conséquence : ce n'est pas une
 * garantie, c'est une demande qui ne coûte rien à faire.
 */
export async function askPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
