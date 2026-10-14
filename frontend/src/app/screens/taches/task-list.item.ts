// La liste de tâches, telle qu'elle se déclare à la fiche d'élément. Une liste
// de devoirs (ÉcoleDirecte) se lit sans se modifier ni se supprimer : elle
// suit son élève. Supprimer une liste se confirme (elle emporte ses tâches),
// en proposant d'archiver plutôt.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemAction, ItemKind } from '../../core/items';
import { TaskList } from '../../core/models';
import { TaskListView } from './task-list-view';
import { TaskListForm } from './task-list-form';

export const TASK_LIST_ITEM: ItemKind<TaskList, FoyerStore> = {
  meta: ITEM_KINDS.taskList,
  load: (s, id) => s.data()?.taskLists.find((l) => l.id === id) ?? null,
  title: (l) => l.name,
  view: TaskListView,
  form: TaskListForm,
  canEdit: (l) => l.kind !== 'devoirs',
  canRemove: (l) => l.kind !== 'devoirs',
  remove: (s, l, _ctx, scope) => s.delTaskList(l.id, scope),
  actions: (s, l) => {
    if (l.kind === 'devoirs') return [];
    const a: ItemAction[] = [{ label: l.archived ? 'Restaurer' : 'Archiver', icon: l.archived ? 'refresh' : 'folder', run: () => s.archiveTaskList(l.id, !l.archived) }];
    a.push({ label: 'En modèle', icon: 'copy', run: () => s.saveListAsTemplate(l.id) });
    return a;
  },
  // Le module s'ouvre sur la liste, archivées montrées s'il le faut pour la voir.
  openIn: (s, l) => { s.go('taches'); s.patch({ activeList: l.id, ...(l.archived ? { showArchived: true } : {}) }); },
  fingerprint: (l) => JSON.stringify(l),
};
