/**
 * Le contrat que chaque module remplit pour paraître sur l'accueil.
 *
 * La règle qui gouverne tout ce dossier : **l'accueil ne calcule rien**. Il
 * compose des tuiles, chaque module fournissant la sienne. Une règle métier
 * écrite dans le composant d'accueil est un défaut, parce qu'elle devient une
 * copie de la logique du module, que la prochaine évolution du module cassera
 * en silence. C'est exactement ce qui s'est produit au remplacement du module
 * Budget par le module Finances.
 *
 * Deuxième règle, tout aussi importante : **un fournisseur est une fonction
 * pure d'un instantané**. Pas de composant, pas d'injection, pas de DOM. C'est
 * ce qui le rend vérifiable au lanceur de tests intégré à Node, sans avoir à
 * démarrer Angular. Le rendu, lui, vit dans `screens/home/`.
 */
import type { FinMonthSummary } from '../finances.api';
import { HouseholdState } from '../models';

/**
 * Plan de données dont dépend une tuile. Le document du foyer et les finances
 * ne tombent pas ensemble et ne se rechargent pas ensemble : les distinguer est
 * ce qui permet à une panne des finances de laisser vivre le reste de l'écran.
 */
export type SourceId = 'document' | 'finances';

/** État d'un plan de données, tel que l'accueil le voit. */
export type Source<T> =
  | { status: 'loading' }
  /** `stale` porte la raison quand la donnée est là mais n'est plus rafraîchie. */
  | { status: 'ready'; data: T; asOf: string; stale?: string }
  | { status: 'error'; message: string; detail: string };

/**
 * Ce qu'une tuile a le droit d'afficher. Quatre états, et non trois : « en
 * cours de chargement » doit se distinguer de « il n'y a rien », faute de quoi
 * une tuile en panne se présente comme une tuile vide. C'est le mensonge le
 * plus fréquent d'un tableau de bord, et le plus difficile à repérer.
 *
 *   - `loading` : la donnée n'est pas encore là. Aucun chiffre n'est affiché.
 *   - `ok`      : la donnée est là. Deux nuances, à ne pas confondre :
 *                 `partial` dit que la donnée elle-même est incomplète (un mois
 *                 dont des comptes manquent), `stale` qu'elle n'est plus
 *                 rafraîchie (le serveur ne répond plus). `asOf` dit de quand
 *                 elle date.
 *   - `empty`   : il n'y a réellement rien, et c'est normal. `hint` le dit
 *                 sans alarmer.
 *   - `error`   : la donnée est indisponible. `message` s'adresse à qui regarde
 *                 l'écran, `detail` à qui lira les journaux.
 *
 * Jamais de zéro à la place d'une valeur inconnue, jamais de dernière valeur
 * connue présentée comme fraîche, jamais d'erreur déguisée en état vide.
 */
export type TileState<T> =
  | { kind: 'loading' }
  | { kind: 'ok'; data: T; asOf: string; partial?: string; stale?: string }
  | { kind: 'empty'; hint: string }
  | { kind: 'error'; message: string; detail: string };

/** Ce que le module Finances publie pour l'accueil. */
export interface FinSnapshot {
  /** Mois en cours du foyer, AAAA-MM. Jamais le mois affiché dans l'écran Finances. */
  month: string;
  /** Son libellé, « Août 2026 ». */
  monthLabel: string;
  /** Synthèse du mois en cours. */
  summary: FinMonthSummary | null;
  /** Comptes déclarés. Zéro veut dire « module jamais servi », pas « zéro euro ». */
  accounts: number;
}

/**
 * L'instantané que voient les fournisseurs. Volontairement pauvre : tout ce
 * qu'on y ajoute devient une dépendance de toutes les tuiles.
 */
export interface TileContext {
  /** Jour du foyer (Europe/Paris), AAAA-MM-JJ. */
  today: string;
  doc: Source<HouseholdState>;
  fin: Source<FinSnapshot>;
}

export interface TileProvider<T = unknown> {
  /** Identifiant stable. Sert de clé de rendu et de nom dans les journaux. */
  readonly id: string;
  readonly title: string;
  /** Écran ouvert par le lien « tout voir ». Vérifié par un test contre la navigation. */
  readonly screen: string;
  /** Libellé de ce lien. */
  readonly link: string;
  readonly source: SourceId;
  state(ctx: TileContext): TileState<T>;
}

/**
 * Enchaîne l'état d'un plan de données sur celui d'une tuile : tant que la
 * source n'est pas prête, la tuile n'a rien à dire, et elle ne l'invente pas.
 */
export function fromSource<S, T>(src: Source<S>, build: (data: S, asOf: string) => TileState<T>): TileState<T> {
  if (src.status === 'loading') return { kind: 'loading' };
  if (src.status === 'error') return { kind: 'error', message: src.message, detail: src.detail };
  const built = build(src.data, src.asOf);
  // La péremption est une propriété du plan de données, pas de la tuile : elle
  // est reportée ici pour qu'aucun fournisseur n'ait à y penser, ni à l'oublier.
  return src.stale && built.kind === 'ok' ? { ...built, stale: src.stale } : built;
}

export const ok = <T>(data: T, asOf: string, partial?: string): TileState<T> =>
  partial ? { kind: 'ok', data, asOf, partial } : { kind: 'ok', data, asOf };
export const empty = <T>(hint: string): TileState<T> => ({ kind: 'empty', hint });

/** La source dont dépend une tuile, pour savoir quoi recharger au « Réessayer ». */
export const sourceOf = (p: TileProvider, ctx: TileContext): Source<unknown> =>
  p.source === 'finances' ? ctx.fin : ctx.doc;

/**
 * Appelle un fournisseur sans jamais laisser passer son exception.
 *
 * C'est la barrière qui tient la promesse « une tuile en erreur n'empêche ni le
 * rendu ni le fonctionnement des autres ». Le message affiché nomme le module,
 * parce que la première question devant une tuile rouge est « laquelle ».
 */
export function safeState(p: TileProvider, ctx: TileContext, log: (line: string, err: unknown) => void): TileState<unknown> {
  try {
    return p.state(ctx);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log(`[foyer] accueil : tuile ${p.id} (source ${p.source}) a échoué : ${detail}`, e);
    return {
      kind: 'error',
      message: 'Cette tuile n’a pas pu être calculée.',
      detail: `Module ${p.id} : ${detail}`,
    };
  }
}
