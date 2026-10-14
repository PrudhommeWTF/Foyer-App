// La note ÉcoleDirecte, telle qu'elle se déclare à la fiche d'élément : elle
// se lit seulement. Elle remplace le détail qui se dépliait dans la liste.
import type { FoyerStore } from '../../core/foyer.store';
import { EcoleStore, subjectLabel } from '../../core/ecole.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { GradeRef, GradeView } from './grade-view';

const ecole = (s: FoyerStore): EcoleStore => s.injector.get(EcoleStore);

export const GRADE_ITEM: ItemKind<GradeRef, FoyerStore> = {
  meta: ITEM_KINDS.grade,
  load: (s, id) => ecole(s).gradeById(Number(id)),
  title: (r) => subjectLabel(r.grade.subject),
  view: GradeView,
  openIn: (s) => s.go('ecole'),
  fingerprint: (r) => JSON.stringify(r.grade),
};
