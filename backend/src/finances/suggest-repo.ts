// Accès base pour la catégorisation suggérée. La décision vit dans suggest.ts ;
// ce fichier ne fait que lire l'historique et appeler le module pur.
import type { Database } from 'better-sqlite3';
import { KeyedTx, Suggestion, buildIndex, classifyBayes, merchantKey, pickFromIndex, trainBayes } from './suggest';

let database: Database;
export function initSuggestRepo(db: Database): void { database = db; }

interface Row { label: string; categoryId: number; }

/** Les opérations dont on apprend : catégorisées à la main, hors virement. */
function learnRows(): Row[] {
  return database
    .prepare("SELECT label, category_id AS categoryId FROM fin_transactions WHERE category_id IS NOT NULL AND rule_id IS NULL AND kind <> 'virement'")
    .all() as Row[];
}

const keyedOf = (rows: Row[]): KeyedTx[] => rows.map((r) => ({ key: merchantKey(r.label), categoryId: r.categoryId }));

/**
 * Suggère une catégorie pour `label` : le marchand exact d'abord, puis, à défaut,
 * un repli par ressemblance (Naïve Bayes) pour un libellé jamais vu mais proche.
 */
export function suggestCategory(label: string, minSeen: number): Suggestion | null {
  const rows = learnRows();
  return pickFromIndex(merchantKey(label), buildIndex(keyedOf(rows)), minSeen)
    ?? classifyBayes(label, trainBayes(rows), minSeen);
}

export interface ImportSuggestion {
  id: number;
  label: string;
  amount: number;
  date: string;
  categoryId: number;
  via: 'merchant' | 'similar';
  seen: number;
}

/**
 * Pour un import donné, les opérations **encore sans catégorie** (les règles sont
 * déjà passées) pour lesquelles l'historique manuel propose une catégorie franche,
 * marchand exact ou ressemblance. Index et modèle ne sont construits qu'une fois.
 */
export function importSuggestions(importId: number, minSeen: number): ImportSuggestion[] {
  const learn = learnRows();
  const idx = buildIndex(keyedOf(learn));
  const model = trainBayes(learn);
  const rows = database
    .prepare("SELECT id, label, amount, date FROM fin_transactions WHERE import_id = ? AND category_id IS NULL AND kind <> 'virement' ORDER BY date, id")
    .all(importId) as { id: number; label: string; amount: number; date: string }[];
  const out: ImportSuggestion[] = [];
  for (const r of rows) {
    const s = pickFromIndex(merchantKey(r.label), idx, minSeen) ?? classifyBayes(r.label, model, minSeen);
    if (s) out.push({ id: r.id, label: r.label, amount: r.amount, date: r.date, categoryId: s.categoryId, via: s.via, seen: s.seen });
  }
  return out;
}
