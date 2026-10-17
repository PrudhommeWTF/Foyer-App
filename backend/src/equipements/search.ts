// La recherche d'équipements, pure : partagée par l'API et, plus tard, par
// l'assistant. Insensible à la casse, aux accents et aux espaces : un numéro de
// série se tape rarement comme il est imprimé sur la plaque.
import type { Item } from './repo';

/** Minuscules, sans accents ni espaces : « ab 12 CD » trouve « AB12cd ». Les tirets, eux, comptent. */
export const norm = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '');

/** La recherche porte sur la désignation, la marque, le modèle et, pour un adulte, le numéro de série. */
export function matches(it: Item, q: string, child: boolean): boolean {
  const n = norm(q); if (!n) return true;
  const hay = [it.name, it.brand, it.model, `${it.brand}${it.model}`, child ? '' : it.serial].map(norm);
  return hay.some((h) => h.includes(n));
}
