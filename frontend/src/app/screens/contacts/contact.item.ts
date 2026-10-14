// Le contact, tel qu'il se déclare à la fiche d'élément. « Appeler » reste un
// tap direct sur la carte de l'écran ; le reste de la carte ouvre la fiche.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { Contact } from '../../core/models';
import { ContactView } from './contact-view';
import { ContactForm } from './contact-form';

export const CONTACT_ITEM: ItemKind<Contact, FoyerStore> = {
  meta: ITEM_KINDS.contact,
  load: (s, id) => s.data()?.contacts.find((c) => c.id === id) ?? null,
  title: (c) => c.name,
  view: ContactView,
  form: ContactForm,
  remove: (s, c) => s.delContact(c.id),
  // Le contact s'ouvre dans sa catégorie, la recherche vidée pour qu'il y soit.
  openIn: (s, c) => { s.go('contacts'); s.patch({ contactCat: c.cat, contactSearch: '' }); },
  fingerprint: (c) => JSON.stringify(c),
};
