// Accès base pour la catégorisation suggérée. La décision vit dans suggest.ts ;
// ce fichier ne fait que lire l'historique et appeler le module pur.
import type { Database } from 'better-sqlite3';
import { KeyedTx, Suggestion, buildIndex, merchantKey, pickCategory, pickFromIndex } from './suggest';

let database: Database;
export function initSuggestRepo(db: Database): void { database = db; }

interface Row { label: string; categoryId: number; }

/** Les opérations dont on apprend : catégorisées à la main, hors virement. */
function learnSet(): KeyedTx[] {
  const rows = database
    .prepare("SELECT label, category_id AS categoryId FROM fin_transactions WHERE category_id IS NOT NULL AND rule_id IS NULL AND kind <> 'virement'")
    .all() as Row[];
  return rows.map((r) => ({ key: merchantKey(r.label), categoryId: r.categoryId }));
}

/**
 * Suggère une catégorie pour `label`, apprise des opérations **catégorisées à la
 * main** (`category_id` posé, `rule_id` nul : ni virement, ni décidé par une
 * règle). C'est bien « ce que les utilisateurs ont catégorisé eux-mêmes » qui
 * sert de mémoire ; une catégorie posée par une règle a déjà sa règle.
 */
export function suggestCategory(label: string, minSeen: number): Suggestion | null {
  return pickCategory(merchantKey(label), learnSet(), minSeen);
}

export interface ImportSuggestion {
  id: number;
  label: string;
  amount: number;
  date: string;
  categoryId: number;
  seen: number;
}

/**
 * Pour un import donné, les opérations **encore sans catégorie** (les règles sont
 * déjà passées) pour lesquelles l'historique manuel propose une catégorie franche.
 * Rendues au frontend pour une revue et une application en lot. L'index de
 * marchands n'est construit qu'une fois pour tout le lot.
 */
export function importSuggestions(importId: number, minSeen: number): ImportSuggestion[] {
  const idx = buildIndex(learnSet());
  const rows = database
    .prepare("SELECT id, label, amount, date FROM fin_transactions WHERE import_id = ? AND category_id IS NULL AND kind <> 'virement' ORDER BY date, id")
    .all(importId) as { id: number; label: string; amount: number; date: string }[];
  const out: ImportSuggestion[] = [];
  for (const r of rows) {
    const s = pickFromIndex(merchantKey(r.label), idx, minSeen);
    if (s) out.push({ id: r.id, label: r.label, amount: r.amount, date: r.date, categoryId: s.categoryId, seen: s.seen });
  }
  return out;
}
