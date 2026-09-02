// La journée du foyer, telle que le module Calendrier la compose.
//
// Ces fonctions sont pures pour que la tuile d'accueil les appelle au lieu de
// refaire le tri : c'est la seule façon qu'un changement de règle de récurrence
// atteigne l'accueil sans que personne n'y pense.
import { EventItem } from './models';
import { occursOn } from './helpers';

/** Les événements d'un jour, dans l'ordre des heures. Une heure vide vaut « — ». */
export function eventsOn(events: EventItem[], ds: string): EventItem[] {
  return (events || []).filter((e) => occursOn(e, ds)).slice().sort((a, b) => a.time.localeCompare(b.time));
}
