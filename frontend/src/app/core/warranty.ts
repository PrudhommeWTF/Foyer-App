// L'état de la garantie d'un équipement, calculé à la lecture et jamais stocké.
//
// Pur : aucune base, aucune horloge (la date du jour est passée en argument).
// Une seule règle d'or, « ne jamais mentir » : un appareil sans date d'achat,
// ou sans durée connue, est en garantie **inconnue**, jamais « hors garantie ».
//
// L'ordre des règles :
//   1. une date de fin saisie (extension, contrat, date explicite) l'emporte ;
//   2. sinon il faut une date d'achat, à laquelle on ajoute :
//      a. la durée saisie sur la fiche (constructeur), en mois ;
//      b. sinon la règle par défaut selon l'état à l'achat :
//         - neuf : le réglage foyer `eqpGarantieDefautMois` (24 mois, garantie
//           légale de conformité ; 0 veut dire « pas de règle par défaut ») ;
//         - occasion achetée à un professionnel : 12 mois ;
//         - occasion entre particuliers : aucune garantie légale, donc inconnue
//           tant qu'aucune durée n'est saisie.
//
// Le dernier jour compte : « jusqu'au 12/03/2027 » est vrai le 12/03/2027, et
// « hors garantie depuis le 13/03/2027 » à partir du lendemain.

export type WarrantyState = 'sous_garantie' | 'expire_bientot' | 'hors_garantie' | 'inconnue';
export type Condition = 'neuf' | 'occasion_pro' | 'occasion_particulier';
export const CONDITIONS: readonly Condition[] = ['neuf', 'occasion_pro', 'occasion_particulier'];
/** Durée appliquée à une occasion achetée à un professionnel. */
export const USED_PRO_MONTHS = 12;

export interface WarrantyInput {
  purchasedOn: string | null;
  condition: Condition;
  warrantyMonths: number | null;
  warrantyUntil: string | null;
}
export interface WarrantyRules {
  /** `eqpGarantieDefautMois` : 0 = pas de règle par défaut. */
  defaultMonths: number;
  /** `eqpGarantieAlerteJours` : en deçà, la garantie « expire bientôt ». */
  alertDays: number;
}
export type WarrantySource = 'date_fin' | 'duree_fiche' | 'defaut' | 'occasion_pro';

export interface Warranty {
  state: WarrantyState;
  /** Dernier jour couvert (AAAA-MM-JJ), ou null si inconnue. */
  until: string | null;
  /** Premier jour hors garantie, ou null. */
  since: string | null;
  /** Jours restants jusqu'au dernier jour couvert (0 le dernier jour), négatif une fois passée. */
  daysLeft: number | null;
  source: WarrantySource | null;
  months: number | null;
  /** La phrase de la pastille : « Sous garantie jusqu'au 12/03/2027 ». */
  label: string;
  /** D'où vient la date : « 24 mois à partir du 12/03/2025, règle par défaut. » */
  explain: string;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const isDay = (s: unknown): s is string => {
  if (typeof s !== 'string') return false;
  const m = DAY.exec(s); if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const utc = (s: string): Date => new Date(s + 'T00:00:00Z');
const iso = (d: Date): string => d.toISOString().slice(0, 10);
/** JJ/MM/AAAA, comme partout dans Foyer. */
export const frDate = (s: string): string => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/**
 * Ajoute des mois en restant dans le mois visé : 31/01 + 1 mois = 28/02 (29 les
 * années bissextiles), jamais un débordement au 3 mars.
 */
export function addMonths(day: string, months: number): string {
  const d = utc(day);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months, dd = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(dd, last))));
}
export const addDays = (day: string, n: number): string => { const d = utc(day); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const daysBetween = (from: string, to: string): number => Math.round((utc(to).getTime() - utc(from).getTime()) / 86400000);

const unknown = (explain: string): Warranty => ({
  state: 'inconnue', until: null, since: null, daysLeft: null, source: null, months: null, label: 'Garantie inconnue', explain,
});

export function computeWarranty(item: WarrantyInput, rules: WarrantyRules, today: string): Warranty {
  let until: string;
  let source: WarrantySource;
  let months: number | null = null;
  let explain: string;
  if (isDay(item.warrantyUntil)) {
    until = item.warrantyUntil;
    source = 'date_fin';
    explain = `Date de fin saisie sur la fiche (extension ou contrat) : ${frDate(until)}.`;
  } else {
    if (!isDay(item.purchasedOn)) return unknown('Pas de date d’achat : la garantie ne peut pas être calculée.');
    const from = item.purchasedOn;
    if (item.warrantyMonths !== null && Number.isInteger(item.warrantyMonths) && item.warrantyMonths >= 0) {
      months = item.warrantyMonths; source = 'duree_fiche';
      explain = `${months} mois à partir du ${frDate(from)}, durée saisie sur la fiche.`;
    } else if (item.condition === 'occasion_particulier') {
      return unknown('Achat entre particuliers : pas de garantie légale. Saisissez une durée si le vendeur en a accordé une.');
    } else if (item.condition === 'occasion_pro') {
      months = USED_PRO_MONTHS; source = 'occasion_pro';
      explain = `${months} mois à partir du ${frDate(from)}, règle pour un bien d’occasion acheté à un professionnel.`;
    } else {
      if (!(rules.defaultMonths > 0)) return unknown('Aucune durée sur la fiche, et pas de durée par défaut réglée pour le foyer.');
      months = rules.defaultMonths; source = 'defaut';
      explain = `${months} mois à partir du ${frDate(from)}, règle par défaut.`;
    }
    until = addMonths(from, months);
  }
  const daysLeft = daysBetween(today, until);
  const since = addDays(until, 1);
  if (daysLeft < 0) {
    return { state: 'hors_garantie', until, since, daysLeft, source, months, label: `Hors garantie depuis le ${frDate(since)}`, explain };
  }
  if (daysLeft < rules.alertDays) {
    return { state: 'expire_bientot', until, since, daysLeft, source, months, label: `Garantie expire le ${frDate(until)}`, explain };
  }
  return { state: 'sous_garantie', until, since, daysLeft, source, months, label: `Sous garantie jusqu’au ${frDate(until)}`, explain };
}
