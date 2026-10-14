// L'événement, tel qu'il se déclare à la fiche d'élément.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { EventItem } from '../../core/models';
import { EventView } from './event-view';
import { EventForm } from './event-form';

export const EVENT_ITEM: ItemKind<EventItem, FoyerStore> = {
  meta: ITEM_KINDS.event,
  load: (s, id) => s.data()?.events.find((e) => e.id === id) ?? null,
  title: (e) => e.title,
  view: EventView,
  form: EventForm,
  remove: (s, e, ctx, scope) => s.delEvent(e.id, ctx?.occ || '', scope),
  // L'agenda s'ouvre sur le mois de l'occurrence touchée, ce jour sélectionné.
  openIn: (s, e, ctx) => {
    const day = ctx?.occ || e.date;
    s.closeItem();
    s.go('calendar');
    s.patch({ calAnchor: day, selDay: day });
  },
  fingerprint: (e) => JSON.stringify(e),
  changedBy: (e) => ({ by: e.upBy ?? e.by ?? null, at: e.upAt ?? e.at ?? null }),
};
