import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface FinancesTileData {
  monthLabel: string;
  /** Centimes. Dépenses et ressources du mois en cours, virements internes exclus. */
  expense: number;
  income: number;
  balance: number;
  /** Somme des budgets de référence. Zéro quand aucun n'est posé. */
  budgetTotal: number;
}

/**
 * Nomme les comptes qui manquent plutôt que de les compter seulement : devant
 * un chiffre incomplet, la question suivante est toujours « lesquels ».
 */
function incompleteLabel(missing: { name: string }[]): string {
  const n = missing.length;
  return `Mois incomplet : ${n} compte${n > 1 ? 's' : ''} sans données récentes (${missing.map((m) => m.name).join(', ')}).`;
}

/**
 * Les finances du **mois en cours**, jamais du mois qu'on regardait dans
 * l'écran Finances. C'est la confusion qui a fait afficher pendant des semaines
 * les chiffres d'un mois d'archive sur l'accueil.
 */
export const financesTile = {
  id: 'finances',
  title: 'Finances',
  screen: 'finances',
  link: 'Détails',
  source: 'finances',
  state: (ctx): TileState<FinancesTileData> => fromSource(ctx.fin, (f, asOf) => {
    // Aucun compte déclaré : le module n'a jamais servi. Ce n'est pas une
    // erreur, et surtout ce n'est pas « zéro euro dépensé ».
    if (!f.accounts) return empty('Aucun compte déclaré. Commencez par en créer un dans Finances.');
    const s = f.summary;
    if (!s) {
      return {
        kind: 'error',
        message: 'Synthèse du mois indisponible.',
        detail: `Finances : aucune synthèse renvoyée pour ${f.month}.`,
      };
    }
    return ok(
      { monthLabel: f.monthLabel, expense: s.expense, income: s.income, balance: s.balance, budgetTotal: s.budgetTotal },
      asOf,
      s.incomplete ? incompleteLabel(s.missing) : undefined,
    );
  }),
} satisfies TileProvider<FinancesTileData>;
