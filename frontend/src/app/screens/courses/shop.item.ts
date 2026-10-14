// L'article de courses, tel qu'il se déclare à la fiche d'élément. Sur la
// liste, la case se coche toujours d'un tap direct ; c'est le nom qui ouvre
// la fiche. Supprimer se défait : l'article revient tel qu'il était.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { ShopItem } from '../../core/models';
import { ShopView } from './shop-view';
import { ShopForm } from './shop-form';

export const SHOP_ITEM: ItemKind<ShopItem, FoyerStore> = {
  meta: ITEM_KINDS.shop,
  load: (s, id) => s.data()?.shop.find((x) => x.id === id) ?? null,
  title: (it) => it.name,
  view: ShopView,
  form: ShopForm,
  remove: (s, it) => s.delShop(it.id),
  // Cocher depuis la fiche, comme sur la ligne ; « introuvable » se dit en modifiant.
  actions: (s, it) => [it.state === 'a-prendre'
    ? { label: 'Cocher', icon: 'check', run: () => s.toggleShop(it.id) }
    : { label: 'Remettre à prendre', icon: 'refresh', run: () => s.setShopState(it.id, 'a-prendre') }],
  // Le module s'ouvre sur la liste de l'article, son rayon déplié.
  openIn: (s, it) => {
    s.go('courses');
    s.patch({ activeShopList: it.listId, collapsedAisles: s.ui().collapsedAisles.filter((x) => x !== it.aisleId) });
  },
  fingerprint: (it) => JSON.stringify(it),
  changedBy: (it) => ({ by: it.by ?? null, at: it.at ?? null }),
};
