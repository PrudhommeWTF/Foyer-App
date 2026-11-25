// Les règles de l'Épopée, pures : ni base, ni horloge. Le serveur les applique
// avant chaque écriture, l'appareil ne décide d'aucun montant.

/** Les écus d'amorce : la besace ne commence jamais vide, et ce plancher ne se retire pas. */
export const AMORCE = 5;
/** Un bravo spontané vaut de 1 à 3 écus : un encouragement, pas un salaire. */
export const BRAVO_MAX = 3;
export const NOTE_MAX = 120;

export const KINDS = ['amorce', 'bravo', 'annulation'] as const;
export type Kind = typeof KINDS[number];
export interface Entry { id: string; kind: Kind; delta: number; ref: string | null; }

export const balance = (entries: Entry[]): number => entries.reduce((s, e) => s + e.delta, 0);

/** Les écus d'un bravo, ou null si la valeur n'en est pas une. */
export const bravoEcus = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= BRAVO_MAX ? v : null);

/**
 * Pourquoi cette écriture ne s'annule pas, ou null si elle s'annule. L'amorce
 * est acquise, une annulation ne s'annule pas, une écriture ne s'annule qu'une
 * fois, et reprendre des écus ne fait jamais passer la besace sous son plancher.
 */
export function cancelRefusal(entry: Entry, entries: Entry[], floor: number): string | null {
  if (entry.kind === 'amorce') return 'Les écus d’amorce sont acquis : ils ne se reprennent pas.';
  if (entry.kind === 'annulation') return 'Une annulation ne s’annule pas.';
  if (entries.some((e) => e.ref === entry.id)) return 'Cette écriture est déjà annulée.';
  if (balance(entries) - entry.delta < floor) return 'Ces écus ont déjà servi : les reprendre ferait passer la besace sous son plancher.';
  return null;
}
