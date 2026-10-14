// Le lieu de vacances, tel qu'il se déclare à la fiche d'élément. Sa
// suppression se confirme : il emporte son inventaire, sans retour.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { Place } from '../../core/models';
import { PlaceView } from './place-view';
import { PlaceForm } from './place-form';

export const PLACE_ITEM: ItemKind<Place, FoyerStore> = {
  meta: ITEM_KINDS.place,
  load: (s, id) => s.data()?.places.find((p) => p.id === id) ?? null,
  title: (p) => p.name,
  view: PlaceView,
  form: PlaceForm,
  remove: (s, p, _ctx, scope) => s.delPlace(p.id, scope),
  openIn: (s) => s.go('lieux'),
  fingerprint: (p) => JSON.stringify(p),
  changedBy: (p) => ({ by: p.by ?? null, at: p.at ?? null }),
};
