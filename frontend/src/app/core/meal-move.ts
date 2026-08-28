// Déplacer un repas d'un créneau à un autre.
//
// Le gratin passe de mardi à jeudi : c'est le geste le plus courant après la
// recopie, et il fallait jusqu'ici retirer le repas d'un créneau pour le
// recomposer dans l'autre, en perdant les couverts au passage.
//
// Deux règles portent tout le reste :
//
//   - **Rien ne se perd.** Si le créneau visé porte déjà un repas, les deux sont
//     échangés plutôt que l'un écrasé. Un déplacement n'a aucune raison de
//     détruire, et l'échange est presque toujours ce qu'on voulait.
//   - **L'événement d'agenda suit son repas.** Sans cela, un dîner déplacé
//     resterait annoncé au mauvais jour, ce qui est pire que pas d'agenda du
//     tout : c'est précisément là que quelqu'un se fie au calendrier.

import { EventItem, MealValue } from './models';

/** Clé d'un créneau : « 2026-08-21-soir ». La date fait toujours dix caractères. */
export const slotOf = (key: string): string => key.slice(11);
export const dayOf = (key: string): string => key.slice(0, 10);

export interface MoveResult {
  meals: Record<string, MealValue>;
  events: EventItem[];
  /** Vrai quand les deux créneaux ont échangé leurs repas. */
  swapped: boolean;
  /** Faux quand il n'y avait rien à déplacer, ou que la cible est l'origine. */
  moved: boolean;
}

/**
 * Rend l'état des repas et des événements après le déplacement, sans toucher
 * aux originaux.
 *
 * `retitle` reformule le titre d'un événement pour son nouveau créneau : le
 * titre nomme l'heure du repas (« Dîner : … »), et le laisser tel quel après un
 * passage de midi au soir écrirait un mensonge. La fonction est fournie par
 * l'appelant, seul à savoir résoudre le nom des plats.
 */
export function moveMeal(
  meals: Record<string, MealValue>,
  events: EventItem[],
  from: string,
  to: string,
  retitle: (value: MealValue, slotKey: string) => string,
  timeOf: (slotKey: string) => string,
): MoveResult {
  const source = meals[from];
  if (from === to || !source?.items?.length) {
    return { meals, events, swapped: false, moved: false };
  }
  const cible = meals[to];
  const swapped = !!cible?.items?.length;

  const out = { ...meals };
  out[to] = source;
  if (swapped) out[from] = cible; else delete out[from];

  // Chaque événement issu de l'un des deux créneaux repart avec son repas.
  const bouge = (e: EventItem): EventItem => {
    if (e.mealKey !== from && e.mealKey !== to) return e;
    const vers = e.mealKey === from ? to : from;
    const value = out[vers];
    if (!value) return e;
    return { ...e, mealKey: vers, date: dayOf(vers), time: timeOf(slotOf(vers)), title: retitle(value, slotOf(vers)) };
  };
  return { meals: out, events: events.map(bouge), swapped, moved: true };
}
