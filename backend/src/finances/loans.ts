/**
 * Prêts amortissables à taux fixe : tout ce qui se déduit d'une offre de prêt.
 *
 * Rien n'est stocké ici. Le capital restant dû, la part d'intérêts d'une
 * échéance, la date de fin et le coût total se **recalculent** à partir des
 * termes du prêt et d'un point d'ancrage, exactement comme les échéances de
 * contrats se recalculent à partir de leur date de reconduction. Un tableau
 * d'amortissement figé en base serait faux dès le premier remboursement
 * anticipé, et personne ne saurait pourquoi.
 *
 * Convention de signe : à l'intérieur de ce module, un capital restant dû est
 * un entier **positif** en centimes. C'est une dette, pas un solde.
 */
import { Account, LoanTerms } from './types';

/** Une échéance du tableau d'amortissement. */
export interface Instalment {
  /** Date de l'échéance. */
  date: string;
  /** Rang de l'échéance, à partir de 1. */
  n: number;
  /** Intérêts de la période, en centimes. */
  interest: number;
  /** Capital amorti, en centimes. */
  principal: number;
  /** Assurance, en centimes. Constante, elle n'amortit rien. */
  insurance: number;
  /** Ce qui sort réellement du compte courant ce mois-là. */
  total: number;
  /** Capital restant dû **après** cette échéance. */
  owed: number;
}

/** L'état d'un prêt à une date donnée. */
export interface LoanView {
  accountId: number;
  /** Capital restant dû aujourd'hui, en centimes, positif. */
  owed: number;
  /** Capital emprunté, repris des termes. */
  principal: number;
  /** Capital déjà amorti depuis le début du prêt. */
  repaid: number;
  /** Part remboursée, de 0 à 1. */
  progress: number;
  /** Échéances déjà payées, et celles qui restent. */
  paid: number;
  left: number;
  /** Date de la dernière échéance. */
  endsOn: string;
  /** Intérêts restant à payer, hors assurance. */
  interestLeft: number;
  /** Assurance restant à payer. */
  insuranceLeft: number;
  /** Ce qui sort du compte chaque mois, assurance comprise. */
  monthly: number;
  /** La prochaine échéance, décomposée. Null quand le prêt est soldé. */
  next: Instalment | null;
  /** Intérêts et assurance de l'année civile en cours : le chiffre d'une déclaration. */
  thisYear: { interest: number; insurance: number };
}

export class LoanRefused extends Error {}

/**
 * Un prêt qui ne s'amortit pas est une erreur de saisie, pas un cas limite :
 * si la mensualité ne couvre même pas les intérêts du premier mois, le capital
 * monte à chaque échéance et le tableau ne se termine jamais. On refuse tout de
 * suite, avec le chiffre qui manque, plutôt que de boucler à l'infini.
 */
export function checkTerms(t: LoanTerms): void {
  if (t.principal <= 0) throw new LoanRefused('Le capital emprunté doit être supérieur à zéro.');
  if (t.payment <= 0) throw new LoanRefused('La mensualité doit être supérieure à zéro.');
  if (t.rateBp < 0) throw new LoanRefused('Le taux ne peut pas être négatif.');
  const firstInterest = monthlyInterest(t.principal, t.rateBp);
  if (t.payment <= firstInterest) {
    throw new LoanRefused(
      `Mensualité trop faible : les intérêts du premier mois valent déjà ${euros(firstInterest)} €. `
      + `Le capital ne baisserait jamais. Vérifiez le taux (${(t.rateBp / 100).toFixed(2).replace('.', ',')} %) et la mensualité.`,
    );
  }
}

const euros = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',');

/** Intérêts d'un mois : capital restant dû fois le taux mensuel, arrondi au centime. */
export function monthlyInterest(owed: number, rateBp: number): number {
  if (rateBp <= 0) return 0;
  return Math.round((owed * rateBp) / 120000);
}

/** Le mois suivant, en gardant le jour quand il existe (le 31 devient le 30, ou le 28). */
export function addMonths(iso: string, n: number): string {
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10);
  const d = parseInt(iso.slice(8, 10), 10);
  const total = (y * 12) + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = d < last ? d : last;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/**
 * Le tableau d'amortissement complet, depuis un point de départ.
 *
 * La dernière échéance est **ajustée** : elle solde exactement le capital
 * restant, ce qui évite le centime résiduel qu'un arrondi mensuel finit
 * toujours par produire. C'est ce que fait un prêteur.
 */
export function schedule(t: LoanTerms, from = { owed: t.principal, date: t.firstOn, n: 1 }): Instalment[] {
  checkTerms(t);
  const out: Instalment[] = [];
  let owed = from.owed;
  let n = from.n;
  let date = from.date;
  // Borne dure : 100 ans d'échéances. checkTerms garantit déjà la convergence,
  // ce garde-fou n'existe que pour qu'un bug futur plante au lieu de figer le
  // serveur.
  while (owed > 0 && out.length < 1200) {
    const interest = monthlyInterest(owed, t.rateBp);
    let principal = t.payment - interest;
    if (principal >= owed) principal = owed;
    owed -= principal;
    out.push({ date, n, interest, principal, insurance: t.insurance, total: interest + principal + t.insurance, owed });
    n += 1;
    date = addMonths(from.date, n - from.n);
  }
  return out;
}

/**
 * Point de départ du calcul : le recalage saisi par l'utilisateur, sinon
 * l'origine du prêt.
 *
 * Le solde d'ouverture d'un compte de crédit est une dette, donc négatif ; on
 * le repasse en positif ici. C'est le même mécanisme que pour un compte
 * ordinaire, avec le même sens : « voilà ce que je dois, à cette date-là ».
 * Après un remboursement anticipé ou une renégociation, c'est ce qu'on
 * ressaisit depuis le relevé annuel de la banque.
 */
function anchorOf(a: Account, t: LoanTerms): { owed: number; date: string; n: number } {
  if (a.openingDate && a.openingBalance < 0) {
    // Le rang de l'échéance se retrouve en comptant les mois écoulés depuis la
    // première : il ne sert qu'à numéroter, jamais à calculer un montant.
    const months = monthsBetween(t.firstOn, a.openingDate);
    return { owed: -a.openingBalance, date: addMonths(t.firstOn, months + 1), n: months + 2 };
  }
  return { owed: t.principal, date: t.firstOn, n: 1 };
}

/** Mois pleins entre deux dates ISO, négatif si la seconde précède la première. */
export function monthsBetween(from: string, to: string): number {
  const a = (parseInt(from.slice(0, 4), 10) * 12) + parseInt(from.slice(5, 7), 10);
  const b = (parseInt(to.slice(0, 4), 10) * 12) + parseInt(to.slice(5, 7), 10);
  const diff = b - a;
  return to.slice(8, 10) >= from.slice(8, 10) ? diff : diff - 1;
}

/**
 * L'état du prêt d'un compte à une date donnée. Null quand le compte n'est pas
 * un crédit, quand ses termes ne sont pas encore saisis, ou quand ils ne
 * s'amortissent pas : un écran ne doit jamais tomber à cause d'une ligne de
 * base douteuse, il doit le dire.
 */
export function loanView(a: Account, today = new Date().toISOString().slice(0, 10)): LoanView | null {
  if (a.kind !== 'credit' || !a.loan) return null;
  const t = a.loan;
  let anchor: { owed: number; date: string; n: number };
  let rows: Instalment[];
  try {
    anchor = anchorOf(a, t);
    rows = schedule(t, anchor);
  } catch { return null; }
  const done = rows.filter((r) => r.date <= today);
  const left = rows.filter((r) => r.date > today);
  const owed = done.length ? done[done.length - 1].owed : anchor.owed;
  const repaid = t.principal - owed;
  return {
    accountId: a.id,
    owed,
    principal: t.principal,
    repaid,
    progress: repaid / t.principal,
    // Compté depuis l'origine du prêt, pas depuis le recalage : c'est le rang
    // que l'emprunteur lit sur son tableau d'amortissement.
    paid: Math.max(0, monthsBetween(t.firstOn, today) + 1),
    left: left.length,
    endsOn: rows.length ? rows[rows.length - 1].date : t.firstOn,
    interestLeft: left.reduce((s, r) => s + r.interest, 0),
    insuranceLeft: left.reduce((s, r) => s + r.insurance, 0),
    monthly: t.payment + t.insurance,
    next: left.length ? left[0] : null,
    thisYear: yearTotals(rows, today.slice(0, 4)),
  };
}

const yearTotals = (rows: Instalment[], year: string): { interest: number; insurance: number } => {
  const inYear = rows.filter((r) => r.date.slice(0, 4) === year);
  return {
    interest: inYear.reduce((s, r) => s + r.interest, 0),
    insurance: inYear.reduce((s, r) => s + r.insurance, 0),
  };
};

/** Le tableau d'amortissement d'un compte, tel qu'il se compare à celui de la banque. */
export function loanSchedule(a: Account): Instalment[] {
  if (a.kind !== 'credit' || !a.loan) return [];
  try { return schedule(a.loan, anchorOf(a, a.loan)); } catch { return []; }
}

/**
 * Intérêts et assurance payés sur une année civile, pour un compte de crédit.
 * C'est le chiffre que réclame une déclaration de revenus fonciers.
 */
export function interestPaidIn(a: Account, year: number): { interest: number; insurance: number } {
  if (a.kind !== 'credit' || !a.loan) return { interest: 0, insurance: 0 };
  return yearTotals(loanSchedule(a), String(year));
}
