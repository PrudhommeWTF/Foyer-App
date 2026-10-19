// Le formulaire des paramètres d'un exercice, engendré depuis leur
// déclaration (exercises/contract.ts) : jamais écrit pour un exercice. Ce
// module en porte la logique, pure et testée ; le composant
// (screens/revisions/params-form.ts) ne fait que l'afficher.
import { ExerciseDef, ParamDecl, ParamType, Params, readParams } from './exercises/contract';

/**
 * Comment chaque type de paramètre s'affiche. Un `Record` sur tous les types :
 * un type ajouté au contrat sans rendu ici ne compile pas, et le test du
 * registre refuse un paramètre d'un type que le formulaire ne connaît pas.
 */
export const FORM_CONTROLS: Record<ParamType, 'liste' | 'oui-non' | 'choix' | 'de-a'> = {
  int: 'liste', bool: 'oui-non', enum: 'choix', range: 'de-a',
};

/** Les valeurs proposées pour un entier ou une borne : de min à max. */
export const steps = (min: number, max: number): number[] => Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);

/** La borne haute d'un paramètre « de … à … » : celle d'un autre paramètre quand il en dépend (« jusqu'à la dernière table »). */
export function rangeTop(d: Extract<ParamDecl, { type: 'range' }>, p: Params): number {
  const v = d.maxFrom !== undefined ? p[d.maxFrom] : undefined;
  return typeof v === 'number' ? Math.min(v, d.max) : d.max;
}

/**
 * Change un paramètre, puis ramène dans leurs bornes ceux qui en dépendent
 * (baisser la dernière table raccourcit les tables travaillées), et relit le
 * tout par la même validation que le serveur.
 */
export function setParam(def: ExerciseDef, p: Params, key: string, value: Params[string]): Params {
  const next: Params = { ...p, [key]: value };
  for (const d of def.params) {
    if (d.type !== 'range') continue;
    const top = rangeTop(d, next);
    const [a, b] = (next[d.key] as [number, number] | undefined) ?? d.default;
    const lo = Math.min(Math.max(a, d.min), top);
    next[d.key] = [lo, Math.min(Math.max(b, lo), top)];
  }
  return readParams(def, next);
}
