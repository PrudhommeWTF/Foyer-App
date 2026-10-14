// Les fiches des lieux et de leurs affaires, sans Angular : les opérations
// qu'elles envoient. Comme les courses, lieux et affaires s'écrivent par
// opérations ciblées, jamais par le document entier.
import type { PlaceOpDraft } from './api.service';
import { Place, PlaceItem } from './models';

export interface PlaceFields { name: string; note: string; color: string; icon: string; }
export interface PlaceItemFields { name: string; qty: string; placeId: string; }

export function placeFields(p: Place | null): PlaceFields {
  return p ? { name: p.name, note: p.note || '', color: p.color, icon: p.icon || 'voyage' } : { name: '', note: '', color: '#4E93B8', icon: 'voyage' };
}
export function placeItemFields(it: PlaceItem): PlaceItemFields { return { name: it.name, qty: it.qty || '', placeId: it.placeId }; }

/** Un lieu neuf, ou les seuls champs changés d'un lieu existant. Rien de changé : aucune opération. */
export function placeOps(id: string, before: Place | null, f: PlaceFields): PlaceOpDraft[] {
  const name = f.name.trim(), note = f.note.trim();
  if (!before) return [{ op: 'place-add', id, name, color: f.color, icon: f.icon, ...(note ? { note } : {}) }];
  const edit: Record<string, unknown> = {};
  if (name !== before.name) edit['name'] = name;
  if (note !== (before.note || '')) edit['note'] = note;
  if (f.color !== before.color) edit['color'] = f.color;
  if (f.icon !== (before.icon || 'voyage')) edit['icon'] = f.icon;
  return Object.keys(edit).length ? [{ op: 'place-edit', id, ...edit } as PlaceOpDraft] : [];
}

/** Les seuls champs changés d'une affaire. L'état ne passe pas par là : il a ses deux gestes. */
export function placeItemOps(before: PlaceItem, f: PlaceItemFields): PlaceOpDraft[] {
  const edit: Record<string, unknown> = {};
  const name = f.name.trim(), qty = f.qty.trim();
  if (name !== before.name) edit['name'] = name;
  if (qty !== (before.qty || '')) edit['qty'] = qty;
  if (f.placeId !== before.placeId) edit['placeId'] = f.placeId;
  return Object.keys(edit).length ? [{ op: 'edit', id: before.id, ...edit } as PlaceOpDraft] : [];
}

/** Remettre une affaire supprimée : même identifiant, même lieu, même état. */
export function placeItemRestoreOps(it: PlaceItem): PlaceOpDraft[] {
  return [{ op: 'add', id: it.id, placeId: it.placeId, name: it.name, ...(it.qty ? { qty: it.qty } : {}), state: it.state }];
}
