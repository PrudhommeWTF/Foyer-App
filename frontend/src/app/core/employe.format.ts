// Mise en forme du récapitulatif « Ménage », isolée et pure pour être testée
// sans écran. Le calcul du net vient du serveur (le taux du jour de chaque
// présence) ; ici on ne fait que présenter ce qu'il renvoie, dans les unités du
// CESU (heures décimales, euros).

/** Minutes vers heures décimales lisibles : « 9 h », « 3,5 h », « 0 h ». */
export const decHours = (min: number): string => ((min / 60).toFixed(2).replace(/\.?0+$/, '') || '0').replace('.', ',') + ' h';

/** Centimes vers euros : « 130,50 € ». */
export const eurosFmt = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',') + ' €';

/** Les heures décimales sans unité, pour le presse-papier CESU (« 9 », « 3,5 »). */
export const hoursPlain = (min: number): string => (min / 60).toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
/** Les euros sans symbole, pour le presse-papier CESU (« 130,50 »). */
export const eurosPlain = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',');

export interface RecapLite {
  minutes: number;
  netCents: number | null;
  buckets: { netHourlyCents: number | null; minutes: number; netCents: number | null }[];
}

/** Le bloc CESU en morceaux affichables, y compris le détail quand le taux a changé en cours de mois. */
export function cesuSummary(r: RecapLite, congesInclus: boolean): { heures: string; net: string; conges: string; detail: string | null } {
  return {
    heures: decHours(r.minutes),
    net: r.netCents != null ? eurosFmt(r.netCents) : 'taux à régler',
    conges: congesInclus ? 'inclus dans le taux (majoration de 10 %)' : 'non inclus',
    detail: r.buckets.length > 1
      ? r.buckets.map((b) => `${decHours(b.minutes)} à ${b.netHourlyCents != null ? eurosFmt(b.netHourlyCents) + '/h' : 'taux inconnu'}`).join(' ; ')
      : null,
  };
}
