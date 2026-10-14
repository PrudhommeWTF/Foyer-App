// Le registre des types d'élément : un descripteur par type, déclaré par son
// module. La fiche (shell/item-sheet.ts) ne lit que cette table. Un nouveau
// type s'ajoute ici et dans `ItemKindId` (core/items.ts) ; le typage refuse un
// type déclaré sans descripteur.
import type { FoyerStore } from '../core/foyer.store';
import { ItemKind, ItemKindId } from '../core/items';
import { EVENT_ITEM } from '../screens/calendar/event.item';
import { TASK_ITEM } from '../screens/taches/task.item';
import { MEAL_ITEM } from '../screens/repas/meal.item';
import { RECIPE_ITEM } from '../screens/recettes/recipe.item';
import { SLOT_ITEM } from '../screens/planning/slot.item';
import { SHOP_ITEM } from '../screens/courses/shop.item';
import { SHOP_LIST_ITEM } from '../screens/courses/shop-list.item';
import { AISLE_ITEM } from '../screens/courses/aisle.item';
import { PLACE_ITEM } from '../screens/lieux/place.item';
import { PLACE_ITEM_ITEM } from '../screens/lieux/place-item.item';

export const ITEM_REGISTRY: { [K in ItemKindId]: ItemKind<any, FoyerStore> } = {
  event: EVENT_ITEM,
  task: TASK_ITEM,
  meal: MEAL_ITEM,
  recipe: RECIPE_ITEM,
  slot: SLOT_ITEM,
  shop: SHOP_ITEM,
  shopList: SHOP_LIST_ITEM,
  aisle: AISLE_ITEM,
  place: PLACE_ITEM,
  placeItem: PLACE_ITEM_ITEM,
};
