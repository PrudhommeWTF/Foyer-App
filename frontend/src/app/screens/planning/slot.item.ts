// Le créneau d'emploi du temps, tel qu'il se déclare à la fiche d'élément. Une
// série s'ouvre sur une occurrence (`ctx.occ`) : c'est elle que visent « ce
// jour seulement » et « à partir de ce jour ». Un cours venu d'ÉcoleDirecte se
// lit sans se modifier ni se supprimer : il n'est pas dans le document.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { SchedSlot } from '../../core/models';
import { weekdayOf } from '../../core/helpers';
import { isEdSlot } from '../../core/ecole-slots';
import { SlotView } from './slot-view';
import { SlotForm } from './slot-form';

/** La date visée : l'occurrence ouverte, la date d'un ponctuel, sinon aujourd'hui. */
const occOf = (s: FoyerStore, it: SchedSlot, occ?: string): string => occ || it.date || s.todayStr();

export const SLOT_ITEM: ItemKind<SchedSlot, FoyerStore> = {
  meta: ITEM_KINDS.slot,
  load: (s, id) => s.schedAll().find((x) => x.id === id) ?? null,
  title: (it) => it.label,
  view: SlotView,
  form: SlotForm,
  canEdit: (it) => !isEdSlot(it.id),
  canRemove: (it) => !isEdSlot(it.id),
  remove: (s, it, ctx, scope) => s.delSlot(it.id, occOf(s, it, ctx?.occ), scope),
  // Dupliquer ouvre un créneau neuf pré-rempli, par-dessus : le retour ramène à l'original.
  actions: (s, it, ctx) => isEdSlot(it.id) ? [] : [{ label: 'Dupliquer', icon: 'copy', run: () => s.openItem('slot', null, { copy: it.id, date: occOf(s, it, ctx?.occ) }, true) }],
  // L'emploi du temps s'ouvre sur la semaine de l'occurrence, ce jour retenu.
  openIn: (s, it, ctx) => {
    const day = occOf(s, it, ctx?.occ);
    if (isEdSlot(it.id) && s.modEcole()) { s.go('ecole'); return; }
    s.go('planning');
    s.patch({ schedAnchor: day, schedDow: weekdayOf(day) });
  },
  openTarget: (it, s) => (isEdSlot(it.id) && s.modEcole() ? { label: 'Voir dans École', screen: 'ecole' } : null),
  fingerprint: (it) => JSON.stringify(it),
};
