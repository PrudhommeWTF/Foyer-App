// Le rejeu des modifications locales sur le document du serveur.
//
// Le document du foyer s'enregistre en entier. À deux sur l'application, une
// écriture partie d'un document périmé effaçait le travail de l'autre : le
// serveur refuse désormais (voir backend/src/state/concurrency.ts), et c'est ici
// qu'on décide quoi faire de ce refus.
//
// Le choix : **rejouer plutôt que redemander**. Une mutation est une fonction
// qui modifie le document ; les rejouer sur la version du serveur donne un
// document qui contient les deux travaux, sans rien demander à personne. Le
// contraire (« vos modifications ont été perdues, rechargez ») serait une façon
// polie de perdre quand même.
//
// Ce que ce mécanisme ne prétend pas résoudre : deux personnes qui modifient la
// **même** chose en même temps. Cocher une tâche que l'autre vient de cocher la
// décoche, parce que « cocher » est écrit comme une bascule. Il n'y a pas de
// bonne réponse automatique à ce cas, et il est rare ; perdre l'événement qu'on
// vient de créer parce que l'autre a coché une tâche, ça, ce n'était pas rare.
import { HouseholdState } from './models';

/** Une modification locale du document, telle que le store l'applique. */
export type Mutation = (d: HouseholdState) => void;

export interface RebaseReport {
  state: HouseholdState;
  /** Mutations rejouées sans encombre. */
  replayed: number;
  /**
   * Mutations qui ont levé, parce que ce qu'elles visaient n'existe plus sur la
   * version du serveur. Elles sont comptées et non tues : c'est la seule part du
   * travail qui se perd, et l'utilisateur a le droit de le savoir.
   */
  dropped: number;
}

export function rebase(server: HouseholdState, pending: readonly Mutation[]): RebaseReport {
  const state = structuredClone(server);
  let replayed = 0;
  let dropped = 0;
  for (const fn of pending) {
    try { fn(state); replayed++; } catch { dropped++; }
  }
  return { state, replayed, dropped };
}

/** Ce que le serveur renvoie avec un 409, et qui suffit à rejouer. */
export interface StateConflict { version: number; state: HouseholdState; }

/** Reconnaît le corps d'un refus de version, sans faire confiance à sa forme. */
export function asConflict(status: number, body: unknown): StateConflict | null {
  if (status !== 409 || !body || typeof body !== 'object') return null;
  const b = body as { version?: unknown; state?: unknown };
  if (typeof b.version !== 'number' || !b.state || typeof b.state !== 'object') return null;
  return { version: b.version, state: b.state as HouseholdState };
}
