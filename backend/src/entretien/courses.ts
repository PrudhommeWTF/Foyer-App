// Un consommable d'entretien vers la liste de courses : la cartouche, le filtre,
// le sel régénérant. Par le chemin commun des courses (shopping/add.ts) : sans
// doublon, dans la liste principale, rangé dans le rayon où le foyer l'a déjà
// pris, sinon au rayon « entretien », sinon au repli.
//
// Deux portes : le bouton « Ajouter aux courses » (route), et l'ajout
// automatique au passage sous le seuil quand le réglage entretienCoursesAuto
// est allumé (voir server.ts, onStockAlerts). Le passage n'alerte qu'une fois
// (stock.alerted, tasks/ops.ts).
import { getHousehold } from '../db';
import type { HouseholdState } from '../models';
import { addShopItems, aisleForName, mainShopList } from '../shopping/add';
import { ENTRETIEN_LIST_ID } from './list';

export type CoursesOutcome = { kind: 'ajoute' | 'deja'; article: string; liste: string } | { kind: 'refus'; error: string };

export function gesteToShopping(taskId: string, meta: { by: string | null; via?: string | null }): CoursesOutcome {
  const s = getHousehold().state as HouseholdState;
  const t = (s.tasks || []).find((x) => x.id === taskId && x.listId === ENTRETIEN_LIST_ID);
  const article = t?.maintenance?.stock?.article;
  if (!t) return { kind: 'refus', error: 'Geste introuvable.' };
  if (!article) return { kind: 'refus', error: 'Ce geste ne consomme rien : il n’y a pas d’article à ajouter.' };
  const list = mainShopList(s);
  const aisleId = aisleForName(s, article, 'entretien');
  if (!list || !aisleId) return { kind: 'refus', error: 'Aucune liste de courses où ajouter.' };
  const r = addShopItems(s, list, [{ name: article, aisleId }], meta);
  return { kind: r.added.length ? 'ajoute' : 'deja', article, liste: list.name };
}
