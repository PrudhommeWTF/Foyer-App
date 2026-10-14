// Le devoir ÉcoleDirecte, tel qu'il se déclare à la fiche d'élément. Il se
// lit sans se modifier ni se supprimer (sa source est ÉcoleDirecte) ; seule sa
// case « Fait » s'écrit, sur la ligne comme dans la fiche, et ÉcoleDirecte
// l'apprend à la synchronisation suivante.
import type { FoyerStore } from '../../core/foyer.store';
import { EcoleStore, subjectLabel } from '../../core/ecole.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { EdHomework } from '../../core/ecole.api';
import { HomeworkView } from './homework-view';

const ecole = (s: FoyerStore): EcoleStore => s.injector.get(EcoleStore);

export const HOMEWORK_ITEM: ItemKind<EdHomework, FoyerStore> = {
  meta: ITEM_KINDS.homework,
  load: (s, id) => ecole(s).homeworkById(Number(id)),
  title: (h) => subjectLabel(h.subject),
  view: HomeworkView,
  actions: (s, h) => (h.archived ? [] : [h.done
    ? { label: 'Décocher', icon: 'refresh', run: () => void ecole(s).setDone(h, false) }
    : { label: 'Fait', icon: 'check', run: () => void ecole(s).setDone(h, true) }]),
  openIn: (s) => s.go('ecole'),
  fingerprint: (h) => JSON.stringify(h),
};
