// La liste de courses, telle qu'elle se déclare à la fiche d'élément. Sa
// suppression se confirme : elle emporte ses articles, sans retour.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { ShopList } from '../../core/models';
import { ShopListView } from './shop-list-view';
import { ShopListForm } from './shop-list-form';

export const SHOP_LIST_ITEM: ItemKind<ShopList, FoyerStore> = {
  meta: ITEM_KINDS.shopList,
  load: (s, id) => s.data()?.shopLists.find((l) => l.id === id) ?? null,
  title: (l) => l.name,
  view: ShopListView,
  form: ShopListForm,
  remove: (s, l, _ctx, scope) => s.delShopList(l.id, scope),
  // La tâche qui ouvre la liste se crée d'ici ; une fois là, elle se lit dans la fiche.
  actions: (s, l) => (s.shoppingTask(l.id) ? [] : [{ label: 'En tâche', icon: 'checklist', run: () => s.addShoppingTask(l.id) }]),
  openIn: (s, l) => { s.go('courses'); s.patch({ activeShopList: l.id }); },
  fingerprint: (l) => JSON.stringify(l),
};
