// Les décisions de la synchronisation, pures et testées à part : qui de Foyer
// ou d'ÉcoleDirecte a raison sur « fait », et ce que la tâche projetée doit
// devenir. Aucune base, aucun réseau ici.

/**
 * Trois valeurs de « fait » pour un devoir :
 *   - `ed` : ce qu'ÉcoleDirecte dit maintenant ;
 *   - `synced` : la dernière valeur sur laquelle les deux côtés étaient
 *     d'accord (null tant qu'il n'y en a pas eu) ;
 *   - `local` : ce que Foyer dit (la coche de la tâche, ou de l'écran École).
 *
 * Règles :
 *   - seul Foyer a bougé : on envoie à ÉcoleDirecte ;
 *   - seul ÉcoleDirecte a bougé vers « fait » : on coche la tâche ;
 *   - ÉcoleDirecte a décoché : on ne décoche rien dans Foyer, et on ne renvoie
 *     rien non plus (pas de bras de fer avec l'enfant). Rien ne se décoche seul ;
 *   - les deux ont bougé : s'ils sont d'accord, c'est le nouvel accord ; sinon
 *     le geste fait dans Foyer l'emporte et part.
 * Aucune boucle : une valeur envoyée devient l'accord dès que l'envoi réussit.
 */
export interface DoneState { ed: boolean; synced: boolean | null; local: boolean; }
export interface DoneDecision {
  /** La valeur à envoyer à ÉcoleDirecte, ou null. */
  send: boolean | null;
  /** Cocher la tâche (ÉcoleDirecte dit fait). */
  checkTask: boolean;
  /** Le point d'accord à retenir, sans compter un envoi pas encore réussi. */
  synced: boolean;
}

export function decideDone(s: DoneState): DoneDecision {
  const synced = s.synced ?? s.ed;
  const localMoved = s.local !== synced;
  const edMoved = s.ed !== synced;
  if (localMoved && !edMoved) return { send: s.local, checkTask: false, synced };
  if (edMoved && !localMoved) return s.ed ? { send: null, checkTask: true, synced: true } : { send: null, checkTask: false, synced };
  if (localMoved && edMoved) return s.local === s.ed ? { send: null, checkTask: false, synced: s.ed } : { send: s.local, checkTask: false, synced };
  return { send: null, checkTask: false, synced };
}

/** Une tâche projetée, telle que la synchronisation la veut. */
export interface WantedTask { id: string; listId: string; text: string; note: string; who: string[]; due: string; done: boolean; }
/** La tâche telle qu'elle est dans le document. */
export interface CurrentTask { id: string; listId: string; text: string; note?: string; who: string[]; due: string | null; done: boolean; }

export type TaskPlan =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; fields: Partial<Pick<WantedTask, 'text' | 'note' | 'who' | 'due'>> }
  /** Retirer la tâche : le devoir est passé depuis plus de `KEEP_DAYS`, ou a disparu d'ÉcoleDirecte. */
  | { kind: 'remove' }
  /** L'utilisateur a supprimé la tâche : on le note, et on ne la recrée jamais. */
  | { kind: 'dropped' };

/** Une semaine après la date de rendu, la tâche projetée quitte les Tâches ; le devoir reste dans l'écran École. */
export const KEEP_DAYS = 7;

export function planTask(
  h: { taskId: string | null; taskDroppedAt: string | null; due: string; archived: boolean },
  task: CurrentTask | undefined,
  want: WantedTask,
  today: string,
  keepFrom: string,
): TaskPlan {
  if (h.taskDroppedAt) return { kind: 'none' };
  const gone = h.archived || h.due < keepFrom;
  if (h.taskId && !task) return gone ? { kind: 'none' } : { kind: 'dropped' };
  if (task) {
    if (gone) return { kind: 'remove' };
    const fields: Partial<Pick<WantedTask, 'text' | 'note' | 'who' | 'due'>> = {};
    if (task.text !== want.text) fields.text = want.text;
    if ((task.note || '') !== want.note) fields.note = want.note;
    if (task.due !== want.due) fields.due = want.due;
    if (task.who.join(',') !== want.who.join(',')) fields.who = want.who;
    return Object.keys(fields).length ? { kind: 'edit', fields } : { kind: 'none' };
  }
  // Pas de tâche pour un devoir déjà passé : la liste se remplit de ce qui reste à faire.
  return !gone && h.due >= today ? { kind: 'add' } : { kind: 'none' };
}
