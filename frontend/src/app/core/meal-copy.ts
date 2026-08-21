// Recopier des repas d'une période sur une autre.
//
// C'est le geste le plus fréquent d'un planning familial : une semaine
// ressemble à la précédente, à deux ou trois plats près. Le refaire à la main,
// quatorze créneaux à rouvrir un par un, décourage de tenir le planning à jour,
// et un planning qu'on ne tient pas ne sert plus à faire les courses.
//
// Deux façons de recopier, et la différence n'est pas cosmétique :
//
//   - **Compléter** ne remplit que les créneaux vides. Rien n'est jamais détruit,
//     donc le geste est sans risque, y compris sur une semaine déjà à moitié
//     composée.
//   - **Remplacer** fait de la période visée la copie exacte de la source, ce qui
//     **vide** les créneaux que la source n'a pas. C'est ce qu'on veut quand on
//     repart de zéro, et c'est destructeur : l'écran doit le dire avant d'agir.
//
// Le calcul est séparé de l'écriture pour que le rapport puisse être montré
// d'abord, comme pour la génération des courses.

import { MealValue } from './models';

export type CopyMode = 'fill' | 'replace';

/** Une écriture prévue : d'où vient le repas, où il va, et ce qu'il contient. */
export interface CopyWrite { from: string; to: string; plats: number; }

export interface CopyReport {
  mode: CopyMode;
  /** Créneaux qui recevront un repas. */
  writes: CopyWrite[];
  /** Créneaux visés déjà garnis, laissés intacts (mode « compléter »). */
  kept: string[];
  /** Créneaux visés déjà garnis qui seront écrasés ou vidés (mode « remplacer »). */
  cleared: string[];
  /** Vrai quand la source ne contient aucun repas : il n'y a rien à recopier. */
  sourceEmpty: boolean;
}

const key = (day: string, slot: string): string => day + '-' + slot;
const garni = (v?: MealValue): boolean => !!v?.items?.length;

/**
 * Deux créneaux qui portent déjà le même menu. Les distinguer évite d'annoncer
 * un écrasement là où rien ne changerait : une alerte qui crie pour rien finit
 * par ne plus être lue.
 */
const identique = (a?: MealValue, b?: MealValue): boolean =>
  JSON.stringify(a?.items ?? []) === JSON.stringify(b?.items ?? []) && (a?.pax ?? null) === (b?.pax ?? null);

/**
 * Calcule ce que la copie ferait, sans rien écrire. `source` et `target` sont
 * deux listes de jours de même longueur, dans le même ordre : le premier jour de
 * l'une correspond au premier jour de l'autre.
 */
export function planMealCopy(
  meals: Record<string, MealValue>,
  source: string[],
  target: string[],
  slots: string[],
  mode: CopyMode,
): CopyReport {
  if (source.length !== target.length) throw new Error('Périodes de longueurs différentes');
  const report: CopyReport = { mode, writes: [], kept: [], cleared: [], sourceEmpty: true };

  source.forEach((jour, i) => {
    for (const slot of slots) {
      const de = key(jour, slot);
      const vers = key(target[i], slot);
      // Un même jour recopié sur lui-même n'a aucun sens et ferait perdre le
      // repas en mode « remplacer ».
      if (de === vers) continue;
      const src = meals[de];
      const dst = meals[vers];
      if (garni(src)) report.sourceEmpty = false;

      if (garni(src)) {
        if (garni(dst) && identique(src, dst)) { report.kept.push(vers); continue; }
        if (garni(dst) && mode === 'fill') { report.kept.push(vers); continue; }
        if (garni(dst)) report.cleared.push(vers);
        report.writes.push({ from: de, to: vers, plats: src.items.length });
      } else if (garni(dst) && mode === 'replace') {
        // La source est vide : en mode « remplacer », la cible le devient aussi.
        report.cleared.push(vers);
      } else if (garni(dst)) {
        report.kept.push(vers);
      }
    }
  });
  return report;
}

/**
 * Applique un rapport de copie. Les repas sont **dupliqués en profondeur** :
 * modifier le menu d'une semaine ne doit jamais changer celui de l'autre, ce
 * qu'un partage de référence ferait silencieusement.
 */
export function applyMealCopy(meals: Record<string, MealValue>, report: CopyReport): Record<string, MealValue> {
  const out = { ...meals };
  // Les vidages d'abord : une cible écrasée est ensuite réécrite par sa source.
  for (const k of report.cleared) delete out[k];
  for (const w of report.writes) {
    const src = meals[w.from];
    if (!src) continue;
    out[w.to] = {
      items: src.items.map((it) => ({ ...it })),
      ...(src.pax ? { pax: src.pax } : {}),
    };
  }
  return out;
}
