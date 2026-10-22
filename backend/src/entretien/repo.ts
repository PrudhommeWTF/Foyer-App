// Le module Entretien vu du serveur : ce qu'il contient, et sa remise à zéro.
//
// Ses gestes sont des tâches de la liste Entretien : les compter et les
// effacer passe par le moteur des tâches, dans sa transaction et son journal,
// jamais par une écriture du document à côté de lui.
import { applyTaskOps, getTasks } from '../tasks/repo';
import { ENTRETIEN_LIST_ID } from './list';
import { countProofs } from './realisations';

const gestes = () => getTasks().items.filter((t) => t.listId === ENTRETIEN_LIST_ID);

/** Ce que la confirmation d'un « repartir à zéro » annonce. */
export function moduleCounts(): { gestes: number; realisations: number; justificatifs: number } {
  const g = gestes();
  return { gestes: g.length, realisations: g.reduce((n, t) => n + (t.history?.length || 0), 0), justificatifs: countProofs() };
}

/**
 * Efface les gestes et leur historique. La liste reste (elle appartient au
 * module, pas à ses données), et les pièces aussi : c'est un socle commun que
 * d'autres modules partagent.
 */
export function resetModule(): number {
  const at = new Date().toISOString();
  const ops = gestes().map((t, i) => ({ op: 'remove', opId: `reset-entretien-${Date.now()}-${i}`, id: t.id, at }));
  if (ops.length) applyTaskOps(ops, { trusted: true });
  return ops.length;
}
