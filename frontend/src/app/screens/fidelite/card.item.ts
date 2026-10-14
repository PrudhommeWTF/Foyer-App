// La carte de fidélité, telle qu'elle se déclare à la fiche d'élément. Sa vue,
// c'est le code présenté en caisse ; ouvrir une carte depuis l'écran compte un
// usage (le classement « fréquemment utilisées »). Supprimer se défait.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { LoyaltyCard } from '../../core/models';
import { CardView } from './card-view';
import { CardForm } from './card-form';

export const CARD_ITEM: ItemKind<LoyaltyCard, FoyerStore> = {
  meta: ITEM_KINDS.card,
  load: (s, id) => s.data()?.cards.find((c) => c.id === id) ?? null,
  title: (c) => c.name,
  view: CardView,
  form: CardForm,
  remove: (s, c) => s.delCard(c.id),
  openIn: (s) => s.go('fidelite'),
  // Le compteur d'usage bouge à chaque présentation : il ne compte pas comme une modification.
  fingerprint: (c) => JSON.stringify([c.name, c.code, c.format, c.color, c.note || '', c.logo || '']),
};
