// La présence de l'employé à domicile, telle qu'elle se déclare à la fiche
// d'élément. Elle vit dans les tables du module (pas dans le document) : la
// fiche la lit dans le mois affiché et attend le serveur pour l'écrire. Un mois
// figé (déclaré, payé) ne se modifie pas d'ici.
import type { FoyerStore } from '../../core/foyer.store';
import { EmployesStore } from '../../core/employes.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { EmpShift } from '../../core/employes.api';
import { parseDay } from '../../core/helpers';
import { HOUSEHOLD_LOCALE } from '../../core/constants';
import { ShiftView } from './shift-view';
import { ShiftForm } from './shift-form';

const emp = (s: FoyerStore): EmployesStore => s.injector.get(EmployesStore);
const open = (s: FoyerStore): boolean => !emp(s).recap()?.frozen;

export const SHIFT_ITEM: ItemKind<EmpShift, FoyerStore> = {
  meta: ITEM_KINDS.shift,
  load: (s, id) => emp(s).shift(Number(id)),
  title: (sh) => 'Présence du ' + parseDay(sh.day).toLocaleDateString(HOUSEHOLD_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }),
  view: ShiftView,
  form: ShiftForm,
  canEdit: (_sh, s) => open(s),
  canRemove: (_sh, s) => open(s),
  remove: async (s, sh) => ((await emp(s).retirer(sh)) ? { kind: 'done' } : { kind: 'invalid' }),
  openIn: (s, sh) => { s.go('employe'); if (sh.day.slice(0, 7) !== emp(s).month()) emp(s).setMonth(sh.day.slice(0, 7)); },
  fingerprint: (sh) => JSON.stringify(sh),
  changedBy: (sh) => ({ by: sh.updatedBy || sh.createdBy, at: sh.updatedAt || sh.createdAt }),
};
