// L'équipement, tel qu'il se déclare à la fiche d'élément. Une fiche ne se
// supprime jamais : « Archiver » la retire de la liste, son historique de pannes
// reste lisible parmi les fiches archivées. Tout membre lit ; un adulte modifie.
import type { FoyerStore } from '../../core/foyer.store';
import { EquipementsStore } from '../../core/equipements.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { EqpItem } from '../../core/equipements.api';
import { EquipmentView } from './equipment-view';
import { EquipmentForm } from './equipment-form';

const eqp = (s: FoyerStore): EquipementsStore => s.injector.get(EquipementsStore);

export const EQUIPMENT_ITEM: ItemKind<EqpItem, FoyerStore> = {
  meta: ITEM_KINDS.equipment,
  load: (s, id) => eqp(s).find(Number(id)),
  title: (it) => it.name,
  view: EquipmentView,
  form: EquipmentForm,
  canEdit: (_it, s) => eqp(s).canEdit(),
  canRemove: (it, s) => eqp(s).canEdit() && !it.archivedAt,
  remove: async (s, it, _ctx, scope) => {
    if (!scope) {
      return { kind: 'ask', question: 'Archiver « ' + it.name + ' » ? La fiche quitte la liste ; elle reste consultable, avec son historique, parmi les fiches archivées.',
        choices: [{ scope: 'archive', label: 'Archiver' }] };
    }
    try { await eqp(s).archive(it.id, true); s.toast('Fiche archivée'); return { kind: 'done' }; }
    catch (err) { s.toast((err as Error).message || 'L’archivage a échoué.'); return { kind: 'invalid' }; }
  },
  actions: (s, it) => (it.archivedAt && eqp(s).canEdit()
    ? [{ label: 'Désarchiver', icon: 'refresh', run: () => { void eqp(s).archive(it.id, false).then(() => s.toast('Fiche remise dans la liste'), (e) => s.toast((e as Error).message)); } }]
    : []),
  openIn: (s) => s.go('equipements'),
  // Les champs de la fiche seulement : une photo jointe pendant qu'on modifie
  // ailleurs n'est pas une modification concurrente.
  fingerprint: (it) => JSON.stringify({ ...it, attachmentList: undefined, events: undefined, replaces: undefined, attachments: undefined }),
};
