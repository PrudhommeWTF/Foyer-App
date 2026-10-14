// Le registre des types d'élément : un descripteur par type, déclaré par son
// module. La fiche (shell/item-sheet.ts) ne lit que cette table. Un nouveau
// type s'ajoute ici et dans `ItemKindId` (core/items.ts) ; le typage refuse un
// type déclaré sans descripteur.
import type { FoyerStore } from '../core/foyer.store';
import { ItemKind, ItemKindId } from '../core/items';
import { EVENT_ITEM } from '../screens/calendar/event.item';
import { TASK_ITEM } from '../screens/taches/task.item';

export const ITEM_REGISTRY: { [K in ItemKindId]: ItemKind<any, FoyerStore> } = {
  event: EVENT_ITEM,
  task: TASK_ITEM,
};
