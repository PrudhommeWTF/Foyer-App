// Mutations granulaires des lieux et de leurs affaires (inventaires de vacances).
//
// Un lieu est un endroit où le foyer laisse des affaires d'une fois sur l'autre
// (la maison de la montagne, le mobil-home au bord de mer). Contrairement à une
// liste de préparation, un inventaire ne se remet jamais à zéro : il dit ce qui
// reste là-bas. Deux gestes suffisent, « J'ai laissé » et « J'ai ramené », et
// tout le monde les voit.
//
// Comme les courses et les tâches, ce sous-arbre s'écrit par opérations et non
// par un PUT du document complet : deux téléphones qui notent en même temps se
// sérialisent au lieu de s'écraser. Les deux propriétés qui rendent le procédé
// sûr sont les mêmes qu'ailleurs : une **intention** (« cette affaire est
// là-bas »), jamais une bascule, et un **identifiant par opération**, retenu par
// le serveur pour qu'un rejeu après coupure réseau ne refasse rien.
//
// La différence avec les courses : ici, un seul flux d'opérations porte à la
// fois les lieux (place-add/edit/remove) et leurs affaires (add/set-state/edit/
// remove), pour que la totalité de la fonctionnalité reste hors du chemin du PUT.
//
// Ce fichier ne touche ni au disque ni au réseau : c'est ce qui permet de le
// tester sur les cas tordus (rejeu, ordre inversé, lieu supprimé sous les pieds).

/** Une affaire est soit restée sur place, soit ramenée à la maison. */
export type PlaceItemState = 'la-bas' | 'ici';
export const PLACE_ITEM_STATES: PlaceItemState[] = ['la-bas', 'ici'];

export interface Place {
  id: string;
  name: string;
  color: string;
  icon: string;
  position: number;
  /** Note libre (adresse, code de la boîte à clés, etc.). */
  note?: string | null;
  /** Membre qui a créé le lieu, et quand. Sert à l'afficher, pas à arbitrer. */
  by?: string | null;
  at?: string | null;
}

export interface PlaceItem {
  id: string;
  placeId: string;
  name: string;
  qty: string;
  state: PlaceItemState;
  /** Membre qui a posé l'état courant, et quand. */
  by?: string | null;
  at?: string | null;
}

interface Base { opId: string; by?: string | null; at?: string | null; }
export type PlaceOp =
  | (Base & { op: 'place-add'; id: string; name: string; color?: string; icon?: string; note?: string })
  | (Base & { op: 'place-edit'; id: string; name?: string; color?: string; icon?: string; note?: string; position?: number })
  | (Base & { op: 'place-remove'; id: string })
  | (Base & { op: 'add'; id: string; placeId: string; name: string; qty?: string; state?: PlaceItemState })
  | (Base & { op: 'set-state'; id: string; state: PlaceItemState })
  | (Base & { op: 'edit'; id: string; name?: string; qty?: string; placeId?: string })
  | (Base & { op: 'remove'; id: string });

export interface OpsContext {
  /** Vrai quand cette opération a déjà été appliquée (rejeu après coupure réseau). */
  alreadyApplied: (opId: string) => boolean;
}

export interface SkippedOp { opId: string; reason: string }
export interface ApplyResult {
  places: Place[];
  items: PlaceItem[];
  /** Identifiants retenus : l'appelant les inscrit au journal et le client les retire de sa file. */
  applied: string[];
  /** Opérations écartées, avec la raison. Définitivement écartées, pas différées. */
  skipped: SkippedOp[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const trimmed = (v: unknown, max = 200): string => str(v).trim().slice(0, max);

/**
 * Applique un lot d'opérations aux lieux et à leurs affaires. Chaque opération
 * est indépendante : l'une est écartée sans faire tomber les autres, parce qu'un
 * lot vient d'une file hors ligne et qu'une affaire périmée ne doit pas bloquer
 * les autres gestes faits sur place.
 */
export function applyOps(places: Place[], items: PlaceItem[], ops: unknown, ctx: OpsContext): ApplyResult {
  const outP: Place[] = places.map((p) => ({ ...p }));
  const outI: PlaceItem[] = items.map((i) => ({ ...i }));
  const applied: string[] = [];
  const skipped: SkippedOp[] = [];
  const seen = new Set<string>();

  if (!Array.isArray(ops)) return { places: outP, items: outI, applied, skipped: [{ opId: '', reason: 'Lot d’opérations illisible.' }] };

  const hasPlace = (id: string): boolean => outP.some((p) => p.id === id);

  for (const raw of ops) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const opId = trimmed(o['opId'], 80);
    if (!opId) { skipped.push({ opId: '', reason: 'Opération sans identifiant.' }); continue; }
    if (seen.has(opId)) continue;
    seen.add(opId);
    if (ctx.alreadyApplied(opId)) { applied.push(opId); continue; }

    const id = trimmed(o['id'], 80);
    if (!id) { skipped.push({ opId, reason: 'Opération sans cible.' }); continue; }
    const at = trimmed(o['at'], 40) || new Date().toISOString();
    const by = trimmed(o['by'], 80) || null;

    switch (o['op']) {
      case 'place-add': {
        // Rejeu d'un ajout déjà passé : le lieu existe, rien à faire.
        if (hasPlace(id)) { applied.push(opId); break; }
        const name = trimmed(o['name']);
        if (!name) { skipped.push({ opId, reason: 'Lieu sans nom.' }); break; }
        outP.push({
          id, name, color: trimmed(o['color'], 40) || '#4E93B8', icon: trimmed(o['icon'], 40) || 'map-pin',
          position: outP.length, by, at,
          ...(trimmed(o['note']) ? { note: trimmed(o['note']) } : {}),
        });
        applied.push(opId);
        break;
      }
      case 'place-edit': {
        const idx = outP.findIndex((p) => p.id === id);
        // Un lieu disparu n'est pas une erreur du client : quelqu'un l'a supprimé.
        if (idx < 0) { applied.push(opId); break; }
        const next = { ...outP[idx] };
        if (o['name'] !== undefined) {
          const name = trimmed(o['name']);
          if (!name) { skipped.push({ opId, reason: 'Lieu sans nom.' }); break; }
          next.name = name;
        }
        if (o['color'] !== undefined) next.color = trimmed(o['color'], 40) || next.color;
        if (o['icon'] !== undefined) next.icon = trimmed(o['icon'], 40) || next.icon;
        if (o['note'] !== undefined) { const note = trimmed(o['note']); if (note) next.note = note; else delete next.note; }
        if (typeof o['position'] === 'number') next.position = o['position'];
        outP[idx] = next;
        applied.push(opId);
        break;
      }
      case 'place-remove': {
        const idx = outP.findIndex((p) => p.id === id);
        if (idx >= 0) {
          outP.splice(idx, 1);
          // Un lieu supprimé emporte ses affaires : c'est ce que l'écran annonce.
          for (let i = outI.length - 1; i >= 0; i--) if (outI[i].placeId === id) outI.splice(i, 1);
        }
        applied.push(opId);
        break;
      }
      case 'add': {
        const idx = outI.findIndex((i) => i.id === id);
        // Rejeu d'un ajout déjà passé sous un autre identifiant : l'affaire existe.
        if (idx >= 0) { applied.push(opId); break; }
        const name = trimmed(o['name']);
        if (!name) { skipped.push({ opId, reason: 'Affaire sans nom.' }); break; }
        const placeId = trimmed(o['placeId'], 80);
        if (!hasPlace(placeId)) { skipped.push({ opId, reason: 'Le lieu visé n’existe plus.' }); break; }
        const state = str(o['state']) as PlaceItemState;
        outI.push({
          id, placeId, name, qty: trimmed(o['qty'], 40),
          // Par défaut, une affaire qu'on ajoute est déjà là-bas : on note ce qui reste.
          state: PLACE_ITEM_STATES.includes(state) ? state : 'la-bas',
          by, at,
        });
        applied.push(opId);
        break;
      }
      case 'set-state': {
        const idx = outI.findIndex((i) => i.id === id);
        // Une affaire disparue n'est pas une erreur : quelqu'un l'a retirée.
        if (idx < 0) { applied.push(opId); break; }
        const state = str(o['state']) as PlaceItemState;
        if (!PLACE_ITEM_STATES.includes(state)) { skipped.push({ opId, reason: 'État d’affaire inconnu.' }); break; }
        outI[idx] = { ...outI[idx], state, by, at };
        applied.push(opId);
        break;
      }
      case 'edit': {
        const idx = outI.findIndex((i) => i.id === id);
        if (idx < 0) { applied.push(opId); break; }
        const next = { ...outI[idx] };
        if (o['name'] !== undefined) {
          const name = trimmed(o['name']);
          if (!name) { skipped.push({ opId, reason: 'Affaire sans nom.' }); break; }
          next.name = name;
        }
        if (o['qty'] !== undefined) next.qty = trimmed(o['qty'], 40);
        if (o['placeId'] !== undefined) {
          const placeId = trimmed(o['placeId'], 80);
          if (!hasPlace(placeId)) { skipped.push({ opId, reason: 'Le lieu visé n’existe plus.' }); break; }
          next.placeId = placeId;
        }
        outI[idx] = next;
        applied.push(opId);
        break;
      }
      case 'remove': {
        const idx = outI.findIndex((i) => i.id === id);
        if (idx >= 0) outI.splice(idx, 1);
        applied.push(opId);
        break;
      }
      default:
        skipped.push({ opId, reason: 'Opération inconnue : ' + str(o['op']) });
    }
  }

  return { places: outP, items: outI, applied, skipped };
}
