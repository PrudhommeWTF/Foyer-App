// Accès base pour la catégorisation suggérée. La décision vit dans suggest.ts ;
// ce fichier ne fait que lire l'historique et appeler le module pur.
import type { Database } from 'better-sqlite3';
import { KeyedTx, Suggestion, merchantKey, pickCategory } from './suggest';

let database: Database;
export function initSuggestRepo(db: Database): void { database = db; }

interface Row { label: string; categoryId: number; }

/**
 * Suggère une catégorie pour `label`, apprise des opérations **catégorisées à la
 * main** (`category_id` posé, `rule_id` nul : ni virement, ni décidé par une
 * règle). C'est bien « ce que les utilisateurs ont catégorisé eux-mêmes » qui
 * sert de mémoire ; une catégorie posée par une règle a déjà sa règle.
 */
export function suggestCategory(label: string, minSeen: number): Suggestion | null {
  const key = merchantKey(label);
  if (!key) return null;
  const rows = database
    .prepare("SELECT label, category_id AS categoryId FROM fin_transactions WHERE category_id IS NOT NULL AND rule_id IS NULL AND kind <> 'virement'")
    .all() as Row[];
  const keyed: KeyedTx[] = rows.map((r) => ({ key: merchantKey(r.label), categoryId: r.categoryId }));
  return pickCategory(key, keyed, minSeen);
}
