import { FinCategory, FinContract, FinContractCost, FinFlow, FinMonthSummary } from './finances.api';

/**
 * Le plan du mois, en fonctions pures : charges fixes attendues, enveloppes,
 * rythme, propositions de budgets. Tout est en centimes. L'Aperçu et la tuile
 * d'accueil lisent ces fonctions, jamais un calcul refait dans un template.
 */

const STEP: Record<string, number> = { mensuelle: 1, trimestrielle: 3, semestrielle: 6, annuelle: 12 };
const monthIndex = (m: string): number => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

export interface FixedCharge {
  contractId: number; name: string; provider: string;
  /** Attendu (montant annoncé, sinon le dernier débit), ou payé (montant réel). */
  amount: number;
  /** Jour du mois attendu : celui du dernier débit, sinon de la reconduction ; null sans l'un ni l'autre. */
  day: number | null;
  paid: boolean;
}

/**
 * Les charges fixes d'un mois : contrats actifs des catégories marquées fixes,
 * attendus ce mois-ci selon leur périodicité, comptée depuis leur dernier débit
 * (sinon leur date de reconduction). Une opération du mois qui porte le contrat
 * le dit payé, avec son montant réel.
 */
export function fixedCharges(
  month: string, contracts: FinContract[], categories: FinCategory[],
  costs: Record<number, FinContractCost>, paid: FinFlow['contracts'],
): FixedCharge[] {
  const fixed = new Set(categories.filter((c) => c.fixed).map((c) => c.id));
  const paidBy = new Map(paid.map((p) => [p.contractId, p]));
  const out: FixedCharge[] = [];
  for (const c of contracts) {
    if (c.status !== 'actif' || c.categoryId === null || !fixed.has(c.categoryId)) continue;
    const step = STEP[c.periodicity];
    const cost = costs[c.id];
    const p = paidBy.get(c.id);
    if (!p) {
      if (!step) continue;
      const anchor = cost?.lastDate ?? c.renewalOn;
      // Sans repère, seul un contrat mensuel est attendu à coup sûr.
      if (anchor ? ((monthIndex(month) - monthIndex(anchor)) % step + step) % step !== 0 : step !== 1) continue;
    }
    const expected = c.amountMax ?? c.amountMin ?? cost?.lastAmount ?? 0;
    const last = p?.date ?? cost?.lastDate ?? c.renewalOn;
    out.push({
      contractId: c.id, name: c.name, provider: c.provider,
      amount: p ? p.amount : expected, day: last ? Number(last.slice(8, 10)) : null, paid: !!p,
    });
  }
  // Payées d'abord, puis par jour attendu : la liste se lit comme le mois.
  return out.sort((a, b) => Number(b.paid) - Number(a.paid) || (a.day ?? 99) - (b.day ?? 99) || b.amount - a.amount);
}

export interface Envelope {
  categoryId: number; name: string; color: string; icon: string;
  budget: number; spent: number; left: number;
  /** Ce qui reste par jour d'ici la fin du mois. */
  perDay: number;
  /** Reste / budget moins la part du mois qui reste : négatif, c'est tendu. */
  tension: number;
}

/** Jours restants après aujourd'hui (au moins un, pour diviser). */
export const daysLeft = (f: Pick<FinFlow, 'days' | 'day'>): number => Math.max(1, f.days - f.day);

/** Budget du mois d'une catégorie : la référence, plus les transferts entrants, moins les sortants. */
export function monthBudget(c: Pick<FinCategory, 'id' | 'monthlyBudget'>, moves: FinFlow['moves']): number {
  return moves.reduce((a, m) => a + (m.toCategoryId === c.id ? m.amount : 0) - (m.fromCategoryId === c.id ? m.amount : 0), c.monthlyBudget);
}

/**
 * Enveloppe : catégorie racine, avec un budget de référence, qui n'est pas une
 * charge fixe. Son budget du mois tient compte des transferts.
 */
export function envelopes(categories: FinCategory[], flow: FinFlow): Envelope[] {
  const left = daysLeft(flow);
  return categories
    .filter((c) => c.parentId === null && c.monthlyBudget > 0 && !c.fixed)
    .map((c) => {
      const budget = monthBudget(c, flow.moves);
      const spent = flow.daily.reduce((a, d) => a + (d.categoryId === c.id ? d.spent : 0), 0);
      const rest = budget - spent;
      return {
        categoryId: c.id, name: c.name, color: c.color, icon: c.icon,
        budget, spent, left: rest, perDay: Math.max(0, Math.floor(rest / left)),
        tension: budget > 0 ? rest / budget - left / flow.days : -1,
      };
    })
    .sort((a, b) => a.tension - b.tension);
}

/**
 * Ce qu'une dépense laisserait dans son enveloppe : le reste, et ce qu'il
 * représente par jour d'ici la fin du mois, à comparer au rythme d'avant.
 */
export function afterSpend(e: Envelope, cents: number, days: number): { left: number; perDay: number; before: number } {
  const left = e.left - Math.abs(cents);
  return { left, perDay: Math.max(0, Math.floor(left / days)), before: e.perDay };
}

/** Dépense cumulée des enveloppes, jour par jour, du jour 0 au jour de référence. */
export function paceSeries(flow: FinFlow, categoryIds: number[]): number[] {
  const ids = new Set(categoryIds);
  const byDay = new Array(flow.days + 1).fill(0);
  for (const d of flow.daily) if (d.categoryId !== null && ids.has(d.categoryId)) byDay[d.day] += d.spent;
  const out: number[] = [];
  let sum = 0;
  for (let d = 0; d <= flow.day; d++) { sum += byDay[d]; out.push(sum); }
  return out;
}

/** La pastille du rythme : dépassement d'abord, puis l'avance sur le rythme (5 % de marge). */
export function paceStatus(envs: Envelope[], flow: FinFlow): 'crit' | 'warn' | 'ok' {
  if (envs.some((e) => e.left < 0)) return 'crit';
  const budget = envs.reduce((a, e) => a + e.budget, 0);
  const spent = envs.reduce((a, e) => a + e.spent, 0);
  return spent > budget * (flow.day / flow.days) * 1.05 ? 'warn' : 'ok';
}

/**
 * Le chiffre du mois : ressources moins dépenses moins les charges fixes encore
 * attendues. Ce qui reste, une fois payé ce qui doit l'être.
 */
export function remainingToFinish(s: Pick<FinMonthSummary, 'income' | 'expense'>, charges: FixedCharge[]): number {
  return s.income - s.expense - charges.reduce((a, c) => a + (c.paid ? 0 : c.amount), 0);
}

export interface BudgetProposal { categoryId: number; name: string; color: string; icon: string; budget: number; }

/**
 * Des enveloppes réalistes pour qui n'en a pas : la moyenne des mois complets
 * fournis (les trois derniers), par catégorie racine non fixe, arrondie à la
 * dizaine d'euros supérieure.
 */
export function proposeBudgets(categories: FinCategory[], months: FinMonthSummary[]): BudgetProposal[] {
  if (!months.length) return [];
  return categories
    .filter((c) => c.parentId === null && !c.fixed)
    .map((c) => {
      const total = months.reduce((a, m) => a + (m.categories.find((x) => x.categoryId === c.id)?.spent ?? 0), 0);
      return { categoryId: c.id, name: c.name, color: c.color, icon: c.icon, budget: Math.ceil(total / months.length / 1000) * 1000 };
    })
    .filter((p) => p.budget > 0)
    .sort((a, b) => b.budget - a.budget);
}

export interface CategoryCompare { categoryId: number; spent: number; average: number; }

/**
 * Ce mois jusqu'au jour de référence face à la moyenne des mois précédents au
 * même jour. Ne compte que les mois qui ont des données : un module ouvert le
 * mois dernier ne se compare pas à deux mois vides.
 */
export function compareToAverage(flow: FinFlow): CategoryCompare[] {
  const n = new Set(flow.previous.map((p) => p.month)).size;
  const spent = new Map<number, number>();
  const prev = new Map<number, number>();
  for (const d of flow.daily) if (d.categoryId !== null && d.day <= flow.day) spent.set(d.categoryId, (spent.get(d.categoryId) ?? 0) + d.spent);
  for (const p of flow.previous) if (p.categoryId !== null) prev.set(p.categoryId, (prev.get(p.categoryId) ?? 0) + p.spentToDay);
  return [...new Set([...spent.keys(), ...prev.keys()])]
    .map((id) => ({ categoryId: id, spent: spent.get(id) ?? 0, average: n ? Math.round((prev.get(id) ?? 0) / n) : 0 }))
    .sort((a, b) => b.spent - a.spent || b.average - a.average);
}
