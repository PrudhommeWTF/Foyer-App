// Les gestes du module École partagés par les routes et les outils d'assistant :
// un seul chemin d'écriture, donc une seule règle.
import * as repo from './repo';
import { readDoc } from '../state/doc';
import { applyTaskOps } from '../tasks/repo';
import { log } from '../log';

/** Les tâches du document, par identifiant (pour lire la coche d'une tâche projetée). */
export function docTasks(): Map<string, { done: boolean }> {
  const { doc } = readDoc();
  return new Map((Array.isArray(doc['tasks']) ? doc['tasks'] : []).map((t: { id: string; done: boolean }) => [t.id, t]));
}

/**
 * Coche ou décoche un devoir. Quand la tâche projetée existe, c'est elle qu'on
 * coche (l'écran École, les Tâches et l'assistant disent la même chose) ;
 * sinon la valeur est gardée sur le devoir. ÉcoleDirecte l'apprend à la
 * synchronisation suivante. `via` : le nom du jeton quand le geste vient d'un
 * assistant.
 */
export function setHomeworkDone(h: repo.Homework, fait: boolean, by: { id: string | null; name: string }, via: string | null = null): void {
  if (h.taskId && docTasks().has(h.taskId)) {
    applyTaskOps([{ op: fait ? 'done' : 'reopen', opId: `ed-fait-${h.id}-${Date.now().toString(36)}`, id: h.taskId, by: by.id, at: new Date().toISOString(), ...(via ? { via } : {}) }]);
  } else {
    repo.patchHomework(h.id, { doneLocal: fait });
  }
  log.info(`École : devoir ${h.id} marqué ${fait ? 'fait' : 'à faire'} par ${by.name}${via ? ' (via ' + via + ')' : ''} (envoi à ÉcoleDirecte au prochain passage).`);
}
