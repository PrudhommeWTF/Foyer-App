// Les intitulés que le module Cuisine dépose dans les autres écrans.
//
// Une tâche et un événement sont lus hors contexte, dans une liste où tout le
// reste vient d'ailleurs : « Faire courses de la semaine » ou « Dîner :  » y
// sautent aux yeux. Ces deux fonctions sont pures pour que leur formulation soit
// vérifiée, et non relue à l'œil une fois de temps en temps.

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
