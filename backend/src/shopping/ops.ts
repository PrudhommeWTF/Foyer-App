// Mutations granulaires de la liste de courses.
//
// Le reste du foyer s'enregistre par un PUT du document complet, ce qui revient
// à « le dernier arrivé gagne ». Sur la liste de courses, c'est un défaut
// fonctionnel visible : deux personnes cochent en même temps, l'un au magasin et
// l'autre à la maison, et les coches de l'un disparaissent quand l'autre
// enregistre un état vieux de deux heures.
//
// D'où ce jeu d'opérations, appliqué article par article. Deux propriétés le
// rendent sûr, et elles portent tout le reste :
//
//   1. **Une intention, pas une bascule.** L'opération dit « cet article est
//      dans le panier », jamais « inverse son état ». Une bascule rejouée après
//      une coupure réseau décocherait ; une intention rejouée ne fait rien.
//   2. **Un identifiant par opération.** L'appelant le génère, le serveur
//      retient ceux qu'il a déjà vus. Sans cela, un « ajouter » rejoué
//      ressusciterait un article supprimé entre-temps.
//
// Ce fichier ne touche ni au disque ni au réseau : c'est ce qui permet de le
// tester sur les cas tordus (rejeu, ordre inversé, liste supprimée sous les pieds).

export type ShopState = 'a-prendre' | 'panier' | 'indisponible';
export const SHOP_STATES: ShopState[] = ['a-prendre', 'panier', 'indisponible'];

export interface ShopItem {
  id: string;
  name: string;
  qty: string;
  aisleId: string;
  state: ShopState;
  listId: string;
  /** Membre qui a posé l'état courant, et quand. Sert à l'afficher, pas à arbitrer. */
  by?: string | null;
  at?: string | null;
}

interface Base { opId: string; by?: string | null; at?: string | null; }
export type ShopOp =
  | (Base & { op: 'add'; id: string; name: string; qty?: string; aisleId: string; listId: string })
  | (Base & { op: 'set-state'; id: string; state: ShopState })
  | (Base & { op: 'edit'; id: string; name?: string; qty?: string; aisleId?: string; listId?: string })
  | (Base & { op: 'remove'; id: string });

export interface OpsContext {
  /** Rayons existants. Un article ne peut pas atterrir dans un rayon inconnu. */
  aisleIds: Set<string>;
  /** Listes existantes. */
  listIds: Set<string>;
  /** Vrai quand cette opération a déjà été appliquée (rejeu après coupure réseau). */
  alreadyApplied: (opId: string) => boolean;
}

export interface SkippedOp { opId: string; reason: string }
export interface ApplyResult {
  items: ShopItem[];
  /** Identifiants retenus : l'appelant les inscrit au journal et le client les retire de sa file. */
  applied: string[];
  /**
   * Opérations écartées, avec la raison. Elles sont définitivement écartées, pas
   * différées : un client qui les garderait en file les rejouerait sans fin.
   */
  skipped: SkippedOp[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const trimmed = (v: unknown, max = 200): string => str(v).trim().slice(0, max);

/**
 * Applique un lot d'opérations. Chaque opération est indépendante : l'une est
 * écartée sans faire tomber les autres, parce qu'un lot vient d'une file
 * d'attente hors ligne et qu'un article périmé ne doit pas bloquer les neuf
 * autres coches faites dans le magasin.
 */
export function applyOps(items: ShopItem[], ops: unknown, ctx: OpsContext): ApplyResult {
  const out: ShopItem[] = items.map((i) => ({ ...i }));
  const applied: string[] = [];
  const skipped: SkippedOp[] = [];
  const seen = new Set<string>();

  if (!Array.isArray(ops)) return { items: out, applied, skipped: [{ opId: '', reason: 'Lot d’opérations illisible.' }] };

  for (const raw of ops) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const opId = trimmed(o['opId'], 80);
    if (!opId) { skipped.push({ opId: '', reason: 'Opération sans identifiant.' }); continue; }
    // Doublon dans le lot lui-même : déjà traité, et déjà acquitté une fois.
    // L'acquitter deux fois gonflerait le compte qui décide s'il faut réécrire.
    if (seen.has(opId)) continue;
    seen.add(opId);
    // Déjà appliquée lors d'un envoi précédent : acquittée sans être rejouée.
    if (ctx.alreadyApplied(opId)) { applied.push(opId); continue; }

    const id = trimmed(o['id'], 80);
    if (!id) { skipped.push({ opId, reason: 'Opération sans article visé.' }); continue; }
    const at = trimmed(o['at'], 40) || new Date().toISOString();
    const by = trimmed(o['by'], 80) || null;
    const idx = out.findIndex((i) => i.id === id);

    switch (o['op']) {
      case 'add': {
        // Rejeu d'un ajout déjà passé sous un autre identifiant d'opération :
        // l'article existe, il n'y a rien à faire et ce n'est pas une erreur.
        if (idx >= 0) { applied.push(opId); break; }
        const name = trimmed(o['name']);
        if (!name) { skipped.push({ opId, reason: 'Article sans nom.' }); break; }
        const listId = trimmed(o['listId'], 80);
        if (!ctx.listIds.has(listId)) { skipped.push({ opId, reason: 'La liste visée n’existe plus.' }); break; }
        const aisleId = trimmed(o['aisleId'], 80);
        if (!ctx.aisleIds.has(aisleId)) { skipped.push({ opId, reason: 'Le rayon visé n’existe plus.' }); break; }
        out.push({ id, name, qty: trimmed(o['qty'], 40), aisleId, state: 'a-prendre', listId, by, at });
        applied.push(opId);
        break;
      }
      case 'set-state': {
        // Un article disparu n'est pas une erreur du client : quelqu'un l'a
        // supprimé pendant qu'il était hors ligne. L'opération est sans objet.
        if (idx < 0) { applied.push(opId); break; }
        const state = str(o['state']) as ShopState;
        if (!SHOP_STATES.includes(state)) { skipped.push({ opId, reason: 'État d’article inconnu.' }); break; }
        out[idx] = { ...out[idx], state, by, at };
        applied.push(opId);
        break;
      }
      case 'edit': {
        if (idx < 0) { applied.push(opId); break; }
        const next = { ...out[idx] };
        if (o['name'] !== undefined) {
          const name = trimmed(o['name']);
          if (!name) { skipped.push({ opId, reason: 'Article sans nom.' }); break; }
          next.name = name;
        }
        if (o['qty'] !== undefined) next.qty = trimmed(o['qty'], 40);
        if (o['aisleId'] !== undefined) {
          const aisleId = trimmed(o['aisleId'], 80);
          if (!ctx.aisleIds.has(aisleId)) { skipped.push({ opId, reason: 'Le rayon visé n’existe plus.' }); break; }
          next.aisleId = aisleId;
        }
        if (o['listId'] !== undefined) {
          const listId = trimmed(o['listId'], 80);
          if (!ctx.listIds.has(listId)) { skipped.push({ opId, reason: 'La liste visée n’existe plus.' }); break; }
          next.listId = listId;
        }
        out[idx] = next;
        applied.push(opId);
        break;
      }
      case 'remove': {
        if (idx >= 0) out.splice(idx, 1);
        applied.push(opId);
        break;
      }
      default:
        skipped.push({ opId, reason: 'Opération inconnue : ' + str(o['op']) });
    }
  }

  return { items: out, applied, skipped };
}

/**
 * Remet les articles d'un rayon ou d'une liste disparus là où on saura les
 * retrouver. Les rayons et les listes s'éditent, eux, par l'enregistrement du
 * document complet : la liste n'y voyage plus, il faut donc rattraper ici ce que
 * cette édition impliquait pour ses articles.
 */
export function reconcile(
  items: ShopItem[],
  aisleIds: Set<string>,
  listIds: Set<string>,
  fallbackAisleId: string,
): { items: ShopItem[]; movedToFallback: number; dropped: number } {
  // Une liste supprimée emporte ses articles : c'est ce que l'écran annonce.
  const kept = items.filter((i) => listIds.has(i.listId));
  const dropped = items.length - kept.length;
  let movedToFallback = 0;
  const out = kept.map((i) => {
    if (aisleIds.has(i.aisleId)) return i;
    movedToFallback++;
    return { ...i, aisleId: fallbackAisleId };
  });
  return { items: out, movedToFallback, dropped };
}
