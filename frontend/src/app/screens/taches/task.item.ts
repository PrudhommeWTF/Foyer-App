// La tâche, telle qu'elle se déclare à la fiche d'élément. Une tâche de devoir
// (venue d'ÉcoleDirecte) se lit et se coche, mais ne se modifie ni ne se
// supprime ici : sa source est ÉcoleDirecte.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { TaskItem } from '../../core/models';
import { TaskView } from './task-view';
import { TaskForm } from './task-form';
import { ENTRETIEN_LIST_ID } from '../../core/entretien';

export const TASK_ITEM: ItemKind<TaskItem, FoyerStore> = {
  meta: ITEM_KINDS.task,
  load: (s, id) => s.task(id) ?? null,
  title: (t) => t.text,
  view: TaskView,
  form: TaskForm,
  canEdit: (t) => !t.edId,
  canRemove: (t) => !t.edId,
  // Sur une série, supprimer pose la question d'avant : passer cette occurrence, ou toute la série.
  remove: (s, t, _ctx, scope) => {
    if (t.rec && !scope) {
      return { kind: 'ask', question: 'Cette tâche revient. Que faire ?', choices: [
        { scope: 'one', label: 'Passer cette occurrence' }, { scope: 'all', label: 'Supprimer la série', danger: true }] };
    }
    s.removeTask(t.id, scope === 'one' ? 'one' : 'all');
    return { kind: 'done' };
  },
  // « Fait » d'un tap, annulable ; un devoir coché ne se décoche pas d'ici.
  actions: (s, t) => t.done
    ? (t.edId ? [] : [{ label: 'Rouvrir', icon: 'refresh', run: () => s.toggleTask(t.id) }])
    : [{ label: 'Fait', icon: 'check', run: () => s.toggleTask(t.id) }],
  openIn: (s, t) => {
    if (t.edId && s.modEcole()) { s.go('ecole'); return; }
    if (t.listId === ENTRETIEN_LIST_ID && s.modEntretien()) { s.go('entretien'); return; }
    s.go('taches');
    s.patch({ activeList: t.listId });
  },
  openTarget: (t, s) => (t.edId && s.modEcole() ? { label: 'Voir dans École', screen: 'ecole' }
    : t.listId === ENTRETIEN_LIST_ID && s.modEntretien() ? { label: 'Ouvrir dans Entretien', screen: 'entretien' } : null),
  fingerprint: (t) => JSON.stringify(t),
  changedBy: (t) => ({ by: t.upBy ?? t.by ?? null, at: t.upAt ?? t.at ?? null }),
};
