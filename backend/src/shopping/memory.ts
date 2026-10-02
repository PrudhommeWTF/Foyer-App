// Mémoire d'achats : ce que le foyer a déjà mis dans sa liste, pour le proposer
// à la saisie et, plus tard, nourrir les « habituels ».
//
// C'est un troisième étage, distinct du référentiel (base intégrée + articles
// du foyer, voir frontend articles.ts) : il ne dit pas ce qu'EST un article, il
// dit ce que le foyer ACHÈTE. Un seul enregistrement par article, indexé par sa
// clé de référentiel quand elle est connue, sinon par son nom normalisé.
//
// Trois règles portent tout le reste :
//
//   1. **Alimentée côté serveur uniquement**, dans applyOps (shopping/ops.ts), au
//      passage en coché et à la suppression d'un coché. Le client ne l'écrit
//      jamais : un rejeu local ne peut donc pas la fausser.
//   2. **Jamais décrémentée.** Décocher n'est pas « ne pas avoir acheté ». Le
//      compte ne monte qu'au passage en coché, une fois par opération appliquée.
//   3. **Élaguée, pas tenue à vie.** Les entrées de plus de douze mois partent,
//      et la table est bornée : c'est une mémoire utile, pas un historique.
import type { ShopItem } from './ops';

/** Un article déjà acheté, tel qu'on s'en souvient pour le reproposer. */
export interface ShopMemoryEntry {
  /** Dernier libellé vu, pour l'affichage. */
  name: string;
  /** Clé du référentiel quand l'article y est connu, sinon absente. */
  art?: string | null;
  /** Dernier rayon, repris à la remise. */
  aisleId?: string | null;
  /** Dernière quantité, reprise à la remise. */
  qty?: string | null;
  /** Nombre de passages en coché. Jamais décrémenté. */
  count: number;
  /** Date ISO du dernier passage en coché. */
  lastAt: string;
  /** Favori (épinglé en tête des habituels), posé plus tard. */
  fav?: boolean;
}

export type ShopMemory = Record<string, ShopMemoryEntry>;

/** Au-delà, une entrée n'est plus une habitude : douze mois sans le moindre achat. */
const MEMORY_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
/** Taille bornée : au-delà, les moins récentes partent. Une famille n'a pas mille habitudes. */
const MEMORY_MAX_ENTRIES = 500;

/**
 * Normalise un nom d'article pour le regroupement : minuscules, sans accent ni
 * ponctuation, espaces resserrés. Doit coïncider avec le `norm` du frontend
 * (articles.ts) pour que « Lait », « LAIT » et « lait » tombent sur la même clé.
 */
export function normaliseName(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La clé de mémoire d'un article : sa clé de référentiel quand il en a une
 * (deux libellés d'un même produit connu se rejoignent), sinon son nom
 * normalisé. Rend une chaîne vide quand il n'y a rien d'exploitable, et
 * l'appelant n'écrit alors rien.
 */
export function memoryKey(item: Pick<ShopItem, 'art' | 'name'>): string {
  const art = typeof item.art === 'string' ? item.art.trim() : '';
  return art || normaliseName(item.name);
}

/** Copie une entrée en bornant le libellé, pour qu'un nom géant ne gonfle pas le document. */
const clampName = (name: string): string => (name || '').slice(0, 200);

/**
 * Enregistre un passage en coché : incrémente le compte et rafraîchit le dernier
 * libellé, rayon, quantité et la date. Crée l'entrée au besoin. Rend une
 * nouvelle mémoire (l'entrée touchée est remplacée, les autres intactes).
 */
export function rememberPicked(memory: ShopMemory, item: ShopItem, at: string): ShopMemory {
  const key = memoryKey(item);
  if (!key) return memory;
  const prev = memory[key];
  const next: ShopMemoryEntry = {
    name: clampName(item.name),
    count: (prev?.count ?? 0) + 1,
    lastAt: at,
    ...(typeof item.art === 'string' && item.art ? { art: item.art } : prev?.art ? { art: prev.art } : {}),
    ...(item.aisleId ? { aisleId: item.aisleId } : prev?.aisleId ? { aisleId: prev.aisleId } : {}),
    ...(item.qty ? { qty: item.qty } : prev?.qty ? { qty: prev.qty } : {}),
    ...(prev?.fav ? { fav: true } : {}),
  };
  return { ...memory, [key]: next };
}

/**
 * Enregistre la suppression d'un article coché : le nom, le rayon et la quantité
 * sont conservés pour que « Supprimer les cochés » ne fasse jamais perdre la
 * mémoire. Le compte n'est pas touché (il a monté au passage en coché) ; si
 * l'entrée manque encore (article coché avant l'existence de la mémoire), on la
 * crée avec un compte de un, pour ne pas perdre le nom.
 */
export function rememberRemoved(memory: ShopMemory, item: ShopItem, at: string): ShopMemory {
  const key = memoryKey(item);
  if (!key) return memory;
  const prev = memory[key];
  const next: ShopMemoryEntry = {
    name: clampName(item.name),
    count: prev?.count ?? 1,
    lastAt: prev?.lastAt || item.at || at,
    ...(typeof item.art === 'string' && item.art ? { art: item.art } : prev?.art ? { art: prev.art } : {}),
    ...(item.aisleId ? { aisleId: item.aisleId } : prev?.aisleId ? { aisleId: prev.aisleId } : {}),
    ...(item.qty ? { qty: item.qty } : prev?.qty ? { qty: prev.qty } : {}),
    ...(prev?.fav ? { fav: true } : {}),
  };
  return { ...memory, [key]: next };
}

/**
 * Élague la mémoire : retire les entrées de plus de douze mois, puis borne la
 * table aux plus récentes. Appliqué côté serveur après chaque lot, avec l'heure
 * réelle : c'est volontairement hors de applyOps, qui reste déterministe.
 */
export function pruneMemory(memory: ShopMemory, now: number): ShopMemory {
  const entries = Object.entries(memory);
  const cutoff = now - MEMORY_MAX_AGE_MS;
  const fresh = entries.filter(([, e]) => {
    const t = Date.parse(e.lastAt);
    // Une date illisible ne doit pas faire disparaître l'entrée en silence : on la garde.
    return Number.isNaN(t) || t >= cutoff;
  });
  const kept = fresh.length <= MEMORY_MAX_ENTRIES
    ? fresh
    : fresh.sort((a, b) => (b[1].lastAt < a[1].lastAt ? -1 : b[1].lastAt > a[1].lastAt ? 1 : 0)).slice(0, MEMORY_MAX_ENTRIES);
  if (kept.length === entries.length) return memory; // rien à retirer : ne pas réécrire pour rien
  return Object.fromEntries(kept);
}
