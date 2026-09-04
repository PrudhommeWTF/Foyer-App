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
// Ce module ne touche pas au stockage : il met en forme et relit, pour que les
// cas tordus (quota plein, contenu abîmé, document énorme) soient vérifiés
// plutôt que constatés en production.

/** La clé du dernier document, dans le stockage local du navigateur. */
export const DOC_CACHE_KEY = 'foyer.doc';

/**
 * Au-delà, on ne garde rien.
 *
 * Le stockage local tourne autour de 5 Mo par origine, partagés avec les files
 * d'attente des courses et des tâches, qui elles ne sont pas remplaçables : ce
 * qui n'est pas encore parti n'existe nulle part ailleurs. Un document énorme
 * qui remplirait le quota ferait donc perdre des coches pour un confort de
 * démarrage. Entre les deux, le choix est vite fait.
 */
export const MAX_DOC_BYTES = 2_000_000;

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
