// Ce que les modules déposent les uns chez les autres : intitulés, et le
// moment où une liste de courses finie propose de clore sa tâche.
//
// Une tâche et un événement sont lus hors contexte, dans une liste où tout le
// reste vient d'ailleurs : « Faire courses de la semaine » ou « Dîner :  » y
// sautent aux yeux. Ces fonctions sont pures pour que leur formulation soit
// vérifiée, et non relue à l'œil une fois de temps en temps.
import { ShopItem, TaskItem } from './models';

/**
 * Intitulé de la tâche qui mène à une liste de courses.
 *
 * La liste porte souvent déjà le mot « courses » : le répéter donnerait « Faire
 * courses de la semaine ». Quand elle s'appelle autrement, son nom est cité, car
 * c'est lui qui distingue la tâche d'une autre.
 */
export function shoppingTaskLabel(listName: string): string {
  const nom = (listName || '').trim();
  if (!nom) return 'Faire les courses';
  if (/^courses\b/i.test(nom)) return 'Faire les ' + nom.charAt(0).toLowerCase() + nom.slice(1);
  return 'Faire les courses : ' + nom;
}

/**
 * Titre de l'événement d'agenda créé depuis un créneau de repas. Les couverts
 * n'y figurent que s'ils ont été précisés : les afficher toujours ferait passer
 * la taille du foyer pour une information sur ce repas-là.
 */
export function mealEventTitle(slotLabel: string, plats: string[], pax?: number | null): string {
  const menu = plats.map((p) => (p || '').trim()).filter(Boolean).join(' · ');
  const tete = (slotLabel || 'Repas').trim();
  return (menu ? tete + ' : ' + menu : tete)
    + (pax && pax > 0 ? ' (' + pax + (pax > 1 ? ' couverts)' : ' couvert)') : '');
}

/**
 * La tâche à proposer de clore quand le dernier article d'une liste vient
 * d'être pris : celle qui ouvre cette liste, encore à faire. Null tant qu'il
 * reste quelque chose à prendre, ou si la liste est vide (rien n'a été fait),
 * ou si aucune tâche ne la porte. On **propose**, on ne coche pas : la tâche
 * appartient au foyer, et « tout dans le panier » n'est pas toujours « courses
 * faites » (il reste à passer en caisse).
 */
export function closableShoppingTask(tasks: readonly TaskItem[], shop: readonly ShopItem[], listId: string): TaskItem | null {
  const items = shop.filter((i) => i.listId === listId);
  if (!items.length || items.some((i) => i.state === 'a-prendre')) return null;
  return tasks.find((t) => t.shopListId === listId && !t.done) || null;
}
