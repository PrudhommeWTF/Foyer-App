// Le rayon, tel qu'il se déclare à la fiche d'élément. Sa suppression se
// confirme : ses articles passent au rayon de repli, qui lui ne se supprime pas.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { Aisle } from '../../core/models';
import { AisleView } from './aisle-view';
import { AisleForm } from './aisle-form';

export const AISLE_ITEM: ItemKind<Aisle, FoyerStore> = {
  meta: ITEM_KINDS.aisle,
  load: (s, id) => s.data()?.aisles.find((a) => a.id === id) ?? null,
  title: (a) => a.name,
  view: AisleView,
  form: AisleForm,
  canRemove: (a, s) => a.id !== s.defaultAisleId(),
  remove: (s, a, _ctx, scope) => s.delAisle(a.id, scope),
  openIn: (s) => s.go('courses'),
  fingerprint: (a) => JSON.stringify(a),
};
