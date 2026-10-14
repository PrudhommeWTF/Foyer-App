// La fiche d'un article de courses, sans Angular : ce que le formulaire montre
// à l'ouverture, et les opérations qu'il envoie à l'enregistrement. Les
// courses s'écrivent par opérations ciblées (jamais par le document entier),
// pour que deux téléphones qui cochent en même temps ne s'écrasent pas.
import type { ShopOpDraft } from './api.service';
import { ShopItem, ShopState } from './models';

/** Les champs tels que saisis. */
export interface ShopFields { name: string; qty: string; state: ShopState; aisleId: string; listId: string; photoId: number | null; }

/** Ce qu'une création reçoit d'office : le rayon de repli et la liste ouverte. */
export interface ShopDefaults { aisleId: string; listId: string; }

export function shopFields(it: ShopItem | null, d: ShopDefaults): ShopFields {
  if (!it) return { name: '', qty: '', state: 'a-prendre', aisleId: d.aisleId, listId: d.listId, photoId: null };
  return { name: it.name, qty: it.qty || '', state: it.state, aisleId: it.aisleId, listId: it.listId || d.listId, photoId: it.photoId ?? null };
}

/**
 * Les opérations qui portent la saisie : un ajout (suivi de son état s'il
 * n'est pas « à prendre »), ou pour un article existant une édition des seuls
 * champs changés, et un changement d'état à part, qui dit qui l'a posé et
 * quand. Rien de changé : aucune opération. Le nom vide se refuse avant.
 */
export function shopOps(id: string, before: ShopItem | null, f: ShopFields): ShopOpDraft[] {
  const name = f.name.trim(), qty = f.qty.trim();
  if (!before) {
    const add: ShopOpDraft = { op: 'add', id, name, qty, aisleId: f.aisleId, listId: f.listId, ...(f.photoId ? { photoId: f.photoId } : {}) };
    return f.state === 'a-prendre' ? [add] : [add, { op: 'set-state', id, state: f.state }];
  }
  const edit: Record<string, unknown> = {};
  if (name !== before.name) edit['name'] = name;
  if (qty !== (before.qty || '')) edit['qty'] = qty;
  if (f.aisleId !== before.aisleId) edit['aisleId'] = f.aisleId;
  if (f.listId !== before.listId) edit['listId'] = f.listId;
  if (f.photoId !== (before.photoId ?? null)) edit['photoId'] = f.photoId;
  const ops: ShopOpDraft[] = Object.keys(edit).length ? [{ op: 'edit', id, ...edit } as ShopOpDraft] : [];
  if (f.state !== before.state) ops.push({ op: 'set-state', id, state: f.state });
  return ops;
}

/** Remettre un article supprimé : il revient sous le même identifiant, dans son état d'avant. */
export function shopRestoreOps(it: ShopItem): ShopOpDraft[] {
  return shopOps(it.id, null, shopFields(it, { aisleId: it.aisleId, listId: it.listId }));
}
