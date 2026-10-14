// La machine d'état de la fiche d'élément, sans Angular : ouvrir, passer en
// édition, revenir, enregistrer, fermer, empiler. Le store n'en est que le
// relais, la fiche n'en est que l'affichage, et les tests la vérifient seule.
import { ItemCtx, ItemKindId, ItemRef } from './items';

/**
 * Ouvre un élément. Sans identifiant, c'est une création : directement en
 * édition. `stack` : ouvert depuis une fiche (la recette depuis un repas), la
 * fiche courante devient le retour. Jamais plus de deux niveaux : on ne garde
 * que la fiche immédiatement précédente, ramenée en vue.
 */
export function sheetOpen(cur: ItemRef | null, kind: ItemKindId, id: string | null, ctx?: ItemCtx, stack = false): ItemRef {
  const prev = stack && cur ? asPrev(cur) : undefined;
  const c: ItemCtx = { ...(ctx || {}) };
  if (prev) c.prev = prev; else delete c.prev;
  const out: ItemRef = { kind, id, mode: id ? 'vue' : 'edition' };
  if (Object.keys(c).length) out.ctx = c;
  return out;
}
function asPrev(cur: ItemRef): ItemRef {
  const { prev: _drop, ...rest } = cur.ctx || {};
  const out: ItemRef = { kind: cur.kind, id: cur.id, mode: 'vue' };
  if (Object.keys(rest).length) out.ctx = rest;
  return out;
}

/** « Modifier » : la même fiche, en édition. Sans effet sur une création (déjà en édition). */
export function sheetEdit(cur: ItemRef | null): ItemRef | null {
  return cur && cur.id ? { ...cur, mode: 'edition' } : cur;
}

/**
 * Le geste retour (bouton Android, Échap, glisser vers le bas) : de l'édition à
 * la vue, de la vue à la fiche précédente, sinon fermeture. Une création n'a
 * pas de vue : on revient d'où l'on vient.
 */
export function sheetBack(cur: ItemRef | null): ItemRef | null {
  if (!cur) return null;
  if (cur.mode === 'edition' && cur.id) return { ...cur, mode: 'vue' };
  return cur.ctx?.prev ?? null;
}

/**
 * Après un enregistrement réussi : retour à la vue de l'élément ; une création
 * referme la fiche. `id` : ce qui a été enregistré est un autre élément (une
 * occurrence modifiée seule devient un événement à part) : la fiche le suit,
 * sans l'occurrence de la série dont il vient.
 */
export function sheetSaved(cur: ItemRef | null, id?: string): ItemRef | null {
  if (!cur) return null;
  if (!cur.id) return cur.ctx?.prev ?? null;
  if (!id || id === cur.id) return { ...cur, mode: 'vue' };
  const { occ: _occ, ...ctx } = cur.ctx || {};
  const out: ItemRef = { kind: cur.kind, id, mode: 'vue' };
  if (Object.keys(ctx).length) out.ctx = ctx;
  return out;
}

/**
 * Le nombre d'entrées d'historique que la fiche occupe : une par niveau ouvert,
 * plus une pour l'édition. C'est ce qui fait qu'un retour système revient d'un
 * cran dans la fiche au lieu de quitter l'application.
 */
export function sheetDepth(cur: ItemRef | null): number {
  if (!cur) return 0;
  return sheetDepth(cur.ctx?.prev ?? null) + 1 + (cur.mode === 'edition' && cur.id ? 1 : 0);
}
