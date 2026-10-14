// L'affaire d'un lieu, telle qu'elle se déclare à la fiche d'élément. Les deux
// gestes (« J'ai ramené », « J'ai laissé ») restent sur la ligne et se
// retrouvent dans la fiche ; c'est le nom qui l'ouvre. Supprimer se défait.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { PlaceItem } from '../../core/models';
import { PlaceItemView } from './place-item-view';
import { PlaceItemForm } from './place-item-form';

export const PLACE_ITEM_ITEM: ItemKind<PlaceItem, FoyerStore> = {
  meta: ITEM_KINDS.placeItem,
  load: (s, id) => s.data()?.placeItems.find((x) => x.id === id) ?? null,
  title: (it) => it.name,
  view: PlaceItemView,
  form: PlaceItemForm,
  remove: (s, it) => s.delPlaceItem(it.id),
  actions: (s, it) => [it.state === 'la-bas'
    ? { label: 'J’ai ramené', icon: 'home', run: () => s.setPlaceItemState(it.id, 'ici') }
    : { label: 'J’ai laissé', icon: 'map-pin', run: () => s.setPlaceItemState(it.id, 'la-bas') }],
  openIn: (s) => s.go('lieux'),
  fingerprint: (it) => JSON.stringify(it),
  changedBy: (it) => ({ by: it.by ?? null, at: it.at ?? null }),
};
