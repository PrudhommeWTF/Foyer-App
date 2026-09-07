// Catégorisation suggérée des opérations, apprise de l'historique.
//
// La logique de décision vit ici et ne touche jamais la base (comme rules.ts) :
// elle prend des opérations déjà catégorisées et propose une catégorie pour un
// nouveau libellé. C'est délibérément simple et explicable, pas un modèle opaque :
// on regroupe par « marchand » (le libellé débarrassé de ses parties variables)
// et on rend la catégorie majoritaire, à condition qu'elle soit franche.
//
// L'esprit est celui de suggestAccount à l'import : sur des données d'argent, une
// correspondance approximative est pire que pas de suggestion du tout.
import { normaliseLabel } from './money';

/**
 * Clé « marchand » : une normalisation agressive qui retire ce qui change d'une
 * opération à l'autre chez le même commerçant (dates, heures, numéros de carte
 * et de référence), pour que « CB CARREFOUR CITY 1234 DU 07/09 » et
 * « CB CARREFOUR CITY 5678 DU 03/10 » se ramènent à la même clé.
 *
 * Distincte de `normaliseLabel`, qui reste conservatrice parce qu'elle sert
 * d'empreinte de déduplication : on ne peut pas y toucher.
 */
export function merchantKey(label: string): string {
  return normaliseLabel(label)
    .replace(/\b\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?\b/g, ' ') // dates : 07/09, 03-10-2026
    .replace(/\b\d{1,2}H\d{2}\b/g, ' ')                            // heures : 14H30
    .replace(/\b(?:CB|CARTE|PAIEMENT|ACHAT|PRLV|PRELEVEMENT|FACTURE|REF|DU|LE)\b/g, ' ') // bruit courant
    .replace(/\d{3,}/g, ' ')       // longues suites de chiffres : fin de carte, références
    .replace(/[^A-Z0-9 ]+/g, ' ')  // ponctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/** Une opération passée, réduite à ce dont la décision a besoin. */
export interface KeyedTx { key: string; categoryId: number; }

export interface Suggestion {
  categoryId: number;
  /** Combien de fois ce marchand a déjà reçu cette catégorie. Sert à l'expliquer. */
  seen: number;
  /** Total d'opérations connues pour ce marchand. */
  total: number;
}

/**
 * Propose une catégorie pour `key` à partir des opérations déjà catégorisées.
 * Rend une suggestion seulement si une catégorie est vue au moins `minSeen` fois
 * pour ce marchand **et** l'emporte franchement (strictement devant la suivante).
 * Sinon `null` : mieux vaut ne rien proposer qu'induire en erreur.
 */
export function pickCategory(key: string, rows: KeyedTx[], minSeen: number): Suggestion | null {
  if (!key) return null;
  const tally = new Map<number, number>();
  let total = 0;
  for (const r of rows) {
    if (r.key !== key) continue;
    tally.set(r.categoryId, (tally.get(r.categoryId) || 0) + 1);
    total++;
  }
  if (!total) return null;
  let bestId = -1;
  let best = 0;
  let second = 0;
  for (const [cid, n] of tally) {
    if (n > best) { second = best; best = n; bestId = cid; }
    else if (n > second) { second = n; }
  }
  if (best < Math.max(1, minSeen) || best <= second) return null;
  return { categoryId: bestId, seen: best, total };
}
