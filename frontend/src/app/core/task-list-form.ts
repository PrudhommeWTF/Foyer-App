// Le formulaire d'une liste de tâches, sans Angular : ce qu'il montre à
// l'ouverture, la liste qu'il décrit, et s'il change quelque chose. Une liste
// est un réglage du document (pas une coche) : elle part par l'enregistrement
// du document, le serveur en tirant lui-même les conséquences pour les tâches.
import { ListKind, TaskList } from './models';

export interface TaskListFields {
  name: string; color: string; icon: string; kind: ListKind; scope: string; order: 'manuel' | 'echeance';
  forMember: string | null; departure: string; remind: number; placeId: string;
}

/** L'icône par défaut de chaque type : changer de type la propose, tant qu'on n'en a pas choisi une autre. */
export const KIND_ICONS: Record<ListKind, string> = { taches: 'maison', corvees: 'checklist', checklist: 'checklist', preparation: 'valise', devoirs: 'ecole', entretien: 'outils' };

export function taskListFields(l: TaskList | null): TaskListFields {
  if (!l) return { name: '', color: '#E56B4E', icon: KIND_ICONS.taches, kind: 'taches', scope: 'shared', order: 'echeance', forMember: null, departure: '', remind: 3, placeId: '' };
  return {
    name: l.name, color: l.color, icon: l.icon || 'checklist', kind: l.kind, scope: l.scope, order: l.order === 'manuel' ? 'manuel' : 'echeance',
    forMember: l.forMember ?? null, departure: l.departure ?? '', remind: l.remindDaysBefore ?? 3, placeId: l.placeId ?? '',
  };
}

/** Ce que la saisie écrit sur la liste. Les champs de préparation s'effacent sur un autre type. */
export type TaskListData = Pick<TaskList, 'name' | 'color' | 'icon' | 'kind' | 'scope' | 'order' | 'forMember' | 'departure' | 'remindDaysBefore' | 'lastResetAt' | 'placeId'>;

export function taskListData(f: TaskListFields): TaskListData | string {
  const name = f.name.trim(); if (!name) return 'Donne un nom à la liste';
  const prep = f.kind === 'preparation';
  return {
    name, color: f.color, icon: f.icon, kind: f.kind,
    // Une liste de préparation est toujours partagée : l'enfant coche son sac.
    scope: prep ? 'shared' : f.scope,
    // Le mode manuel ne concerne que les tâches et les corvées.
    order: (f.kind === 'taches' || f.kind === 'corvees') && f.order === 'manuel' ? 'manuel' : undefined,
    ...(prep
      ? { forMember: f.forMember || null, departure: f.departure || null, remindDaysBefore: Math.min(30, Math.max(1, Math.round(f.remind || 3))), placeId: f.placeId || null }
      : { forMember: null, departure: null, remindDaysBefore: null, lastResetAt: null, placeId: null }),
  };
}

const shape = (l: Partial<TaskList>): string => JSON.stringify([
  l.name, l.color, l.icon, l.kind, l.scope, l.order === 'manuel' ? 'manuel' : '',
  l.forMember || null, l.departure || null, l.kind === 'preparation' ? l.remindDaysBefore ?? 3 : null, l.placeId || null,
]);
/** La liste décrite change-t-elle la liste enregistrée ? */
export function taskListChanges(l: TaskList, d: TaskListData): boolean { return shape(l) !== shape(d); }
