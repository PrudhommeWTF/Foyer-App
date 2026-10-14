// Le repas d'un créneau, tel qu'il se déclare à la fiche d'élément. Son
// identifiant est la clé du créneau (« 2026-10-20-soir ») ; un créneau vide
// s'ouvre en création, avec le jour et le moment dans le contexte.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { MealSlotRef, splitMealKey } from '../../core/meals';
import { parseDay } from '../../core/helpers';
import { HOUSEHOLD_LOCALE, MEAL_SLOTS } from '../../core/constants';
import { MealView } from './meal-view';
import { MealForm } from './meal-form';

export const MEAL_ITEM: ItemKind<MealSlotRef, FoyerStore> = {
  meta: ITEM_KINDS.meal,
  load: (s, key) => { const value = s.mealAt(key); return value ? { key, ...splitMealKey(key), value } : null; },
  title: (m) => (MEAL_SLOTS.find((x) => x.key === m.slot)?.label || 'Repas') + ' du '
    + parseDay(m.dateStr).toLocaleDateString(HOUSEHOLD_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }),
  view: MealView,
  form: MealForm,
  remove: (s, m) => { s.clearMeal(m.key); return { kind: 'done' }; },
  // À l'agenda : un événement pour ceux qui ne regardent que le calendrier ; rappuyer le met à jour.
  actions: (s, m) => [{ label: s.mealEvent(m.key) ? 'Mettre à jour l’agenda' : 'À l’agenda', icon: 'calendar', run: () => s.addMealToCalendar(m.key) }],
  openIn: (s, m) => { s.go('repas'); s.patch({ mealAnchor: m.dateStr }); },
  fingerprint: (m) => JSON.stringify(m.value),
};
