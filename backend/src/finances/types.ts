// Wire shapes for /api/finances. Amounts are always signed integer cents.

export type AccountKind = 'courant' | 'pro' | 'epargne' | 'credit';
export type TxKind = 'depense' | 'recette' | 'virement';

export interface Account {
  id: number;
  name: string;
  kind: AccountKind;
  /** Titulaires du compte : zéro, un, ou plusieurs. */
  memberIds: string[];
  openingBalance: number;
  openingDate: string | null;
  archived: boolean;
  position: number;
  /** Paramètres du prêt, renseignés seulement quand `kind` vaut `credit`. */
  loan: LoanTerms | null;
}

/**
 * Un prêt amortissable à taux fixe, tel qu'il est écrit sur une offre de prêt.
 * Le capital restant dû n'est pas là : il se calcule (voir `loans.ts`).
 */
export interface LoanTerms {
  /** Capital emprunté, en centimes. */
  principal: number;
  /** Taux annuel nominal, en points de base : 3,45 % vaut 345. */
  rateBp: number;
  /** Mensualité hors assurance, en centimes. */
  payment: number;
  /** Assurance emprunteur mensuelle, en centimes. Zéro si elle est déjà dans la mensualité. */
  insurance: number;
  /** Date de la première échéance. */
  firstOn: string;
}

export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  monthlyBudget: number;
  color: string;
  icon: string;
  position: number;
}

export interface Transaction {
  id: number;
  accountId: number;
  date: string;
  amount: number;
  kind: TxKind;
  labelRaw: string;
  label: string;
  categoryId: number | null;
  contractId: number | null;
  notes: string;
  cleared: boolean;
  transferGroup: string | null;
  importId: number | null;
  /** Rule that last decided the category or label; null when set by hand. */
  ruleId: number | null;
  tags: string[];
}

/** Per-account coverage, used to flag incomplete months. */
export interface AccountCoverage {
  accountId: number;
  name: string;
  firstDate: string | null;
  lastDate: string | null;
  count: number;
}

export interface CategorySummary {
  categoryId: number | null;
  name: string;
  color: string;
  icon: string;
  budget: number;
  spent: number;
}

export interface MonthSummary {
  month: string;
  income: number;
  expense: number;
  balance: number;
  budgetTotal: number;
  categories: CategorySummary[];
  /** Active accounts whose data does not reach the end of this month. */
  missing: { accountId: number; name: string; coveredThrough: string | null }[];
  incomplete: boolean;
}

export const ACCOUNT_KINDS: AccountKind[] = ['courant', 'pro', 'epargne', 'credit'];
export const TX_KINDS: TxKind[] = ['depense', 'recette', 'virement'];

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  courant: 'Compte courant',
  pro: 'Compte professionnel',
  epargne: 'Épargne',
  credit: 'Crédit',
};
